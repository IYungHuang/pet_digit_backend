import { beforeEach, describe, expect, it } from 'vitest';
import { getFirestore } from 'firebase-admin/firestore';
import { createMessageHandler, type AuthenticatedRequest } from '../src/index';
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
});
