import { beforeEach, describe, expect, it } from 'vitest';
import { getFirestore } from 'firebase-admin/firestore';
import { emulatorFixture, seedEmulatorFixture } from '../src/fixtures';
import { messageQuerySpec, decodeMessageCursor, encodeMessageCursor } from '../src/query-contract';
import { writeMessageTombstone } from '../src/index';

describe('backend query contract', () => {
  beforeEach(async () => { await seedEmulatorFixture(); });

  it('uses bounded createdAt plus document-id ordering', async () => {
    const spec = messageQuerySpec('room-integration', 2);
    const snapshot = await getFirestore().collection(spec.path)
      .orderBy('createdAt', 'asc').orderBy('__name__', 'asc').limit(spec.limit).get();
    expect(snapshot.size).toBe(2);
    expect(spec.limit).toBe(2);
  });

  it('round-trips opaque cursor and tombstone fixture contract', async () => {
    const fixture = emulatorFixture();
    const cursor = encodeMessageCursor({ createdAt: '2026-09-19T00:00:00.000Z', messageId: fixture.messages[0].messageId });
    expect(decodeMessageCursor(cursor)).toEqual({ createdAt: '2026-09-19T00:00:00.000Z', messageId: 'fixture-text' });
    await getFirestore().doc('rooms/room-integration/messages/deleted-message').set({
      messageId: 'deleted-message', clientId: 'deleted-client', roomId: 'room-integration', senderId: 'user-integration',
      kind: 'text', state: 'normal', text: 'remove me', media: null, schemaVersion: 1,
      createdAt: new Date('2026-09-19T00:00:00.000Z'), updatedAt: new Date('2026-09-19T00:00:00.000Z'),
    });
    await writeMessageTombstone({ auth: { uid: 'user-integration' }, data: { roomId: 'room-integration', messageId: 'deleted-message' } });
    const tombstone = await getFirestore().doc('rooms/room-integration/messages/deleted-message').get();
    expect(tombstone.data()?.state).toBe('deleted');
  });

  it('allows sender tombstone but rejects another active member', async () => {
    await getFirestore().doc('rooms/room-integration/messages/owned-message').set({
      messageId: 'owned-message', clientId: 'owned-client', roomId: 'room-integration', senderId: 'user-integration',
      kind: 'text', state: 'normal', text: 'owned', media: null, schemaVersion: 1,
      createdAt: new Date('2026-09-19T00:00:00.000Z'), updatedAt: new Date('2026-09-19T00:00:00.000Z'),
    });
    await expect(writeMessageTombstone({ auth: { uid: 'user-integration' }, data: { roomId: 'room-integration', messageId: 'owned-message' } })).resolves.toMatchObject({ state: 'deleted' });
    await getFirestore().doc('rooms/room-integration/messages/other-message').set({
      messageId: 'other-message', clientId: 'other-client', roomId: 'room-integration', senderId: 'other-sender',
      kind: 'text', state: 'normal', text: 'other', media: null, schemaVersion: 1,
      createdAt: new Date('2026-09-19T00:00:00.000Z'), updatedAt: new Date('2026-09-19T00:00:00.000Z'),
    });
    await expect(writeMessageTombstone({ auth: { uid: 'user-integration' }, data: { roomId: 'room-integration', messageId: 'other-message' } })).rejects.toMatchObject({ code: 'permission-denied' });
    await getFirestore().doc('rooms/room-integration/members/user-integration').set({ active: false });
    await expect(writeMessageTombstone({ auth: { uid: 'user-integration' }, data: { roomId: 'room-integration', messageId: 'owned-message' } })).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
