import { describe, expect, it } from 'vitest';
import { normalizeCanonicalMessage, paginateMessages, toMessageDelta } from '../src/contracts';

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
      const input = change === 'removed' ? { ...message, state: 'deleted' as const } : message;
      expect(toMessageDelta(change, input)).toEqual({
        schemaVersion: 1,
        type: `message.${change}`,
        roomId: 'room-1',
        messageId: 'message-1',
        clientId: 'client-1',
        message: { ...input, media: null },
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

  it('normalizes Firestore timestamps and preserves additive media metadata', () => {
    const normalized = normalizeCanonicalMessage({
      ...message,
      kind: 'video',
      createdAt: { toDate: () => new Date('2026-09-19T04:00:00.000Z') },
      updatedAt: { toDate: () => new Date('2026-09-19T04:01:00.000Z') },
      media: { storagePath: 'rooms/r/media/m/original', thumbnailStoragePath: 'rooms/r/media/m/thumbnail', mimeType: 'video/mp4', sizeBytes: 12, fileName: 'clip.mp4', durationMs: 1234, checksum: 'sha' },
      unknownFutureField: 'keep-compatible',
    });
    expect(normalized.createdAt).toBe('2026-09-19T04:00:00.000Z');
    expect(normalized.updatedAt).toBe('2026-09-19T04:01:00.000Z');
    expect(normalized.media).toMatchObject({ fileName: 'clip.mp4', durationMs: 1234, checksum: 'sha' });
  });

  it('creates removed tombstone with canonical identity', () => {
    expect(toMessageDelta('removed', { ...message, state: 'deleted' })).toMatchObject({
      type: 'message.removed', messageId: 'message-1', clientId: 'client-1', message: { state: 'deleted' },
    });
  });

  it('rejects unsupported required schema versions', () => {
    expect(() => normalizeCanonicalMessage({ ...message, schemaVersion: 2 })).toThrow('Unsupported message schemaVersion');
  });
});
