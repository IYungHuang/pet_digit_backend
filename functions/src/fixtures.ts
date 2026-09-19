import { getFirestore } from 'firebase-admin/firestore';

export type EmulatorFixture = {
  projectId: 'demo-pet-digit';
  users: Array<{ uid: string }>;
  room: { roomId: string };
  members: Array<{ uid: string }>;
  messages: Array<{ messageId: string; clientId: string; kind: 'text' | 'image' | 'video'; roomId: string; senderId: string; state: 'normal'; schemaVersion: 1; media?: Record<string, unknown> }>;
};

export function emulatorFixture(): EmulatorFixture {
  return {
    projectId: 'demo-pet-digit',
    users: [{ uid: 'user-integration' }, { uid: 'user-second' }],
    room: { roomId: 'room-integration' },
    members: [{ uid: 'user-integration' }],
    messages: [
      { messageId: 'fixture-text', clientId: 'fixture-text-client', kind: 'text', roomId: 'room-integration', senderId: 'user-integration', state: 'normal', schemaVersion: 1 },
      { messageId: 'fixture-image', clientId: 'fixture-image-client', kind: 'image', roomId: 'room-integration', senderId: 'user-integration', state: 'normal', schemaVersion: 1, media: { storagePath: 'rooms/room-integration/media/user-integration/fixture-image-client/original', mimeType: 'image/png', sizeBytes: 100 } },
      { messageId: 'fixture-video', clientId: 'fixture-video-client', kind: 'video', roomId: 'room-integration', senderId: 'user-integration', state: 'normal', schemaVersion: 1, media: { storagePath: 'rooms/room-integration/media/user-integration/fixture-video-client/original', mimeType: 'video/mp4', sizeBytes: 100 } },
    ],
  };
}

export async function seedEmulatorFixture(): Promise<EmulatorFixture> {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Fixture seed requires FIRESTORE_EMULATOR_HOST');
  const fixture = emulatorFixture();
  const db = getFirestore();
  for (const collectionPath of [`rooms/${fixture.room.roomId}/messages`, `rooms/${fixture.room.roomId}/clientRequests`]) {
    const documents = await db.collection(collectionPath).listDocuments();
    if (documents.length > 0) {
      const batch = db.batch();
      documents.forEach(document => batch.delete(document));
      await batch.commit();
    }
  }
  await db.doc(`rooms/${fixture.room.roomId}`).set({ roomId: fixture.room.roomId, name: 'Local fixture room' });
  await Promise.all(fixture.users.map(user => db.doc(`users/${user.uid}`).set({ uid: user.uid })));
  await Promise.all(fixture.members.map(member => db.doc(`rooms/${fixture.room.roomId}/members/${member.uid}`).set({ active: true })));
  await Promise.all(fixture.messages.map(message => db.doc(`rooms/${fixture.room.roomId}/messages/${message.messageId}`).set({ ...message, createdAt: new Date(), updatedAt: new Date() })));
  return fixture;
}
