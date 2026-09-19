import { beforeEach, describe, expect, it } from 'vitest';
import { getFirestore } from 'firebase-admin/firestore';
import { createMessageHandler, type AuthenticatedRequest } from '../src/index';

describe('Functions emulator integration', () => {
  beforeEach(async () => {
    await getFirestore().doc('rooms/room-integration/members/user-integration').set({ active: true });
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
    expect(snapshot.size).toBe(1);
  });
});
