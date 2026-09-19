import { describe, expect, it } from 'vitest';
import { cleanupOrphanFinalizedMedia, compensateCopiedObjects, recoverExpiredClientRequests, runWithConcurrency, selectExpiredStagingObjects, type CleanupRequest, type FinalizedMedia, type StagingObject } from '../src/cleanup';

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
      { path: 'rooms/r/media/orphan/original', messageId: 'orphan', createdAt: '2026-09-18T00:00:00.000Z' },
      { path: 'rooms/r/media/active/original', messageId: 'active', createdAt: '2026-09-18T00:00:00.000Z' },
      { path: 'rooms/r/media/committed/original', messageId: 'committed', createdAt: '2026-09-18T00:00:00.000Z' },
    ];
    expect(cleanupOrphanFinalizedMedia(media, new Set(['active', 'committed']), new Date('2026-09-19T00:00:00.000Z'), 86_400_000).map(item => item.messageId)).toEqual(['orphan']);
    expect(cleanupOrphanFinalizedMedia(media, new Set(), new Date('2026-09-18T01:00:00.000Z'), 86_400_000)).toEqual([]);
  });

  it('selects only expired request-scoped staging objects', () => {
    const objects: StagingObject[] = [
      { path: 'rooms/r/staging/u/c/original', roomId: 'r', uid: 'u', clientId: 'c', createdAt: '2026-09-18T00:00:00.000Z' },
      { path: 'rooms/r/staging/u/active/original', roomId: 'r', uid: 'u', clientId: 'active', createdAt: '2026-09-19T00:00:00.000Z' },
    ];
    expect(selectExpiredStagingObjects(objects, new Date('2026-09-19T00:59:00.000Z'), 3_600_000).map(item => item.clientId)).toEqual(['c']);
  });

  it('records compensation delete failures for later cleanup', async () => {
    const result = await compensateCopiedObjects(['deleted', 'stuck'], async path => {
      if (path === 'stuck') throw new Error('emulator delete failure');
    });
    expect(result.failedPaths).toEqual(['stuck']);
  });

  it('limits cleanup task concurrency', async () => {
    let active = 0;
    let peak = 0;
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async value => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return value;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
