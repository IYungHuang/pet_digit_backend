export type MessageKind = 'text' | 'image' | 'video';
export type MessageState = 'normal' | 'deleted';

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
  media?: Record<string, unknown> | null;
};

export type MessageDeltaType = 'message.added' | 'message.modified' | 'message.removed';
export type MessageDelta = {
  schemaVersion: 1;
  type: MessageDeltaType;
  roomId: string;
  messageId: string;
  clientId: string;
  message: CanonicalMessage;
};

export function toMessageDelta(change: 'added' | 'modified' | 'removed', message: CanonicalMessage): MessageDelta {
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
