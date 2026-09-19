export type RequestState = 'reserved' | 'processing' | 'committed' | 'failed' | 'expired';

export type CleanupRequest = {
  id: string;
  state: RequestState;
  leaseUntil?: string;
};

export type FinalizedMedia = { path: string; messageId: string; createdAt: string };
export type StagingObject = { path: string; roomId: string; uid: string; clientId: string; createdAt: string };

export async function runWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Concurrency limit must be positive');
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export function recoverExpiredClientRequests(requests: CleanupRequest[], now: Date): CleanupRequest[] {
  return requests.filter(request => {
    if (!['reserved', 'processing', 'failed'].includes(request.state)) return false;
    return request.leaseUntil != null && new Date(request.leaseUntil).getTime() <= now.getTime();
  });
}

export function cleanupOrphanFinalizedMedia(media: FinalizedMedia[], referencedMessageIds: Set<string>, now = new Date(), graceMs = 86_400_000): FinalizedMedia[] {
  return media.filter(item => !referencedMessageIds.has(item.messageId) && new Date(item.createdAt).getTime() + graceMs <= now.getTime());
}

export function selectExpiredStagingObjects(objects: StagingObject[], now: Date, ttlMs: number): StagingObject[] {
  return objects.filter(item => new Date(item.createdAt).getTime() + ttlMs <= now.getTime());
}

export async function compensateCopiedObjects(paths: string[], remove: (path: string) => Promise<void>): Promise<{ failedPaths: string[] }> {
  const failedPaths: string[] = [];
  for (const path of paths) {
    try { await remove(path); } catch { failedPaths.push(path); }
  }
  return { failedPaths };
}
