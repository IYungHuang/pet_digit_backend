import { createHash } from 'node:crypto';
import { getApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall, onRequest, type CallableRequest } from 'firebase-functions/v2/https';
import { normalizeCanonicalMessage, type MediaContract, type MessageKind } from './contracts';
import { compensateCopiedObjects, cleanupOrphanFinalizedMedia as selectOrphanFinalizedMedia, recoverExpiredClientRequests as selectExpiredRequests, type RequestState } from './cleanup';

try { getApp(); } catch { initializeApp(); }

export type AuthenticatedRequest = { auth: { uid: string } | null; data: Record<string, unknown> };
export type Media = {
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  durationMs?: number;
  checksum: string;
  thumbnailStoragePath?: string;
  thumbnailChecksum?: string;
};
export type MessageResult = {
  messageId: string;
  clientId: string;
  roomId: string;
  senderId: string;
  kind: MessageKind;
  state: 'normal' | 'deleted';
  createdAt?: string;
  updatedAt?: string;
  schemaVersion?: 1;
  text?: string | null;
  media?: MediaContract | null;
};
export type StoredRequest = {
  messageId: string;
  uid?: string;
  roomId?: string;
  clientId?: string;
  state?: RequestState;
  createdAt?: unknown;
  updatedAt?: unknown;
  leaseUntil?: unknown;
  cleanupPaths?: string[];
  cleanupRequired?: boolean;
  response?: MessageResult;
};
export type StorageMetadata = {
  contentType?: string;
  size?: number;
  md5Hash?: string;
  sha256?: string;
  metadata?: Record<string, string | undefined>;
};
export type Dependencies = {
  isMember: (uid: string, roomId: string) => Promise<boolean>;
  getRequest: (uid: string, roomId: string, clientId: string) => Promise<StoredRequest | null>;
  commitMessage: (input: { uid: string; roomId: string; clientId: string; kind: MessageKind; text?: string; media?: Media }) => Promise<MessageResult>;
  getMediaMetadata: (storagePath: string) => Promise<StorageMetadata>;
};

export const MAX_BYTES = 52_428_800;
export const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime']);
type ErrorCode = 'invalid-argument' | 'unauthenticated' | 'permission-denied' | 'failed-precondition';

export function appCheckEnforcementFor(environment: NodeJS.ProcessEnv = process.env): boolean {
  const hosts = [environment.FIREBASE_AUTH_EMULATOR_HOST, environment.FIRESTORE_EMULATOR_HOST, environment.FIREBASE_STORAGE_EMULATOR_HOST];
  const loopback = (value: string | undefined): boolean => {
    if (!value) return false;
    const host = value.replace(/^\[|\]$/g, '').split(':')[0];
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  };
  const localBypass = environment.APP_ENV === 'emulator' && environment.APP_CHECK_MODE === 'bypass' &&
    (environment.GCLOUD_PROJECT ?? '').startsWith('demo-') && hosts.every(loopback) && environment.NODE_ENV !== 'production';
  return !localBypass;
}

export function appCheckAcceptedFor(environment: NodeJS.ProcessEnv, tokenIsValid: boolean): boolean {
  return !appCheckEnforcementFor(environment) || tokenIsValid;
}

function fail(code: ErrorCode, message: string): never { throw new HttpsError(code, message); }
function requireAuth(request: AuthenticatedRequest): string {
  if (!request.auth?.uid) fail('unauthenticated', 'Authentication required');
  return request.auth.uid;
}
function requiredString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) fail('invalid-argument', `${key} is required`);
  return value;
}
function rejectClientOwnedFields(data: Record<string, unknown>): void {
  if (['senderId', 'messageId', 'state', 'createdAt', 'updatedAt'].some(field => field in data) || data.message !== undefined) {
    fail('invalid-argument', 'Server-owned message fields are not accepted');
  }
}
async function authorizeMember(uid: string, roomId: string, deps: Dependencies): Promise<void> {
  if (!(await deps.isMember(uid, roomId))) fail('permission-denied', 'Active room membership required');
}
function requestDocumentId(roomId: string, clientId: string): string {
  return createHash('sha256').update(`${roomId}\0${clientId}`).digest('hex');
}
function requestMatches(request: StoredRequest, uid: string, roomId: string, clientId: string): boolean {
  return request.uid === uid && request.roomId === roomId && request.clientId === clientId;
}
function replayOrReject(existing: StoredRequest, uid: string, roomId: string, clientId: string): MessageResult {
  if (!requestMatches(existing, uid, roomId, clientId)) fail('permission-denied', 'Idempotency request identity mismatch');
  if (existing.state == null || existing.state === 'committed') {
    if (existing.response) return existing.response;
    return { messageId: existing.messageId, clientId, roomId, senderId: uid, kind: 'text', state: 'normal' };
  }
  fail('failed-precondition', 'Request is active or awaiting recovery; retry later');
}
function validateStagingPath(path: string, roomId: string, uid: string, clientId: string): void {
  if (path !== `rooms/${roomId}/staging/${uid}/${clientId}/original`) fail('invalid-argument', 'Invalid staging storage path');
}
function validateThumbnailPath(path: string, roomId: string, uid: string, clientId: string): void {
  if (path !== `rooms/${roomId}/staging/${uid}/${clientId}/thumbnail`) fail('invalid-argument', 'Invalid thumbnail storage path');
}
function validateSha256(value: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) fail('invalid-argument', 'Checksum must use sha256:<hex> format');
}
function validateMediaInput(data: Record<string, unknown>): Media {
  const mimeType = requiredString(data, 'mimeType');
  const sizeBytes = data.sizeBytes;
  const fileName = requiredString(data, 'fileName');
  const checksum = requiredString(data, 'checksum');
  validateSha256(checksum);
  if (!MIME_TYPES.has(mimeType) || typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_BYTES) fail('invalid-argument', 'Invalid media metadata');
  if (data.durationMs != null && (typeof data.durationMs !== 'number' || !Number.isInteger(data.durationMs) || data.durationMs < 0)) fail('invalid-argument', 'Invalid durationMs');
  if (data.thumbnailStoragePath != null && typeof data.thumbnailStoragePath !== 'string') fail('invalid-argument', 'Invalid thumbnailStoragePath');
  const media: Media = { storagePath: requiredString(data, 'storagePath'), mimeType, sizeBytes, fileName, checksum };
  if (data.durationMs != null) media.durationMs = data.durationMs as number;
  if (data.thumbnailStoragePath != null) {
    const thumbnailChecksum = requiredString(data, 'thumbnailChecksum');
    validateSha256(thumbnailChecksum);
    media.thumbnailStoragePath = data.thumbnailStoragePath as string;
    media.thumbnailChecksum = thumbnailChecksum;
  }
  return media;
}

function canonicalResponse(snapshot: DocumentSnapshot): MessageResult {
  return normalizeCanonicalMessage({ ...snapshot.data(), messageId: snapshot.id }) as MessageResult;
}
function validateStoredMetadata(metadata: StorageMetadata, expectedMime: string | undefined, expectedSize: number | undefined, expectedChecksum: string, expectedFileName?: string): void {
  if (!metadata.contentType || !MIME_TYPES.has(metadata.contentType) || (expectedMime && metadata.contentType !== expectedMime) ||
    metadata.size == null || metadata.size > MAX_BYTES || (expectedSize != null && metadata.size !== expectedSize) ||
    !metadata.sha256 || metadata.sha256 !== expectedChecksum ||
    (expectedFileName && metadata.metadata?.fileName && metadata.metadata.fileName !== expectedFileName)) {
    fail('invalid-argument', 'Storage metadata mismatch');
  }
}

function firestoreDependencies(): Dependencies {
  const db = getFirestore();
  const requestRefFor = (roomId: string, clientId: string) => db.doc(`rooms/${roomId}/clientRequests/${requestDocumentId(roomId, clientId)}`);
  const readRequest = async (uid: string, roomId: string, clientId: string): Promise<StoredRequest | null> => {
    const snapshot = await requestRefFor(roomId, clientId).get();
    if (!snapshot.exists) return null;
    const request = snapshot.data() as StoredRequest;
    if (!requestMatches(request, uid, roomId, clientId)) fail('permission-denied', 'Idempotency request identity mismatch');
    if (request.response) return request;
    const message = await db.doc(`rooms/${roomId}/messages/${request.messageId}`).get();
    return message.exists ? { ...request, response: canonicalResponse(message) } : request;
  };
  return {
    isMember: async (uid, roomId) => (await db.doc(`rooms/${roomId}/members/${uid}`).get()).data()?.active === true,
    getRequest: readRequest,
    getMediaMetadata: async storagePath => {
      const object = getStorage().bucket().file(storagePath);
      const [file] = await object.getMetadata();
      const [contents] = await object.download();
      return {
        contentType: file.contentType,
        size: Number(file.size),
        sha256: `sha256:${createHash('sha256').update(contents).digest('hex')}`,
        md5Hash: file.md5Hash,
        metadata: file.metadata as Record<string, string | undefined> | undefined,
      };
    },
    commitMessage: async ({ uid, roomId, clientId, kind, text, media }) => {
      const requestRef = requestRefFor(roomId, clientId);
      let messageRef = db.collection(`rooms/${roomId}/messages`).doc();
      let existing: StoredRequest | null = null;
      let claim: 'new' | 'claimed' | 'active' | 'committed' | undefined;
      const now = Date.now();
      const leaseUntil = new Date(now + 60_000);
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(requestRef);
        existing = snapshot.exists ? snapshot.data() as StoredRequest : null;
        if (!existing) {
          transaction.create(requestRef, { uid, roomId, clientId, messageId: messageRef.id, state: 'reserved', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), leaseUntil: Timestamp.fromDate(leaseUntil) });
          claim = 'new';
          return;
        }
        if (!requestMatches(existing, uid, roomId, clientId)) fail('permission-denied', 'Idempotency request identity mismatch');
        if (existing.state === 'committed') { claim = 'committed'; return; }
        const activeLease = existing.leaseUntil instanceof Timestamp ? existing.leaseUntil.toMillis() > now : typeof existing.leaseUntil === 'string' && new Date(existing.leaseUntil).getTime() > now;
        if (activeLease && existing.state !== 'failed' && existing.state !== 'expired') { claim = 'active'; return; }
        transaction.update(requestRef, { state: 'processing', updatedAt: FieldValue.serverTimestamp(), leaseUntil: Timestamp.fromDate(leaseUntil) });
        claim = 'claimed';
      });
      if (claim === 'committed') {
        const replay = await readRequest(uid, roomId, clientId);
        if (replay?.response) return replay.response;
        fail('failed-precondition', 'Committed request has no canonical message');
      }
      if (claim === 'active') {
        fail('failed-precondition', 'Request is already processing');
      }
      const reservedMessageId = (existing as StoredRequest | null)?.messageId;
      if (reservedMessageId) messageRef = db.doc(`rooms/${roomId}/messages/${reservedMessageId}`);
      if (claim === 'new') {
        await db.runTransaction(async transaction => {
          const reservation = await transaction.get(requestRef);
          if (!reservation.exists) fail('failed-precondition', 'Request reservation disappeared');
          const value = reservation.data() as StoredRequest;
          if (!requestMatches(value, uid, roomId, clientId)) fail('permission-denied', 'Idempotency request identity mismatch');
          transaction.update(requestRef, { state: 'processing', updatedAt: FieldValue.serverTimestamp(), leaseUntil: Timestamp.fromDate(leaseUntil) });
        });
      }
      const copiedPaths: string[] = [];
      let stagingPath: string | undefined;
      if (media) {
        stagingPath = media.storagePath;
        const finalPath = `rooms/${roomId}/media/${messageRef.id}/original`;
        try {
          await getStorage().bucket().file(media.storagePath).copy(getStorage().bucket().file(finalPath));
          copiedPaths.push(finalPath);
          if (media.thumbnailStoragePath) {
            const finalThumbnail = `rooms/${roomId}/media/${messageRef.id}/thumbnail`;
            await getStorage().bucket().file(media.thumbnailStoragePath).copy(getStorage().bucket().file(finalThumbnail));
            copiedPaths.push(finalThumbnail);
          }
        } catch (error) {
          const compensation = await compensateCopiedObjects(copiedPaths, async path => { await getStorage().bucket().file(path).delete(); });
          await db.doc(requestRef.path).update({ state: 'failed', updatedAt: FieldValue.serverTimestamp(), leaseUntil: null, cleanupPaths: compensation.failedPaths, cleanupRequired: compensation.failedPaths.length > 0 });
          throw error;
        }
        const finalizedMedia: Media = { ...media, storagePath: finalPath };
        if (media.thumbnailStoragePath) finalizedMedia.thumbnailStoragePath = `rooms/${roomId}/media/${messageRef.id}/thumbnail`;
        if (media.durationMs == null) delete finalizedMedia.durationMs;
        if (!media.thumbnailStoragePath) {
          delete finalizedMedia.thumbnailStoragePath;
          delete finalizedMedia.thumbnailChecksum;
        }
        delete finalizedMedia.thumbnailChecksum;
        media = finalizedMedia;
      }
      try {
        await db.runTransaction(async transaction => {
          const message = { messageId: messageRef.id, clientId, roomId, senderId: uid, kind, state: 'normal' as const, text: text ?? null, media: media ?? null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), schemaVersion: 1 };
          transaction.create(messageRef, message);
          transaction.update(requestRef, { state: 'committed', updatedAt: FieldValue.serverTimestamp(), leaseUntil: null, cleanupRequired: false });
        });
      } catch (error) {
        const compensation = await compensateCopiedObjects(copiedPaths, async path => { await getStorage().bucket().file(path).delete(); });
        await requestRef.update({ state: 'failed', updatedAt: FieldValue.serverTimestamp(), leaseUntil: null, cleanupPaths: compensation.failedPaths, cleanupRequired: compensation.failedPaths.length > 0 });
        throw error;
      }
      if (stagingPath) await getStorage().bucket().file(stagingPath).delete().catch(() => undefined);
      return canonicalResponse(await messageRef.get());
    },
  };
}

export async function createMessageHandler(request: AuthenticatedRequest, deps: Dependencies = firestoreDependencies()): Promise<MessageResult> {
  const uid = requireAuth(request);
  rejectClientOwnedFields(request.data);
  const roomId = requiredString(request.data, 'roomId');
  const clientId = requiredString(request.data, 'clientId');
  if (request.data.kind !== 'text') fail('invalid-argument', 'createMessage accepts text only');
  if (request.data.media !== undefined) fail('invalid-argument', 'Media requires finalizeMediaMessage');
  if (typeof request.data.text !== 'string' || request.data.text.length === 0) fail('invalid-argument', 'text is required');
  await authorizeMember(uid, roomId, deps);
  const existing = await deps.getRequest(uid, roomId, clientId);
  if (existing && (existing.state == null || existing.state === 'committed')) return replayOrReject(existing, uid, roomId, clientId);
  if (existing && !requestMatches(existing, uid, roomId, clientId)) fail('permission-denied', 'Idempotency request identity mismatch');
  return deps.commitMessage({ uid, roomId, clientId, kind: 'text', text: request.data.text });
}

export async function finalizeMediaMessageHandler(request: AuthenticatedRequest, deps: Dependencies = firestoreDependencies()): Promise<MessageResult> {
  const uid = requireAuth(request);
  const roomId = requiredString(request.data, 'roomId');
  const clientId = requiredString(request.data, 'clientId');
  const media = validateMediaInput(request.data);
  validateStagingPath(media.storagePath, roomId, uid, clientId);
  const expectedKind: MessageKind = media.mimeType.startsWith('video/') ? 'video' : 'image';
  if (request.data.kind != null && request.data.kind !== expectedKind) fail('invalid-argument', 'Media kind does not match MIME');
  await authorizeMember(uid, roomId, deps);
  const existing = await deps.getRequest(uid, roomId, clientId);
  if (existing && (existing.state == null || existing.state === 'committed')) return replayOrReject(existing, uid, roomId, clientId);
  if (existing && !requestMatches(existing, uid, roomId, clientId)) fail('permission-denied', 'Idempotency request identity mismatch');
  const metadata = await deps.getMediaMetadata(media.storagePath);
  validateStoredMetadata(metadata, media.mimeType, media.sizeBytes, media.checksum, media.fileName);
  if (media.thumbnailStoragePath) {
    validateThumbnailPath(media.thumbnailStoragePath, roomId, uid, clientId);
    const thumbnail = await deps.getMediaMetadata(media.thumbnailStoragePath);
    validateStoredMetadata(thumbnail, undefined, undefined, media.thumbnailChecksum ?? '');
  }
  return deps.commitMessage({ uid, roomId, clientId, kind: expectedKind, media });
}

export async function writeMessageTombstone(request: AuthenticatedRequest): Promise<MessageResult> {
  const uid = requireAuth(request);
  const roomId = requiredString(request.data, 'roomId');
  const messageId = requiredString(request.data, 'messageId');
  const deps = firestoreDependencies();
  await authorizeMember(uid, roomId, deps);
  const ref = getFirestore().doc(`rooms/${roomId}/messages/${messageId}`);
  await getFirestore().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) fail('invalid-argument', 'Message not found');
    transaction.update(ref, { state: 'deleted', updatedAt: FieldValue.serverTimestamp() });
  });
  return canonicalResponse(await ref.get());
}

export async function recoverExpiredClientRequests(now = new Date()): Promise<string[]> {
  const db = getFirestore();
  const snapshot = await db.collectionGroup('clientRequests').get();
  const candidates = snapshot.docs.filter(document => {
    const request = document.data() as StoredRequest;
    const lease = request.leaseUntil instanceof Timestamp ? request.leaseUntil.toDate().toISOString() : typeof request.leaseUntil === 'string' ? request.leaseUntil : undefined;
    return selectExpiredRequests([{ id: document.ref.path, state: request.state ?? 'reserved', leaseUntil: lease }], now).length === 1;
  });
  await Promise.all(candidates.map(document => document.ref.update({ state: 'expired', updatedAt: FieldValue.serverTimestamp(), leaseUntil: null })));
  return candidates.map(document => document.ref.path);
}

export async function cleanupOrphanFinalizedMedia(): Promise<string[]> {
  const db = getFirestore();
  const bucket = getStorage().bucket();
  const [files] = await bucket.getFiles({ prefix: 'rooms/' });
  const media = files.flatMap(file => {
    const match = /^rooms\/([^/]+)\/media\/([^/]+)\/(original|thumbnail)$/.exec(file.name);
    return match ? [{ file, path: file.name, messageId: match[2], roomId: match[1] }] : [];
  });
  const protectedIds = new Set<string>();
  await Promise.all(media.map(async item => {
    if ((await db.doc(`rooms/${item.roomId}/messages/${item.messageId}`).get()).exists) protectedIds.add(item.messageId);
    const requests = await db.collectionGroup('clientRequests').where('messageId', '==', item.messageId).get();
    if (requests.docs.some(request => ['reserved', 'processing', 'committed'].includes(String(request.data().state)))) protectedIds.add(item.messageId);
  }));
  const orphans = selectOrphanFinalizedMedia(media, protectedIds);
  await Promise.all(orphans.map(item => bucket.file(item.path).delete()));
  return orphans.map(item => item.path);
}

const callOptions = { enforceAppCheck: appCheckEnforcementFor() };
export const healthCheck = onRequest((_request, response) => { response.status(200).json({ ok: true, emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST) }); });
export const createMessage = onCall(callOptions, (request: CallableRequest<Record<string, unknown>>) => createMessageHandler({ auth: request.auth ? { uid: request.auth.uid } : null, data: request.data }));
export const finalizeMediaMessage = onCall(callOptions, (request: CallableRequest<Record<string, unknown>>) => finalizeMediaMessageHandler({ auth: request.auth ? { uid: request.auth.uid } : null, data: request.data }));
export const removeMessage = onCall(callOptions, (request: CallableRequest<Record<string, unknown>>) => writeMessageTombstone({ auth: request.auth ? { uid: request.auth.uid } : null, data: request.data }));
