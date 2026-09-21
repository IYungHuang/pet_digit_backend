import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  generatePetSpritesHandler,
  regeneratePetSpriteFrameHandler,
  type SpriteGenerationDependencies,
} from '../src/pet-sprite-generation';

async function makePng(alpha: number): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 20, b: 30, alpha } } })
    .png()
    .toBuffer();
}

function buildDeps(overrides: Partial<SpriteGenerationDependencies> = {}): SpriteGenerationDependencies {
  return {
    apiKey: 'test-key',
    readSourcePhotos: vi.fn().mockResolvedValue([
      { mimeType: 'image/jpeg', base64Data: 'aaa' },
      { mimeType: 'image/jpeg', base64Data: 'bbb' },
      { mimeType: 'image/jpeg', base64Data: 'ccc' },
    ]),
    writeGeneratedFrame: vi.fn().mockResolvedValue('https://example.com/frame.png'),
    generateImage: vi.fn(),
    readGeneratedFrame: vi.fn().mockResolvedValue(null),
    claimRequestLock: vi.fn().mockResolvedValue(true),
    releaseRequestLock: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('generatePetSpritesHandler', () => {
  it('rejects unauthenticated callers', async () => {
    const deps = buildDeps({ generateImage: vi.fn().mockResolvedValue(await makePng(1)) });
    await expect(
      generatePetSpritesHandler({ auth: null, data: { requestId: 'r1', petType: 'corgi' } }, deps),
    ).rejects.toThrowError(/Authentication required/);
  });

  it('rejects when fewer than 3 source photos are available', async () => {
    const deps = buildDeps({ readSourcePhotos: vi.fn().mockResolvedValue([{ mimeType: 'image/jpeg', base64Data: 'aaa' }]) });
    await expect(
      generatePetSpritesHandler({ auth: { uid: 'user-1' }, data: { requestId: 'r1', petType: 'corgi' } }, deps),
    ).rejects.toThrowError(/Exactly 3 source photos/);
  });

  it('generates exactly 20 frames for corgi and marks opaque frames as needing review', async () => {
    const deps = buildDeps({ generateImage: vi.fn().mockResolvedValue(await makePng(1)) });
    const result = await generatePetSpritesHandler(
      { auth: { uid: 'user-1' }, data: { requestId: 'r1', petType: 'corgi' } },
      deps,
    );
    expect(result.frames).toHaveLength(20);
    expect(deps.generateImage).toHaveBeenCalledTimes(20);
    expect(result.frames[0].filename).toBe('corgi_idle_0.png');
    expect(result.frames.every((f) => f.needsReview)).toBe(true);
  });

  it('does not flag transparent frames as needing review', async () => {
    const deps = buildDeps({ generateImage: vi.fn().mockResolvedValue(await makePng(0)) });
    const result = await generatePetSpritesHandler(
      { auth: { uid: 'user-1' }, data: { requestId: 'r1', petType: 'parrot' } },
      deps,
    );
    expect(result.frames.every((f) => !f.needsReview)).toBe(true);
  });

  it('passes the action frame-0 result as an extra reference for later frames in that action', async () => {
    const deps = buildDeps({ generateImage: vi.fn().mockResolvedValue(await makePng(1)) });
    await generatePetSpritesHandler({ auth: { uid: 'user-1' }, data: { requestId: 'r1', petType: 'corgi' } }, deps);
    const calls = (deps.generateImage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].firstFrameReference).toBeUndefined();
    expect(calls[1][0].firstFrameReference).toBeDefined();
  });

  it('keeps generating remaining frames and reports an error entry when one frame fails', async () => {
    const generateImage = vi
      .fn()
      .mockRejectedValueOnce(new Error('gemini exploded'))
      .mockResolvedValue(await makePng(1));
    const deps = buildDeps({ generateImage });
    const result = await generatePetSpritesHandler(
      { auth: { uid: 'user-1' }, data: { requestId: 'r1', petType: 'corgi' } },
      deps,
    );
    expect(result.frames).toHaveLength(20);
    expect(result.frames[0]).toMatchObject({ filename: 'corgi_idle_0.png', error: 'gemini exploded' });
    expect(result.frames[0].downloadUrl).toBeUndefined();
    expect(result.frames[1].error).toBeUndefined();
    expect(generateImage).toHaveBeenCalledTimes(20);
  });

  it('rejects a concurrent call for the same requestId while one is in progress', async () => {
    const deps = buildDeps({
      generateImage: vi.fn().mockResolvedValue(await makePng(1)),
      claimRequestLock: vi.fn().mockResolvedValue(false),
    });
    await expect(
      generatePetSpritesHandler({ auth: { uid: 'user-1' }, data: { requestId: 'r1', petType: 'corgi' } }, deps),
    ).rejects.toThrowError(/already in progress/);
    expect(deps.generateImage).not.toHaveBeenCalled();
  });

  it('releases the request lock even when a frame throws', async () => {
    const deps = buildDeps({ generateImage: vi.fn().mockRejectedValue(new Error('boom')) });
    await generatePetSpritesHandler({ auth: { uid: 'user-1' }, data: { requestId: 'r1', petType: 'corgi' } }, deps);
    expect(deps.releaseRequestLock).toHaveBeenCalledWith('user-1_r1');
  });
});

describe('regeneratePetSpriteFrameHandler', () => {
  it('regenerates exactly the requested frame', async () => {
    const deps = buildDeps({ generateImage: vi.fn().mockResolvedValue(await makePng(0)) });
    const result = await regeneratePetSpriteFrameHandler(
      { auth: { uid: 'user-1' }, data: { requestId: 'r1', petType: 'cat', action: 'stalk', index: 2 } },
      deps,
    );
    expect(result.filename).toBe('cat_stalk_2.png');
    expect(deps.generateImage).toHaveBeenCalledTimes(1);
  });

  it('rejects an action/index combo outside the manifest', async () => {
    const deps = buildDeps({ generateImage: vi.fn().mockResolvedValue(await makePng(0)) });
    await expect(
      regeneratePetSpriteFrameHandler(
        { auth: { uid: 'user-1' }, data: { requestId: 'r1', petType: 'cat', action: 'stalk', index: 99 } },
        deps,
      ),
    ).rejects.toThrow();
  });

  it('fetches the action frame-0 as a style anchor when regenerating a non-zero frame', async () => {
    const readGeneratedFrame = vi.fn().mockResolvedValue({ mimeType: 'image/png', base64Data: 'anchor' });
    const deps = buildDeps({ generateImage: vi.fn().mockResolvedValue(await makePng(0)), readGeneratedFrame });
    await regeneratePetSpriteFrameHandler(
      { auth: { uid: 'user-1' }, data: { requestId: 'r1', petType: 'cat', action: 'stalk', index: 2 } },
      deps,
    );
    expect(readGeneratedFrame).toHaveBeenCalledWith('user-1', 'r1', 'cat_stalk_0.png');
    const call = (deps.generateImage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.firstFrameReference).toEqual({ mimeType: 'image/png', base64Data: 'anchor' });
  });

  it('does not fetch a style anchor when regenerating frame 0 itself', async () => {
    const readGeneratedFrame = vi.fn().mockResolvedValue({ mimeType: 'image/png', base64Data: 'anchor' });
    const deps = buildDeps({ generateImage: vi.fn().mockResolvedValue(await makePng(0)), readGeneratedFrame });
    await regeneratePetSpriteFrameHandler(
      { auth: { uid: 'user-1' }, data: { requestId: 'r1', petType: 'cat', action: 'stalk', index: 0 } },
      deps,
    );
    expect(readGeneratedFrame).not.toHaveBeenCalled();
  });

  it('rejects a concurrent regenerate for the same frame while one is in progress', async () => {
    const deps = buildDeps({
      generateImage: vi.fn().mockResolvedValue(await makePng(0)),
      claimRequestLock: vi.fn().mockResolvedValue(false),
    });
    await expect(
      regeneratePetSpriteFrameHandler(
        { auth: { uid: 'user-1' }, data: { requestId: 'r1', petType: 'cat', action: 'stalk', index: 2 } },
        deps,
      ),
    ).rejects.toThrowError(/already in progress/);
  });
});
