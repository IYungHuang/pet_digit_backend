import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { hasTransparentBackground, normalizeFrame, TARGET_FRAME_SIZE } from '../src/pet-sprite-postprocess';

async function makePng(alpha: number): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 200, g: 100, b: 50, alpha } },
  })
    .png()
    .toBuffer();
}

describe('hasTransparentBackground', () => {
  it('returns false for a fully opaque image', async () => {
    const opaque = await makePng(1);
    expect(await hasTransparentBackground(opaque)).toBe(false);
  });

  it('returns true for an image with transparent pixels', async () => {
    const transparent = await makePng(0);
    expect(await hasTransparentBackground(transparent)).toBe(true);
  });
});

describe('normalizeFrame', () => {
  it('resizes any input to the target square canvas with alpha', async () => {
    const source = await makePng(1);
    const normalized = await normalizeFrame(source);
    const metadata = await sharp(normalized).metadata();
    expect(metadata.width).toBe(TARGET_FRAME_SIZE);
    expect(metadata.height).toBe(TARGET_FRAME_SIZE);
    expect(metadata.hasAlpha).toBe(true);
  });
});
