import { describe, expect, it } from 'vitest';
import {
  createMessageHandler,
  finalizeMediaMessageHandler,
  type Dependencies,
  type AuthenticatedRequest,
} from '../src/index';

const requests = new Map<string, { messageId: string; uid: string; roomId: string; clientId: string }>();
const deps: Dependencies = {
  isMember: async () => true,
  getRequest: async (uid, roomId, clientId) => {
    const request = requests.get(clientId);
    if (request && (request.uid !== uid || request.roomId !== roomId || request.clientId !== clientId)) {
      return request;
    }
    return request ?? null;
  },
  commitMessage: async ({ uid, roomId, clientId, kind }) => {
    const existing = requests.get(clientId);
    if (existing) return { messageId: existing.messageId, clientId, roomId, senderId: uid, kind, state: 'normal' as const };
    const result = { messageId: `message-${clientId}`, clientId, roomId, senderId: uid, kind, state: 'normal' as const };
    requests.set(clientId, { messageId: result.messageId, uid, roomId, clientId });
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

  it('rejects client-owned canonical fields', async () => {
    await expect(createMessageHandler({
      auth: { uid: 'user-1' },
      data: {
        roomId: 'room-1',
        clientId: 'client-owned-fields',
        kind: 'text',
        text: 'hello',
        senderId: 'forged-sender',
        state: 'deleted',
        createdAt: 'forged-created-at',
        updatedAt: 'forged-updated-at',
      },
    }, deps)).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects image and video through createMessage', async () => {
    for (const kind of ['image', 'video'] as const) {
      await expect(createMessageHandler({
        auth: { uid: 'user-1' },
        data: { roomId: 'room-1', clientId: `client-${kind}`, kind, media: { storagePath: 'staging' } },
      }, deps)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
  });

  it('rejects replay when another user reuses the same clientId', async () => {
    const request = { roomId: 'room-tenant', clientId: 'shared-client', kind: 'text' as const, text: 'private' };
    const first = await createMessageHandler({ auth: { uid: 'user-owner' }, data: request }, deps);
    expect(first.senderId).toBe('user-owner');
    await expect(createMessageHandler({ auth: { uid: 'user-other' }, data: request }, deps))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('returns one message when duplicate requests race', async () => {
    const request = { auth: { uid: 'user-race' }, data: { roomId: 'room-race', clientId: 'race-client', kind: 'text' as const, text: 'once' } };
    const results = await Promise.all([
      createMessageHandler(request, deps),
      createMessageHandler(request, deps),
    ]);
    expect(new Set(results.map(result => result.messageId)).size).toBe(1);
  });
});
