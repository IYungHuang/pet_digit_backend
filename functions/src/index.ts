import { createHash } from 'node:crypto';
import { getApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall, onRequest, type CallableRequest } from 'firebase-functions/v2/https';
import { normalizeCanonicalMessage, type MediaContract, type MessageKind } from './contracts';

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
  state?: 'reserved' | 'committed';
  response?: MessageResult;
};
export type StorageMetadata = {
  contentType?: string;
  size?: number;
  md5Hash?: string;
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
  return !(environment.FIRESTORE_EMULATOR_HOST || environment.FIREBASE_AUTH_EMULATOR_HOST || environment.FIREBASE_STORAGE_EMULATOR_HOST);
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
async function waitForReplay(read: () => Promise<StoredRequest | null>): Promise<MessageResult> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const request = await read();
    if (request?.response) return request.response;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  fail('failed-precondition', 'Request finalization timed out; retry');
}
function replayOrReject(existing: StoredRequest, uid: string, roomId: string, clientId: string): MessageResult {
  if (!requestMatches(existing, uid, roomId, clientId)) fail('permission-denied', 'Idempotency request identity mismatch');
  return existing.response ?? { messageId: existing.messageId, clientId, roomId, senderId: uid, kind: 'text', state: 'normal' };
}
function validateStagingPath(path: string, roomId: string, uid: string, clientId: string): void {
  if (path !== `rooms/${roomId}/staging/${uid}/${clientId}/original`) fail('invalid-argument', 'Invalid staging storage path');
}
function validateMediaInput(data: Record<string, unknown>): Media {
  const mimeType = requiredString(data, 'mimeType');
  const sizeBytes = data.sizeBytes;
  const fileName = requiredString(data, 'fileName');
  const checksum = requiredString(data, 'checksum');
  if (!MIME_TYPES.has(mimeType) || typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_BYTES) fail('invalid-argument', 'Invalid media metadata');
  if (data.durationMs != null && (typeof data.durationMs !== 'number' || !Number.isInteger(data.durationMs) || data.durationMs < 0)) fail('invalid-argument', 'Invalid durationMs');
  if (data.thumbnailStoragePath != null && typeof data.thumbnailStoragePath !== 'string') fail('invalid-argument', 'Invalid thumbnailStoragePath');
  return { storagePath: requiredString(data, 'storagePath'), mimeType, sizeBytes, fileName, checksum, durationMs: data.durationMs as number | undefined, thumbnailStoragePath: data.thumbnailStoragePath as string | undefined };
}

function canonicalResponse(snapshot: DocumentSnapshot): MessageResult {
  return normalizeCanonicalMessage({ ...snapshot.data(), messageId: snapshot.id }) as MessageResult;
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
      const [file] = await getStorage().bucket().file(storagePath).getMetadata();
      return { contentType: file.contentType, size: Number(file.size), md5Hash: file.md5Hash, metadata: file.metadata as Record<string, string | undefined> | undefined };
    },
    commitMessage: async ({ uid, roomId, clientId, kind, text, media }) => {
      const requestRef = requestRefFor(roomId, clientId);
      const messageRef = db.collection(`rooms/${roomId}/messages`).doc();
      let existing: StoredRequest | null = null;
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(requestRef);
        existing = snapshot.exists ? snapshot.data() as StoredRequest : null;
        if (existing) return;
        transaction.create(requestRef, { uid, roomId, clientId, messageId: messageRef.id, state: 'reserved', createdAt: FieldValue.serverTimestamp() });
      });
      if (existing) {
        return waitForReplay(() => readRequest(uid, roomId, clientId));
      }
      if (media) {
        const finalPath = `rooms/${roomId}/media/${messageRef.id}/original`;
        await getStorage().bucket().file(media.storagePath).copy(getStorage().bucket().file(finalPath));
        if (media.thumbnailStoragePath) {
          await getStorage().bucket().file(media.thumbnailStoragePath).copy(getStorage().bucket().file(`rooms/${roomId}/media/${messageRef.id}/thumbnail`));
        }
        await getStorage().bucket().file(media.storagePath).delete();
        const finalizedMedia: Media = { ...media, storagePath: finalPath };
        if (media.thumbnailStoragePath) finalizedMedia.thumbnailStoragePath = `rooms/${roomId}/media/${messageRef.id}/thumbnail`;
        if (media.durationMs == null) delete finalizedMedia.durationMs;
        if (!media.thumbnailStoragePath) delete finalizedMedia.thumbnailStoragePath;
        media = finalizedMedia;
      }
      await db.runTransaction(async transaction => {
        const message = { messageId: messageRef.id, clientId, roomId, senderId: uid, kind, state: 'normal' as const, text: text ?? null, media: media ?? null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), schemaVersion: 1 };
        transaction.create(messageRef, message);
        transaction.update(requestRef, { state: 'committed' });
      });
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
  if (existing) return replayOrReject(existing, uid, roomId, clientId);
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
  if (existing) return replayOrReject(existing, uid, roomId, clientId);
  const metadata = await deps.getMediaMetadata(media.storagePath);
  const storedChecksum = metadata.metadata?.checksum ?? metadata.md5Hash;
  if (metadata.contentType !== media.mimeType || metadata.size !== media.sizeBytes || (storedChecksum && storedChecksum !== media.checksum)) fail('invalid-argument', 'Storage metadata mismatch');
  return deps.commitMessage({ uid, roomId, clientId, kind: expectedKind, media });
}

const callOptions = { enforceAppCheck: appCheckEnforcementFor() };
export const healthCheck = onRequest((_request, response) => { response.status(200).json({ ok: true, emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST) }); });
export const createMessage = onCall(callOptions, (request: CallableRequest<Record<string, unknown>>) => createMessageHandler({ auth: request.auth ? { uid: request.auth.uid } : null, data: request.data }));
export const finalizeMediaMessage = onCall(callOptions, (request: CallableRequest<Record<string, unknown>>) => finalizeMediaMessageHandler({ auth: request.auth ? { uid: request.auth.uid } : null, data: request.data }));
