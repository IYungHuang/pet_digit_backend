const assert = require('node:assert/strict');
global.XMLHttpRequest = require('xhr2');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
require('firebase/compat/app');

require(path.join(__dirname, '../node_modules/firebase/firebase-firestore-compat.js'));
require(path.join(__dirname, '../node_modules/firebase/firebase-storage-compat.js'));

async function main() {
  const env = await initializeTestEnvironment({
    projectId: 'demo-pet-digit',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8') },
    storage: { rules: fs.readFileSync(path.join(__dirname, '../../storage.rules'), 'utf8') },
  });
  try {
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('rooms/room-1/members/user-1').set({ active: true });
    });

    const memberDb = env.authenticatedContext('user-1').firestore();
    await assert.rejects(
      memberDb.doc('rooms/room-1/messages/message-1').set({ text: 'client forged' }),
    );

    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('rooms/room-1/messages/message-1').set({ text: 'server message' });
    });
    await memberDb.doc('rooms/room-1/messages/message-1').get();

    const storage = env.authenticatedContext('user-1').storage();
    await assert.rejects(
      storage.ref('rooms/room-1/media/other-user/client-1/original').put(Buffer.from('x'), { contentType: 'image/png' }),
    );
    await assert.rejects(
      storage.ref('rooms/room-1/media/user-1/client-1/original').put(Buffer.alloc(52_428_801), { contentType: 'image/png' }),
    );
    console.log('Rules tests passed: Firestore canonical write denial, member read, Storage owner and size checks');
  } finally {
    await env.cleanup();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
