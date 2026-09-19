import { describe, expect, it } from 'vitest';
import { cleanupOrphanFinalizedMedia, compensateCopiedObjects, recoverExpiredClientRequests, type CleanupRequest, type FinalizedMedia } from '../src/cleanup';

describe('request and media cleanup selection', () => {
  it('recovers only expired non-terminal requests', () => {
    const now = new Date('2026-09-19T00:00:00.000Z');
    const requests: CleanupRequest[] = [
      { id: 'expired-reserved', state: 'reserved', leaseUntil: '2026-09-18T23:00:00.000Z' },
      { id: 'active-processing', state: 'processing', leaseUntil: '2026-09-19T01:00:00.000Z' },
      { id: 'failed', state: 'failed', leaseUntil: '2026-09-18T23:00:00.000Z' },
      { id: 'committed', state: 'committed', leaseUntil: '2026-09-18T23:00:00.000Z' },
    ];
    expect(recoverExpiredClientRequests(requests, now).map(request => request.id)).toEqual(['expired-reserved', 'failed']);
  });

  it('selects only unreferenced finalized media', () => {
    const media: FinalizedMedia[] = [
      { path: 'rooms/r/media/orphan/original', messageId: 'orphan' },
      { path: 'rooms/r/media/active/original', messageId: 'active' },
      { path: 'rooms/r/media/committed/original', messageId: 'committed' },
    ];
    expect(cleanupOrphanFinalizedMedia(media, new Set(['active', 'committed'])).map(item => item.messageId)).toEqual(['orphan']);
  });

  it('records compensation delete failures for later cleanup', async () => {
    const result = await compensateCopiedObjects(['deleted', 'stuck'], async path => {
      if (path === 'stuck') throw new Error('emulator delete failure');
    });
    expect(result.failedPaths).toEqual(['stuck']);
  });
});
