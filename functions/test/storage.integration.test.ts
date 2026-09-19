import { beforeEach, describe, expect, it } from 'vitest';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import { finalizeMediaMessageHandler } from '../src/index';
import { seedEmulatorFixture } from '../src/fixtures';

describe('Storage finalize integration', () => {
  beforeEach(async () => {
    await seedEmulatorFixture();
    await getStorage().bucket().file('rooms/room-integration/staging/user-integration/finalize-client/original')
      .save(Buffer.from('image'), { metadata: { contentType: 'image/png', metadata: { fileName: 'image.png', checksum: 'local-checksum' } } });
  });

  it('finalizes only a real staging object with matching metadata', async () => {
    const result = await finalizeMediaMessageHandler({
      auth: { uid: 'user-integration' },
      data: {
        roomId: 'room-integration',
        clientId: 'finalize-client',
        kind: 'image',
        storagePath: 'rooms/room-integration/staging/user-integration/finalize-client/original',
        mimeType: 'image/png',
        sizeBytes: 5,
        fileName: 'image.png',
        checksum: 'local-checksum',
      },
    });
    expect(result.kind).toBe('image');
    const [files] = await getStorage().bucket().getFiles({ prefix: 'rooms/room-integration/media/' });
    expect(files.map(file => file.name)).toContain(`rooms/room-integration/media/${result.messageId}/original`);
    await expect(getStorage().bucket().file('rooms/room-integration/staging/user-integration/finalize-client/original').exists()).resolves.toEqual([false]);
  });

  it('rejects an orphan finalize path with no upload object', async () => {
    await expect(finalizeMediaMessageHandler({
      auth: { uid: 'user-integration' },
      data: {
        roomId: 'room-integration',
        clientId: 'missing-client',
        kind: 'image',
        storagePath: 'rooms/room-integration/staging/user-integration/missing-client/original',
        mimeType: 'image/png',
        sizeBytes: 5,
        fileName: 'missing.png',
        checksum: 'missing-checksum',
      },
    })).rejects.toBeDefined();
  });

  it('rejects incomplete media metadata', async () => {
    await expect(finalizeMediaMessageHandler({
      auth: { uid: 'user-integration' },
      data: {
        roomId: 'room-integration', clientId: 'finalize-client-2', kind: 'image',
        storagePath: 'rooms/room-integration/staging/user-integration/finalize-client-2/original',
        mimeType: 'image/png', sizeBytes: 5,
      },
    })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects finalization for inactive members', async () => {
    await getStorage().bucket().file('rooms/room-integration/staging/user-integration/inactive-client/original')
      .save(Buffer.from('image'), { metadata: { contentType: 'image/png', metadata: { fileName: 'image.png', checksum: 'local-checksum' } } });
    await getFirestore().doc('rooms/room-integration/members/user-integration').set({ active: false });
    await expect(finalizeMediaMessageHandler({
      auth: { uid: 'user-integration' },
      data: {
        roomId: 'room-integration', clientId: 'inactive-client', kind: 'image',
        storagePath: 'rooms/room-integration/staging/user-integration/inactive-client/original',
        mimeType: 'image/png', sizeBytes: 5, fileName: 'image.png', checksum: 'local-checksum',
      },
    })).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
