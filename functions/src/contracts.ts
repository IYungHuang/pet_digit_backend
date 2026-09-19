export type MessageKind = 'text' | 'image' | 'video';
export type MessageState = 'normal' | 'deleted';

export type MediaContract = {
  storagePath: string;
  thumbnailStoragePath?: string | null;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  durationMs?: number | null;
  checksum: string;
  [key: string]: unknown;
};

export type CanonicalMessage = {
  messageId: string;
  clientId: string;
  roomId: string;
  senderId: string;
  kind: MessageKind;
  state: MessageState;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
  text?: string | null;
  media?: MediaContract | null;
  [key: string]: unknown;
};

export type MessageDeltaType = 'message.added' | 'message.modified' | 'message.removed';
export type MessageDelta = {
  schemaVersion: 1;
  type: MessageDeltaType;
  roomId: string;
  messageId: string;
  clientId: string;
  message: CanonicalMessage;
  [key: string]: unknown;
};

function isoTimestamp(value: unknown, field: string): string {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${field}`);
    return date.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error(`Invalid ${field}`);
    return date.toISOString();
  }
  if (value && typeof value === 'object' && 'seconds' in value && 'nanoseconds' in value) {
    const seconds = Number(value.seconds);
    const nanoseconds = Number(value.nanoseconds);
    if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) throw new Error(`Invalid ${field}`);
    return new Date(seconds * 1000 + nanoseconds / 1_000_000).toISOString();
  }
  throw new Error(`Invalid ${field}`);
}

export function normalizeCanonicalMessage(input: Record<string, unknown>): CanonicalMessage {
  if (input.schemaVersion !== 1) throw new Error('Unsupported message schemaVersion');
  for (const field of ['messageId', 'clientId', 'roomId', 'senderId']) {
    if (typeof input[field] !== 'string' || input[field].length === 0) throw new Error(`Invalid ${field}`);
  }
  if (!['text', 'image', 'video'].includes(String(input.kind))) throw new Error('Invalid message kind');
  if (!['normal', 'deleted'].includes(String(input.state))) throw new Error('Invalid message state');
  const media = input.media == null ? null : normalizeMedia(input.media);
  if (input.kind === 'text' && media !== null) throw new Error('Text message cannot contain media');
  if (input.kind !== 'text' && media === null && input.state !== 'deleted') throw new Error('Media message requires media');
  return {
    ...input,
    messageId: input.messageId as string,
    clientId: input.clientId as string,
    roomId: input.roomId as string,
    senderId: input.senderId as string,
    kind: input.kind as MessageKind,
    state: input.state as MessageState,
    createdAt: isoTimestamp(input.createdAt, 'createdAt'),
    updatedAt: isoTimestamp(input.updatedAt, 'updatedAt'),
    schemaVersion: 1,
    media,
  };
}

function normalizeMedia(input: unknown): MediaContract {
  if (!input || typeof input !== 'object') throw new Error('Invalid media');
  const media = input as Record<string, unknown>;
  for (const field of ['storagePath', 'mimeType', 'fileName', 'checksum']) {
    if (typeof media[field] !== 'string' || media[field].length === 0) throw new Error(`Invalid media.${field}`);
  }
  if (typeof media.sizeBytes !== 'number' || media.sizeBytes < 0) throw new Error('Invalid media.sizeBytes');
  if (media.durationMs != null && (typeof media.durationMs !== 'number' || media.durationMs < 0)) throw new Error('Invalid media.durationMs');
  if (media.thumbnailStoragePath != null && typeof media.thumbnailStoragePath !== 'string') throw new Error('Invalid media.thumbnailStoragePath');
  if (!String(media.storagePath).startsWith('rooms/') || String(media.storagePath).includes('staging/')) throw new Error('Media must use finalized storage path');
  return media as MediaContract;
}

export function toMessageDelta(change: 'added' | 'modified' | 'removed', input: CanonicalMessage): MessageDelta {
  const message = normalizeCanonicalMessage(input);
  if (change === 'removed' && message.state !== 'deleted') throw new Error('Removed delta requires deleted tombstone');
  return {
    schemaVersion: 1,
    type: `message.${change}` as MessageDeltaType,
    roomId: message.roomId,
    messageId: message.messageId,
    clientId: message.clientId,
    message,
  };
}

export type PaginationResponse<T> = { items: T[]; nextCursor: string | null; hasMore: boolean };

export function paginateMessages<T>(items: T[], nextCursor: string | null, hasMore: boolean): PaginationResponse<T> {
  return { items, nextCursor, hasMore };
}
