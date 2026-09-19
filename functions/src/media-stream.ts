import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export async function streamSha256(readable: Readable): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(readable, hash);
  return `sha256:${hash.digest('hex')}`;
}
