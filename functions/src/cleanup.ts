export type RequestState = 'reserved' | 'processing' | 'committed' | 'failed' | 'expired';

export type CleanupRequest = {
  id: string;
  state: RequestState;
  leaseUntil?: string;
};

export type FinalizedMedia = { path: string; messageId: string };

export function recoverExpiredClientRequests(requests: CleanupRequest[], now: Date): CleanupRequest[] {
  return requests.filter(request => {
    if (!['reserved', 'processing', 'failed'].includes(request.state)) return false;
    return request.leaseUntil != null && new Date(request.leaseUntil).getTime() <= now.getTime();
  });
}

export function cleanupOrphanFinalizedMedia(media: FinalizedMedia[], referencedMessageIds: Set<string>): FinalizedMedia[] {
  return media.filter(item => !referencedMessageIds.has(item.messageId));
}

export async function compensateCopiedObjects(paths: string[], remove: (path: string) => Promise<void>): Promise<{ failedPaths: string[] }> {
  const failedPaths: string[] = [];
  for (const path of paths) {
    try { await remove(path); } catch { failedPaths.push(path); }
  }
  return { failedPaths };
}
