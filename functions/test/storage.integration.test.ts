import { beforeEach, describe, expect, it } from 'vitest';
import { getStorage } from 'firebase-admin/storage';
import { finalizeMediaMessageHandler } from '../src/index';
import { seedEmulatorFixture } from '../src/fixtures';

describe('Storage finalize integration', () => {
  beforeEach(async () => {
    await seedEmulatorFixture();
    await getStorage().bucket().file('rooms/room-integration/media/user-integration/finalize-client/original')
      .save(Buffer.from('image'), { metadata: { contentType: 'image/png' } });
  });

  it('finalizes only a real staging object with matching metadata', async () => {
    const result = await finalizeMediaMessageHandler({
      auth: { uid: 'user-integration' },
      data: {
        roomId: 'room-integration',
        clientId: 'finalize-client',
        kind: 'image',
        storagePath: 'rooms/room-integration/media/user-integration/finalize-client/original',
        mimeType: 'image/png',
        sizeBytes: 5,
      },
    });
    expect(result.kind).toBe('image');
  });

  it('rejects an orphan finalize path with no upload object', async () => {
    await expect(finalizeMediaMessageHandler({
      auth: { uid: 'user-integration' },
      data: {
        roomId: 'room-integration',
        clientId: 'missing-client',
        kind: 'image',
        storagePath: 'rooms/room-integration/media/user-integration/missing-client/original',
        mimeType: 'image/png',
        sizeBytes: 5,
      },
    })).rejects.toBeDefined();
  });
});
