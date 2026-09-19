import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { createMessageHandler, type AuthenticatedRequest } from '../src/index';
import { cleanupOrphanFinalizedMedia, recoverExpiredClientRequests } from '../src/index';
import { cleanupStagingObjects } from '../src/scheduler';
import { emulatorFixture, seedEmulatorFixture } from '../src/fixtures';

describe('Functions emulator integration', () => {
  beforeEach(async () => {
    await seedEmulatorFixture();
  });

  it('creates and replays one canonical message for duplicate clientId', async () => {
    const request: AuthenticatedRequest = {
      auth: { uid: 'user-integration' },
      data: { roomId: 'room-integration', clientId: 'client-integration', kind: 'text', text: 'hello emulator' },
    };
    const first = await createMessageHandler(request);
    const second = await createMessageHandler(request);
    expect(second.messageId).toBe(first.messageId);
    const snapshot = await getFirestore().collection('rooms/room-integration/messages').get();
    expect(snapshot.docs.filter(document => document.data().clientId === 'client-integration')).toHaveLength(1);
  });

  it('keeps server identity and timestamps authoritative', async () => {
    const request: AuthenticatedRequest = {
      auth: { uid: 'user-integration' },
      data: { roomId: 'room-integration', clientId: 'client-server-fields', kind: 'text', text: 'server owns fields' },
    };
    const result = await createMessageHandler(request);
    const snapshot = await getFirestore().doc(`rooms/room-integration/messages/${result.messageId}`).get();
    const data = snapshot.data();
    expect(data?.roomId).toBe('room-integration');
    expect(data?.senderId).toBe('user-integration');
    expect(data?.state).toBe('normal');
    expect(data?.schemaVersion).toBe(1);
    expect(data?.createdAt).toBeDefined();
    expect(data?.updatedAt).toBeDefined();
  });

  it('supports bounded message query and fixture media metadata', async () => {
    const fixture = emulatorFixture();
    const snapshot = await getFirestore().collection('rooms/room-integration/messages')
      .orderBy('createdAt', 'asc').limitToLast(50).get();
    expect(snapshot.size).toBe(3);
    expect(fixture.messages.filter(message => message.media).length).toBe(2);
  });

  it('rejects inactive members and cross-user idempotency replay', async () => {
    await getFirestore().doc('rooms/room-integration/members/user-integration').set({ active: false });
    await expect(createMessageHandler({
      auth: { uid: 'user-integration' },
      data: { roomId: 'room-integration', clientId: 'inactive-client', kind: 'text', text: 'blocked' },
    })).rejects.toMatchObject({ code: 'permission-denied' });

    await getFirestore().doc('rooms/room-integration/members/user-integration').set({ active: true });
    const first = await createMessageHandler({
      auth: { uid: 'user-integration' },
      data: { roomId: 'room-integration', clientId: 'tenant-client', kind: 'text', text: 'owner' },
    });
    await getFirestore().doc('rooms/room-integration/members/user-second').set({ active: true });
    await expect(createMessageHandler({
      auth: { uid: 'user-second' },
      data: { roomId: 'room-integration', clientId: 'tenant-client', kind: 'text', text: 'replay' },
    })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(first.senderId).toBe('user-integration');
  });

  it('does not create a second canonical message when requests race', async () => {
    const request: AuthenticatedRequest = {
      auth: { uid: 'user-integration' },
      data: { roomId: 'room-integration', clientId: 'race-client', kind: 'text', text: 'one canonical message' },
    };
    const results = await Promise.all([createMessageHandler(request), createMessageHandler(request)]);
    expect(new Set(results.map(result => result.messageId)).size).toBe(1);
    const snapshot = await getFirestore().collection('rooms/room-integration/messages').get();
    expect(snapshot.docs.filter(document => document.data().clientId === 'race-client')).toHaveLength(1);
  });

  it('does not reuse same clientId across rooms', async () => {
    await getFirestore().doc('rooms/room-other').set({ roomId: 'room-other' });
    await getFirestore().doc('rooms/room-other/members/user-integration').set({ active: true });
    const result = await createMessageHandler({
      auth: { uid: 'user-integration' },
      data: { roomId: 'room-other', clientId: 'tenant-client', kind: 'text', text: 'other room' },
    });
    expect(result.roomId).toBe('room-other');
    expect(result.messageId).not.toBe('');
  });

  it('recovers expired reservation and rejects active processing lease', async () => {
    const roomId = 'room-integration';
    const clientId = 'expired-recovery';
    const requestId = createHash('sha256').update(`${roomId}\0${clientId}`).digest('hex');
    await getFirestore().doc(`rooms/${roomId}/clientRequests/${requestId}`).set({
      uid: 'user-integration', roomId, clientId, messageId: 'recovered-message', state: 'reserved',
      createdAt: new Date('2026-09-18T00:00:00.000Z'), updatedAt: new Date('2026-09-18T00:00:00.000Z'), leaseUntil: new Date('2026-09-18T00:01:00.000Z'),
    });
    const recovered = await createMessageHandler({ auth: { uid: 'user-integration' }, data: { roomId, clientId, kind: 'text', text: 'recovered' } });
    expect(recovered.messageId).toBe('recovered-message');

    const activeClientId = 'active-processing';
    const activeId = createHash('sha256').update(`${roomId}\0${activeClientId}`).digest('hex');
    await getFirestore().doc(`rooms/${roomId}/clientRequests/${activeId}`).set({
      uid: 'user-integration', roomId, clientId: activeClientId, messageId: 'active-message', state: 'processing',
      createdAt: new Date(), updatedAt: new Date(), leaseUntil: new Date(Date.now() + 60_000),
    });
    await expect(createMessageHandler({ auth: { uid: 'user-integration' }, data: { roomId, clientId: activeClientId, kind: 'text', text: 'blocked' } }))
      .rejects.toMatchObject({ code: 'failed-precondition' });

    const failedClientId = 'failed-retry';
    const failedId = createHash('sha256').update(`${roomId}\0${failedClientId}`).digest('hex');
    await getFirestore().doc(`rooms/${roomId}/clientRequests/${failedId}`).set({
      uid: 'user-integration', roomId, clientId: failedClientId, messageId: 'failed-retry-message', state: 'failed',
      createdAt: new Date(), updatedAt: new Date(), leaseUntil: null,
    });
    const retried = await createMessageHandler({ auth: { uid: 'user-integration' }, data: { roomId, clientId: failedClientId, kind: 'text', text: 'retry failed request' } });
    expect(retried.messageId).toBe('failed-retry-message');
  });

  it('expires stale requests and removes only unreferenced finalized media', async () => {
    const requestRef = getFirestore().doc('rooms/room-integration/clientRequests/cleanup-request');
    await requestRef.set({ uid: 'user-integration', roomId: 'room-integration', clientId: 'cleanup-client', messageId: 'cleanup-message', state: 'reserved', leaseUntil: new Date('2026-09-18T00:00:00.000Z') });
    const recovered = await recoverExpiredClientRequests(new Date('2026-09-19T00:00:00.000Z'));
    expect(recovered.paths).toContain(requestRef.path);
    expect(recovered.nextCursor).toBeNull();
    expect((await requestRef.get()).data()?.state).toBe('expired');

    const storage = (await import('firebase-admin/storage')).getStorage().bucket();
    await storage.file('rooms/room-integration/media/orphan-cleanup/original').save(Buffer.from('orphan'), { metadata: { contentType: 'image/png' } });
    await storage.file('rooms/room-integration/media/fixture-text/original').save(Buffer.from('protected'), { metadata: { contentType: 'image/png' } });
    const removed = await cleanupOrphanFinalizedMedia(new Date(Date.now() + 86_400_001), 86_400_000);
    expect(removed).toContain('rooms/room-integration/media/orphan-cleanup/original');
    await expect(storage.file('rooms/room-integration/media/orphan-cleanup/original').exists()).resolves.toEqual([false]);
    await expect(storage.file('rooms/room-integration/media/fixture-text/original').exists()).resolves.toEqual([true]);
  });

  it('recovers bounded request pages with cursor and preserves committed state', async () => {
    const db = getFirestore();
    const batch = db.batch();
    for (let index = 0; index < 101; index += 1) {
      const clientId = `batch-${String(index).padStart(3, '0')}`;
      const requestId = createHash('sha256').update(`room-integration\0${clientId}`).digest('hex');
      batch.set(db.doc(`rooms/room-integration/clientRequests/${requestId}`), {
        uid: 'user-integration', roomId: 'room-integration', clientId, messageId: `batch-message-${index}`,
        state: 'reserved', leaseUntil: new Date('2026-09-18T00:00:00.000Z'),
      });
    }
    const committedRef = db.doc('rooms/room-integration/clientRequests/committed-batch');
    batch.set(committedRef, { uid: 'user-integration', roomId: 'room-integration', clientId: 'committed-batch', messageId: 'committed-message', state: 'committed', leaseUntil: new Date('2026-09-18T00:00:00.000Z') });
    await batch.commit();
    const first = await recoverExpiredClientRequests(new Date('2026-09-19T00:00:00.000Z'));
    expect(first.paths).toHaveLength(100);
    expect(first.nextCursor).toBeTruthy();
    const second = await recoverExpiredClientRequests(new Date('2026-09-19T00:00:00.000Z'), first.nextCursor ?? undefined);
    expect(second.paths).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect((await committedRef.get()).data()?.state).toBe('committed');
  });

  it('cleans expired staging objects but keeps active request objects', async () => {
    const storage = (await import('firebase-admin/storage')).getStorage().bucket();
    await storage.file('rooms/room-integration/staging/user-integration/expired-staging/original').save(Buffer.from('old'), { metadata: { contentType: 'image/png' } });
    await storage.file('rooms/room-integration/staging/user-integration/active-staging/original').save(Buffer.from('active'), { metadata: { contentType: 'image/png' } });
    const activeId = createHash('sha256').update('room-integration\0active-staging').digest('hex');
    await getFirestore().doc(`rooms/room-integration/clientRequests/${activeId}`).set({ uid: 'user-integration', roomId: 'room-integration', clientId: 'active-staging', messageId: 'active-staging-message', state: 'processing' });
    const result = await cleanupStagingObjects(new Date(Date.now() + 86_400_001), 86_400_000);
    expect(result.deleted).toContain('rooms/room-integration/staging/user-integration/expired-staging/original');
    await expect(storage.file('rooms/room-integration/staging/user-integration/active-staging/original').exists()).resolves.toEqual([true]);
  });
});
