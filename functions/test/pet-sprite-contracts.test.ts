import { describe, expect, it } from 'vitest';
import {
  FRAME_MANIFEST,
  validateFrameSpec,
  validatePetType,
  validateRequestId,
} from '../src/pet-sprite-contracts';

describe('FRAME_MANIFEST', () => {
  it('has the exact frame counts per petType', () => {
    expect(FRAME_MANIFEST.corgi).toHaveLength(20);
    expect(FRAME_MANIFEST.cat).toHaveLength(24);
    expect(FRAME_MANIFEST.parrot).toHaveLength(20);
  });

  it('produces filenames matching the main project convention', () => {
    expect(FRAME_MANIFEST.corgi[0].filename).toBe('corgi_idle_0.png');
    expect(FRAME_MANIFEST.corgi.at(-1)?.filename).toBe('corgi_novel_probe_5.png');
    expect(FRAME_MANIFEST.cat.some((f) => f.filename === 'cat_paw_test_5.png')).toBe(true);
    expect(FRAME_MANIFEST.parrot.some((f) => f.filename === 'parrot_novel_probe_5.png')).toBe(true);
  });
});

describe('validatePetType', () => {
  it('accepts the three known pet types', () => {
    expect(validatePetType('corgi')).toBe('corgi');
    expect(validatePetType('cat')).toBe('cat');
    expect(validatePetType('parrot')).toBe('parrot');
  });

  it('rejects anything else', () => {
    expect(() => validatePetType('dog')).toThrowError(/petType/);
    expect(() => validatePetType(undefined)).toThrowError(/petType/);
  });
});

describe('validateRequestId', () => {
  it('accepts alphanumeric ids', () => {
    expect(validateRequestId('abc-123_XYZ')).toBe('abc-123_XYZ');
  });

  it('rejects empty, non-string, or overly long ids', () => {
    expect(() => validateRequestId('')).toThrowError(/requestId/);
    expect(() => validateRequestId(42)).toThrowError(/requestId/);
    expect(() => validateRequestId('a'.repeat(65))).toThrowError(/requestId/);
  });
});

describe('validateFrameSpec', () => {
  it('returns the matching FrameSpec', () => {
    expect(validateFrameSpec('cat', 'stalk', 2)).toEqual({ action: 'stalk', index: 2, filename: 'cat_stalk_2.png' });
  });

  it('rejects an action/index combo not in the manifest', () => {
    expect(() => validateFrameSpec('cat', 'stalk', 99)).toThrow();
    expect(() => validateFrameSpec('corgi', 'stalk', 0)).toThrow();
  });
});
