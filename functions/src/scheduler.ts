import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { selectExpiredStagingObjects, type StagingObject } from './cleanup';
import { cleanupOrphanFinalizedMedia, recoverExpiredClientRequests, RECOVERY_BATCH_SIZE, FINALIZED_MEDIA_BATCH_SIZE } from './index';
import { FIREBASE_REGION } from './deployment';

const positiveMs = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export type SchedulerConfig = {
  region: typeof FIREBASE_REGION;
  recoverySchedule: string;
  stagingSchedule: string;
  finalizedSchedule: string;
  requestLeaseMs: number;
  stagingTtlMs: number;
  finalizedGraceMs: number;
};

export function schedulerConfigFor(environment: NodeJS.ProcessEnv = process.env): SchedulerConfig {
  return {
    region: FIREBASE_REGION,
    recoverySchedule: environment.REQUEST_RECOVERY_SCHEDULE ?? 'every 5 minutes',
    stagingSchedule: environment.STAGING_CLEANUP_SCHEDULE ?? 'every 1 hours',
    finalizedSchedule: environment.FINALIZED_MEDIA_CLEANUP_SCHEDULE ?? 'every 1 hours',
    requestLeaseMs: positiveMs(environment.REQUEST_LEASE_MS, 60_000),
    stagingTtlMs: positiveMs(environment.STAGING_TTL_MS, 86_400_000),
    finalizedGraceMs: positiveMs(environment.FINALIZED_MEDIA_GRACE_MS, 86_400_000),
  };

}

const config = schedulerConfigFor();
const retryConfig = { retryCount: 3, maxRetrySeconds: 3_600 };

export async function cleanupStagingObjects(now = new Date(), ttlMs = config.stagingTtlMs): Promise<{ deleted: string[]; failures: string[] }> {
  const db = getFirestore();
  const bucket = getStorage().bucket();
  const [files, nextQuery] = await bucket.getFiles({ prefix: 'rooms/', maxResults: FINALIZED_MEDIA_BATCH_SIZE });
  if (nextQuery?.pageToken) logger.info({ event: 'staging_cleanup_continuation', pageToken: nextQuery.pageToken });
  const objects: StagingObject[] = [];
  for (const file of files) {
    const match = /^rooms\/([^/]+)\/staging\/([^/]+)\/([^/]+)\/original$/.exec(file.name);
    if (!match) continue;
    const [metadata] = await file.getMetadata();
    objects.push({ path: file.name, roomId: match[1], uid: match[2], clientId: match[3], createdAt: String(metadata.timeCreated ?? new Date().toISOString()) });
  }
  const candidates = selectExpiredStagingObjects(objects, now, ttlMs);
  const deleted: string[] = [];
  const failures: string[] = [];
  for (const object of candidates) {
    const requestId = requireRequestId(object.roomId, object.clientId);
    const request = await db.doc(`rooms/${object.roomId}/clientRequests/${requestId}`).get();
    if (request.exists) {
      const data = request.data() as { uid?: string; roomId?: string; clientId?: string; state?: string };
      if (data.uid !== object.uid || data.roomId !== object.roomId || data.clientId !== object.clientId) {
        logger.error({ event: 'staging_cleanup_identity_mismatch', path: object.path });
        failures.push(object.path);
        continue;
      }
      if (['reserved', 'processing', 'committed'].includes(String(data.state))) continue;
    }
    try {
      await bucket.file(object.path).delete();
      deleted.push(object.path);
      logger.info({ event: 'staging_object_deleted', path: object.path, requestId });
    } catch (error) {
      failures.push(object.path);
      logger.error({ event: 'staging_object_delete_failed', path: object.path, requestId, error });
    }
  }
  if (failures.length > 0) throw new Error(`Staging cleanup failed for ${failures.length} object(s)`);
  return { deleted, failures };
}

function requireRequestId(roomId: string, clientId: string): string {
  return createHash('sha256').update(`${roomId}\0${clientId}`).digest('hex');
}

export const recoverExpiredClientRequestsScheduled = onSchedule({ region: config.region, schedule: config.recoverySchedule, ...retryConfig }, async () => {
  const stateRef = getFirestore().doc('maintenance/scheduler-recovery');
  const state = await stateRef.get();
  const cursor = typeof state.data()?.cursor === 'string' ? state.data()?.cursor as string : undefined;
  const result = await recoverExpiredClientRequests(new Date(), cursor);
  await stateRef.set({ cursor: result.nextCursor, updatedAt: new Date(), processed: result.paths.length });
  logger.info({ event: 'client_request_recovery_completed', count: result.paths.length, nextCursor: result.nextCursor, batchSize: RECOVERY_BATCH_SIZE, environment: process.env.APP_ENV ?? 'production' });
});

export const cleanupStagingObjectsScheduled = onSchedule({ region: config.region, schedule: config.stagingSchedule, ...retryConfig }, async () => {
  const result = await cleanupStagingObjects();
  logger.info({ event: 'staging_cleanup_completed', ...result, environment: process.env.APP_ENV ?? 'production' });
});

export const cleanupOrphanFinalizedMediaScheduled = onSchedule({ region: config.region, schedule: config.finalizedSchedule, ...retryConfig }, async () => {
  const paths = await cleanupOrphanFinalizedMedia();
  logger.info({ event: 'finalized_media_cleanup_completed', count: paths.length, batchSize: FINALIZED_MEDIA_BATCH_SIZE, environment: process.env.APP_ENV ?? 'production' });
});
