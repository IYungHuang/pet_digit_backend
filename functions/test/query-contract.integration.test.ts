import { beforeEach, describe, expect, it } from 'vitest';
import { getFirestore } from 'firebase-admin/firestore';
import { emulatorFixture, seedEmulatorFixture } from '../src/fixtures';
import { messageQuerySpec, decodeMessageCursor, encodeMessageCursor } from '../src/query-contract';
import { writeMessageTombstone } from '../src/index';

describe('backend query contract', () => {
  beforeEach(async () => { await seedEmulatorFixture(); });

  it('uses bounded createdAt plus document-id ordering', async () => {
    const spec = messageQuerySpec('room-integration', 2);
    const snapshot = await getFirestore().collection(spec.path)
      .orderBy('createdAt', 'asc').orderBy('__name__', 'asc').limit(spec.limit).get();
    expect(snapshot.size).toBe(2);
    expect(spec.limit).toBe(2);
  });

  it('round-trips opaque cursor and tombstone fixture contract', async () => {
    const fixture = emulatorFixture();
    const cursor = encodeMessageCursor({ createdAt: '2026-09-19T00:00:00.000Z', messageId: fixture.messages[0].messageId });
    expect(decodeMessageCursor(cursor)).toEqual({ createdAt: '2026-09-19T00:00:00.000Z', messageId: 'fixture-text' });
    await getFirestore().doc('rooms/room-integration/messages/deleted-message').set({
      messageId: 'deleted-message', clientId: 'deleted-client', roomId: 'room-integration', senderId: 'user-integration',
      kind: 'text', state: 'normal', text: 'remove me', media: null, schemaVersion: 1,
      createdAt: new Date('2026-09-19T00:00:00.000Z'), updatedAt: new Date('2026-09-19T00:00:00.000Z'),
    });
    await writeMessageTombstone({ auth: { uid: 'user-integration' }, data: { roomId: 'room-integration', messageId: 'deleted-message' } });
    const tombstone = await getFirestore().doc('rooms/room-integration/messages/deleted-message').get();
    expect(tombstone.data()?.state).toBe('deleted');
  });
});
