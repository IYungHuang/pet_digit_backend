import { describe, expect, it } from 'vitest';
import { paginateMessages, toMessageDelta } from '../src/contracts';

const message = {
  messageId: 'message-1',
  clientId: 'client-1',
  roomId: 'room-1',
  senderId: 'user-1',
  kind: 'text' as const,
  state: 'normal' as const,
  createdAt: '2026-09-19T04:00:00.000Z',
  updatedAt: '2026-09-19T04:00:00.000Z',
  schemaVersion: 1,
};

describe('message sync contract', () => {
  it('emits transport-neutral deltas without DocumentChange', () => {
    for (const change of ['added', 'modified', 'removed'] as const) {
      expect(toMessageDelta(change, message)).toEqual({
        schemaVersion: 1,
        type: `message.${change}`,
        roomId: 'room-1',
        messageId: 'message-1',
        clientId: 'client-1',
        message,
      });
    }
  });

  it('builds bounded pagination response with opaque cursor', () => {
    expect(paginateMessages([message], 'cursor-2', true)).toEqual({
      items: [message],
      nextCursor: 'cursor-2',
      hasMore: true,
    });
  });
});
