export type MessageCursor = { createdAt: string; messageId: string };

export function messageQuerySpec(roomId: string, limit = 50): { path: string; limit: number; orderBy: ['createdAt', '__name__'] } {
  if (!roomId || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid bounded message query');
  return { path: `rooms/${roomId}/messages`, limit, orderBy: ['createdAt', '__name__'] };
}

export function encodeMessageCursor(cursor: MessageCursor): string {
  if (!cursor.createdAt || !cursor.messageId) throw new Error('Invalid message cursor');
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeMessageCursor(value: string): MessageCursor {
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as MessageCursor;
    if (!cursor.createdAt || !cursor.messageId || Number.isNaN(new Date(cursor.createdAt).getTime())) throw new Error('Invalid message cursor');
    return cursor;
  } catch { throw new Error('Invalid message cursor'); }
}
