import { getApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall, onRequest, type CallableRequest } from 'firebase-functions/v2/https';

try { getApp(); } catch { initializeApp(); }

export type AuthenticatedRequest = {
  auth: { uid: string } | null;
  data: Record<string, unknown>;
};

type MessageKind = 'text' | 'image' | 'video';
export type Dependencies = {
  isMember: (uid: string, roomId: string) => Promise<boolean>;
  getRequest: (uid: string, roomId: string, clientId: string) => Promise<{ messageId: string } | null>;
  commitMessage: (input: { uid: string; roomId: string; clientId: string; kind: MessageKind; text?: string; media?: Media }) => Promise<{ messageId: string; clientId: string; roomId: string; senderId: string; kind: MessageKind; state: 'normal' }>;
  getMediaMetadata: (storagePath: string) => Promise<{ contentType?: string; size?: number }>;
};

type Media = { storagePath: string; mimeType: string; sizeBytes: number; fileName?: string; durationMs?: number; checksum?: string };

const MAX_BYTES = 52_428_800;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime']);

type ErrorCode = 'invalid-argument' | 'unauthenticated' | 'permission-denied';

function fail(code: ErrorCode, message: string): never {
  throw new HttpsError(code, message);
}

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
  const serverOwned = ['senderId', 'messageId', 'state', 'createdAt', 'updatedAt'];
  if (serverOwned.some(field => field in data) || (data.message !== undefined)) fail('invalid-argument', 'Server-owned message fields are not accepted');
}

async function authorizeMember(uid: string, roomId: string, deps: Dependencies): Promise<void> {
  if (!(await deps.isMember(uid, roomId))) fail('permission-denied', 'Room membership required');
}

function validateMediaPath(path: string, roomId: string, uid: string, clientId: string): void {
  const expected = `rooms/${roomId}/media/${uid}/${clientId}/original`;
  if (path !== expected) fail('invalid-argument', 'Invalid staging storage path');
}

function firestoreDependencies(): Dependencies {
  const db = getFirestore();
  return {
    isMember: async (uid, roomId) => (await db.doc(`rooms/${roomId}/members/${uid}`).get()).exists,
    getRequest: async (uid, roomId, clientId) => {
      const snapshot = await db.doc(`rooms/${roomId}/clientRequests/${clientId}`).get();
      return snapshot.exists ? snapshot.data() as { messageId: string } : null;
    },
    commitMessage: async ({ uid, roomId, clientId, kind, text, media }) => {
      const requestRef = db.doc(`rooms/${roomId}/clientRequests/${clientId}`);
      const messageRef = db.collection(`rooms/${roomId}/messages`).doc();
      const result = { messageId: messageRef.id, clientId, roomId, senderId: uid, kind, state: 'normal' as const };
      await db.runTransaction(async transaction => {
        const existing = await transaction.get(requestRef);
        if (existing.exists) return;
        transaction.set(requestRef, { uid, roomId, clientId, messageId: messageRef.id, state: 'committed', createdAt: FieldValue.serverTimestamp() });
        transaction.set(messageRef, { ...result, text: text ?? null, media: media ?? null, clientCreatedAt: Timestamp.now(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), schemaVersion: 1 });
      });
      const committed = await requestRef.get();
      return { ...result, messageId: committed.data()?.messageId ?? messageRef.id };
    },
    getMediaMetadata: async storagePath => {
      const [file] = await getStorage().bucket().file(storagePath).getMetadata();
      return { contentType: file.contentType, size: Number(file.size) };
    },
  };
}

export async function createMessageHandler(request: AuthenticatedRequest, deps: Dependencies = firestoreDependencies()) {
  const uid = requireAuth(request);
  rejectClientOwnedFields(request.data);
  const roomId = requiredString(request.data, 'roomId');
  const clientId = requiredString(request.data, 'clientId');
  const kind = request.data.kind;
  if (kind !== 'text' && kind !== 'image' && kind !== 'video') fail('invalid-argument', 'Unsupported message kind');
  await authorizeMember(uid, roomId, deps);
  const existing = await deps.getRequest(uid, roomId, clientId);
  if (existing) return { messageId: existing.messageId, clientId, roomId, senderId: uid, kind, state: 'normal' as const };
  if (kind === 'text' && (typeof request.data.text !== 'string' || request.data.text.length === 0)) fail('invalid-argument', 'text is required');
  return deps.commitMessage({ uid, roomId, clientId, kind, text: request.data.text as string | undefined });
}

export async function finalizeMediaMessageHandler(request: AuthenticatedRequest, deps: Dependencies = firestoreDependencies()) {
  const uid = requireAuth(request);
  const roomId = requiredString(request.data, 'roomId');
  const clientId = requiredString(request.data, 'clientId');
  const storagePath = requiredString(request.data, 'storagePath');
  const mimeType = requiredString(request.data, 'mimeType');
  const sizeBytes = request.data.sizeBytes;
  if (!MIME_TYPES.has(mimeType) || typeof sizeBytes !== 'number' || sizeBytes < 0 || sizeBytes > MAX_BYTES) fail('invalid-argument', 'Invalid media metadata');
  validateMediaPath(storagePath, roomId, uid, clientId);
  await authorizeMember(uid, roomId, deps);
  const existing = await deps.getRequest(uid, roomId, clientId);
  if (existing) return { messageId: existing.messageId, clientId, roomId, senderId: uid, kind: mimeType.startsWith('video/') ? 'video' as const : 'image' as const, state: 'normal' as const };
  const metadata = await deps.getMediaMetadata(storagePath);
  if (metadata.contentType !== mimeType || metadata.size !== sizeBytes) fail('invalid-argument', 'Storage metadata mismatch');
  return deps.commitMessage({ uid, roomId, clientId, kind: mimeType.startsWith('video/') ? 'video' : 'image', media: { storagePath, mimeType, sizeBytes } });
}

export const healthCheck = onRequest((_request, response) => { response.status(200).json({ ok: true, emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST) }); });
export const createMessage = onCall((request: CallableRequest<Record<string, unknown>>) => createMessageHandler({ auth: request.auth ? { uid: request.auth.uid } : null, data: request.data }));
export const finalizeMediaMessage = onCall((request: CallableRequest<Record<string, unknown>>) => finalizeMediaMessageHandler({ auth: request.auth ? { uid: request.auth.uid } : null, data: request.data }));

export { MAX_BYTES };
