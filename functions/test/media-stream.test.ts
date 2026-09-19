import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { streamSha256 } from '../src/media-stream';

describe('streaming media checksum', () => {
  it('computes SHA-256 without buffering whole media', async () => {
    await expect(streamSha256(Readable.from([Buffer.from('image')]))).resolves.toBe('sha256:6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d');
  });

  it('propagates read stream failure', async () => {
    const stream = Readable.from((async function* () { yield Buffer.from('partial'); throw new Error('stream failure'); })());
    await expect(streamSha256(stream)).rejects.toThrow('stream failure');
  });

  it('processes a multi-megabyte chunked fixture incrementally', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 7);
    const expectedHash = createHash('sha256');
    for (let index = 0; index < 4; index += 1) expectedHash.update(chunk);
    await expect(streamSha256(Readable.from([chunk, chunk, chunk, chunk]))).resolves.toBe(`sha256:${expectedHash.digest('hex')}`);
  });
});
