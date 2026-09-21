import { HttpsError } from 'firebase-functions/v2/https';

export type PetType = 'corgi' | 'cat' | 'parrot';

export type FrameSpec = {
  action: string;
  index: number;
  filename: string;
};

const ACTION_COUNTS_BY_TYPE: Record<PetType, Array<[action: string, count: number]>> = {
  corgi: [
    ['idle', 4],
    ['walk', 4],
    ['run', 2],
    ['jump', 2],
    ['observe', 2],
    ['novel_probe', 6],
  ],
  cat: [
    ['idle', 4],
    ['walk', 4],
    ['run', 2],
    ['jump', 2],
    ['observe', 2],
    ['stalk', 4],
    ['paw_test', 6],
  ],
  parrot: [
    ['idle', 4],
    ['walk', 4],
    ['run', 2],
    ['jump', 2],
    ['observe', 2],
    ['novel_probe', 6],
  ],
};

function buildManifestFor(petType: PetType): FrameSpec[] {
  return ACTION_COUNTS_BY_TYPE[petType].flatMap(([action, count]) =>
    Array.from({ length: count }, (_, index) => ({
      action,
      index,
      filename: `${petType}_${action}_${index}.png`,
    })),
  );
}

export const FRAME_MANIFEST: Record<PetType, FrameSpec[]> = {
  corgi: buildManifestFor('corgi'),
  cat: buildManifestFor('cat'),
  parrot: buildManifestFor('parrot'),
};

export function validatePetType(value: unknown): PetType {
  if (value === 'corgi' || value === 'cat' || value === 'parrot') {
    return value;
  }
  throw new HttpsError('invalid-argument', 'petType must be one of corgi, cat, parrot');
}

export function validateRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new HttpsError('invalid-argument', 'requestId must be a non-empty alphanumeric string up to 64 characters');
  }
  return value;
}

export function validateFrameSpec(petType: PetType, action: unknown, index: unknown): FrameSpec {
  const spec = FRAME_MANIFEST[petType].find((frame) => frame.action === action && frame.index === index);
  if (!spec) {
    throw new HttpsError('invalid-argument', `Unknown frame ${String(action)}/${String(index)} for petType ${petType}`);
  }
  return spec;
}
