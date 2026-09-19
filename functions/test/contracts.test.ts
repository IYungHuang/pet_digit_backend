import { describe, expect, it } from 'vitest';
import {
  createMessageHandler,
  finalizeMediaMessageHandler,
  type Dependencies,
  type AuthenticatedRequest,
} from '../src/index';

const requests = new Map<string, { messageId: string }>();
const deps: Dependencies = {
  isMember: async () => true,
  getRequest: async (_uid, _roomId, clientId) => requests.get(clientId) ?? null,
  commitMessage: async ({ uid, roomId, clientId, kind }) => {
    const existing = requests.get(clientId);
    if (existing) return { ...existing, clientId, roomId, senderId: uid, kind, state: 'normal' as const };
    const result = { messageId: `message-${clientId}`, clientId, roomId, senderId: uid, kind, state: 'normal' as const };
    requests.set(clientId, { messageId: result.messageId });
    return result;
  },
  getMediaMetadata: async () => ({ contentType: 'image/png', size: 100 }),
};

const memberRequest: AuthenticatedRequest = {
  auth: { uid: 'user-1' },
  data: { roomId: 'room-1', clientId: 'client-1', kind: 'text', text: 'hello' },
};

describe('message contracts', () => {
  it('creates one canonical message and replays duplicate clientId', async () => {
    const first = await createMessageHandler(memberRequest, deps);
    const second = await createMessageHandler(memberRequest, deps);

    expect(first.messageId).toBeTypeOf('string');
    expect(second).toEqual(first);
  });

  it('rejects unauthenticated message creation', async () => {
    await expect(createMessageHandler({ ...memberRequest, auth: null }, deps)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('rejects media finalization when storage path does not match request identity', async () => {
    await expect(finalizeMediaMessageHandler({
      auth: { uid: 'user-1' },
      data: {
        roomId: 'room-1',
        clientId: 'client-1',
        kind: 'image',
        storagePath: 'rooms/room-1/media/other-user/client-1/original',
        mimeType: 'image/png',
        sizeBytes: 100,
      },
    }, deps)).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
