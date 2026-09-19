export type RequestState = 'reserved' | 'processing' | 'committed' | 'failed' | 'expired';

export type CleanupRequest = {
  id: string;
  state: RequestState;
  leaseUntil?: string;
};

export type FinalizedMedia = { path: string; messageId: string; createdAt: string };
export type StagingObject = { path: string; roomId: string; uid: string; clientId: string; createdAt: string };

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
