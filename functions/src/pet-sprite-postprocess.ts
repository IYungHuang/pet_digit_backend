import sharp from 'sharp';

export const TARGET_FRAME_SIZE = 128;

export async function hasTransparentBackground(buffer: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels < 4) return false;
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i] < 250) return true;
  }
  return false;
}

export async function normalizeFrame(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(TARGET_FRAME_SIZE, TARGET_FRAME_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .png()
    .toBuffer();
}
