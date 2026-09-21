const assert = require('node:assert/strict');
global.XMLHttpRequest = require('xhr2');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
require('firebase/compat/app');

require(path.join(__dirname, '../node_modules/firebase/firebase-firestore-compat.js'));
// Storage compat is loaded lazily after Firestore context setup to avoid the
// Firebase 9 compat settings freeze before rules-unit-testing calls useEmulator.

async function main() {
  const env = await initializeTestEnvironment({
    projectId: 'demo-pet-digit',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8') },
    storage: { rules: fs.readFileSync(path.join(__dirname, '../../storage.rules'), 'utf8') },
  });
  try {
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.doc('rooms/room-1/members/user-1').set({ active: true });
      await db.doc('rooms/room-1/members/user-inactive').set({ active: false });
      await db.doc('rooms/room-1/messages/message-1').set({ text: 'server message' });
      await db.doc('searchTags/alpha').set({ uid: 'user-1' });
      await db.doc('users/user-1').set({ nickname: 'Alice' });
      await db.doc('users/user-1/pets/pet-1').set({ name: 'Bobby' });
    });

    const memberDb = env.authenticatedContext('user-1').firestore();
    const anonymousDb = env.unauthenticatedContext().firestore();
    const nonMemberDb = env.authenticatedContext('user-2').firestore();
    const inactiveDb = env.authenticatedContext('user-inactive').firestore();
    const missingMemberDb = env.authenticatedContext('missing-member').firestore();
    await assert.rejects(anonymousDb.doc('rooms/room-1/messages/message-1').get());
    await assert.rejects(nonMemberDb.doc('rooms/room-1/messages/message-1').get());
    await assert.rejects(missingMemberDb.doc('rooms/room-1/messages/message-1').get());
    await assert.rejects(inactiveDb.doc('rooms/room-1/messages/message-1').get());
    await assert.rejects(
      memberDb.doc('rooms/room-1/messages/message-1').set({ text: 'client forged' }),
    );
    await memberDb.doc('rooms/room-1/messages/message-1').get();

    // searchTags: signed-in can read, client write rejected, anonymous read rejected
    await memberDb.doc('searchTags/alpha').get();
    await assert.rejects(anonymousDb.doc('searchTags/alpha').get());
    await assert.rejects(memberDb.doc('searchTags/alpha').set({ uid: 'user-1' }));

    // users & pets: signed-in can read public profiles
    await nonMemberDb.doc('users/user-1').get();
    await nonMemberDb.doc('users/user-1/pets/pet-1').get();
    await assert.rejects(anonymousDb.doc('users/user-1').get());
    await assert.rejects(anonymousDb.doc('users/user-1/pets/pet-1').get());

    // users & pets: only owner can write
    await memberDb.doc('users/user-1').set({ nickname: 'Alice Updated' });
    await memberDb.doc('users/user-1/pets/pet-1').set({ name: 'Bobby Updated' });
    await assert.rejects(nonMemberDb.doc('users/user-1').set({ nickname: 'Hacked' }));
    await assert.rejects(nonMemberDb.doc('users/user-1/pets/pet-1').set({ name: 'Hacked' }));

    // roomSummaries: client write rejected (managed by Cloud Functions)
    await assert.rejects(memberDb.doc('users/user-1/roomSummaries/room-1').set({ unreadCount: 0 }));

    require(path.join(__dirname, '../node_modules/firebase/firebase-storage-compat.js'));

    const storage = env.authenticatedContext('user-1').storage();
    const inactiveStorage = env.authenticatedContext('user-inactive').storage();
    const anonymousStorage = env.unauthenticatedContext().storage();
    await assert.rejects(
      anonymousStorage.ref('rooms/room-1/staging/user-1/client-1/original').put(Buffer.from('x'), { contentType: 'image/png' }),
    );
    await assert.rejects(
      storage.ref('rooms/room-1/staging/other-user/client-1/original').put(Buffer.from('x'), { contentType: 'image/png' }),
    );
    await assert.rejects(
      storage.ref('rooms/room-1/staging/user-1/client-1/original').put(Buffer.from('x'), { contentType: 'application/octet-stream' }),
    );
    await assert.rejects(
      storage.ref('rooms/room-1/staging/user-1/client-1/original').put(Buffer.alloc(52_428_801), { contentType: 'image/png' }),
    );
    await assert.rejects(
      storage.ref('rooms/room-1/staging/user-1/client-1/thumbnail').put(Buffer.from('x'), { contentType: 'image/png' }),
    );
    await assert.rejects(
      inactiveStorage.ref('rooms/room-1/staging/user-inactive/client-1/original').put(Buffer.from('x'), { contentType: 'image/png' }),
    );
    await storage.ref('rooms/room-1/staging/user-1/client-1/original').put(Buffer.from('x'), { contentType: 'image/png' });
    await assert.rejects(storage.ref('rooms/room-1/staging/user-1/client-1/original').put(Buffer.from('overwrite'), { contentType: 'image/png' }));
    await assert.rejects(storage.ref('rooms/room-1/media/message-1/original').put(Buffer.from('x'), { contentType: 'image/png' }));
    await assert.rejects(storage.ref('rooms/room-1/media/message-1/original').delete());

    // pet-sprite-requests: owner-only source upload, no overwrite of generated frames
    await storage.ref('users/user-1/pet-sprite-requests/req-1/source/0').put(Buffer.from('x'), { contentType: 'image/jpeg' });
    await assert.rejects(
      anonymousStorage.ref('users/user-1/pet-sprite-requests/req-1/source/1').put(Buffer.from('x'), { contentType: 'image/jpeg' }),
    );
    await assert.rejects(
      storage.ref('users/other-user/pet-sprite-requests/req-1/source/0').put(Buffer.from('x'), { contentType: 'image/jpeg' }),
    );
    await assert.rejects(
      storage.ref('users/user-1/pet-sprite-requests/req-1/generated/corgi_idle_0.png').put(Buffer.from('x'), { contentType: 'image/png' }),
    );
    await storage.ref('users/user-1/pet-sprite-requests/req-1/source/0').getDownloadURL();

    console.log('Rules tests passed: auth, active membership, canonical writes, original-only Storage owner/MIME/size/delete checks, searchTags/users/pets/roomSummaries rules, pet-sprite-requests owner-only source/generated rules');
  } finally {
    await env.cleanup();
  }
}

main().then(() => process.exit(0)).catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
