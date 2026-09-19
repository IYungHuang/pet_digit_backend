import { beforeEach, describe, expect, it } from 'vitest';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import { finalizeMediaMessageHandler } from '../src/index';
import { seedEmulatorFixture } from '../src/fixtures';

describe('Storage finalize integration', () => {
  const checksum = 'sha256:6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d';
  beforeEach(async () => {
    await seedEmulatorFixture();
    await getStorage().bucket().file('rooms/room-integration/staging/user-integration/finalize-client/original')
      .save(Buffer.from('image'), { metadata: { contentType: 'image/png', metadata: { fileName: 'image.png', checksum } } });
    await getStorage().bucket().file('rooms/room-integration/staging/user-integration/finalize-client/thumbnail')
      .save(Buffer.from('image'), { metadata: { contentType: 'image/png', metadata: { fileName: 'thumbnail.png', checksum } } });
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
        checksum,
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

  it('rejects client-owned thumbnail input', async () => {
    await expect(finalizeMediaMessageHandler({
      auth: { uid: 'user-integration' },
      data: {
        roomId: 'room-integration', clientId: 'finalize-client', kind: 'image',
        storagePath: 'rooms/room-integration/staging/user-integration/finalize-client/original',
        thumbnailStoragePath: 'rooms/room-integration/staging/user-integration/finalize-client/thumbnail',
        thumbnailChecksum: checksum, mimeType: 'image/png', sizeBytes: 5, fileName: 'image.png', checksum,
      },
    })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it.each([
    'rooms/foreign-room/staging/user-integration/finalize-client/thumbnail',
    'rooms/room-integration/staging/other-user/finalize-client/thumbnail',
    'rooms/room-integration/staging/user-integration/other-client/thumbnail',
  ])('rejects foreign thumbnail path %s', async thumbnailStoragePath => {
    await expect(finalizeMediaMessageHandler({
      auth: { uid: 'user-integration' },
      data: { roomId: 'room-integration', clientId: 'finalize-client', kind: 'image',
        storagePath: 'rooms/room-integration/staging/user-integration/finalize-client/original',
        thumbnailStoragePath, thumbnailChecksum: checksum, mimeType: 'image/png', sizeBytes: 5, fileName: 'image.png', checksum },
    })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects missing thumbnail object instead of copying arbitrary path', async () => {
    await expect(finalizeMediaMessageHandler({
      auth: { uid: 'user-integration' },
      data: { roomId: 'room-integration', clientId: 'missing-thumbnail', kind: 'image',
        storagePath: 'rooms/room-integration/staging/user-integration/finalize-client/original',
        thumbnailStoragePath: 'rooms/room-integration/staging/user-integration/missing-thumbnail/thumbnail',
        thumbnailChecksum: checksum, mimeType: 'image/png', sizeBytes: 5, fileName: 'image.png', checksum },
    })).rejects.toBeDefined();
  });

  it('rejects finalization for inactive members', async () => {
    await getStorage().bucket().file('rooms/room-integration/staging/user-integration/inactive-client/original')
      .save(Buffer.from('image'), { metadata: { contentType: 'image/png', metadata: { fileName: 'image.png', checksum } } });
    await getFirestore().doc('rooms/room-integration/members/user-integration').set({ active: false });
    await expect(finalizeMediaMessageHandler({
      auth: { uid: 'user-integration' },
      data: {
        roomId: 'room-integration', clientId: 'inactive-client', kind: 'image',
        storagePath: 'rooms/room-integration/staging/user-integration/inactive-client/original',
        mimeType: 'image/png', sizeBytes: 5, fileName: 'image.png', checksum,
      },
    })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects checksum that does not match backend-computed digest', async () => {
    await expect(finalizeMediaMessageHandler({
      auth: { uid: 'user-integration' },
      data: { roomId: 'room-integration', clientId: 'finalize-client', kind: 'image',
        storagePath: 'rooms/room-integration/staging/user-integration/finalize-client/original',
        mimeType: 'image/png', sizeBytes: 5, fileName: 'image.png', checksum: `sha256:${'0'.repeat(64)}` },
    })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects Storage filename metadata mismatch', async () => {
    await expect(finalizeMediaMessageHandler({
      auth: { uid: 'user-integration' },
      data: { roomId: 'room-integration', clientId: 'finalize-client', kind: 'image',
        storagePath: 'rooms/room-integration/staging/user-integration/finalize-client/original',
        mimeType: 'image/png', sizeBytes: 5, fileName: 'different.png', checksum },
    })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects unsupported checksum format before Storage access', async () => {
    await expect(finalizeMediaMessageHandler({
      auth: { uid: 'user-integration' },
      data: { roomId: 'room-integration', clientId: 'bad-checksum', kind: 'image',
        storagePath: 'rooms/room-integration/staging/user-integration/bad-checksum/original',
        mimeType: 'image/png', sizeBytes: 5, fileName: 'image.png', checksum: 'md5:abc' },
    })).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
