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
});
