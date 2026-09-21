import { describe, expect, it } from 'vitest';
import { FRAME_MANIFEST, type PetType } from '../src/pet-sprite-contracts';
import { buildFramePrompt, getPoseHint } from '../src/pet-sprite-prompts';

describe('getPoseHint', () => {
  it('returns a distinct hint for every frame in every petType manifest', () => {
    (Object.keys(FRAME_MANIFEST) as PetType[]).forEach((petType) => {
      FRAME_MANIFEST[petType].forEach((frame) => {
        const hint = getPoseHint(petType, frame.action, frame.index);
        expect(typeof hint).toBe('string');
        expect(hint.length).toBeGreaterThan(0);
      });
    });
  });

  it('gives corgi and parrot different wording for their own novel_probe action', () => {
    const corgiHint = getPoseHint('corgi', 'novel_probe', 0);
    const parrotHint = getPoseHint('parrot', 'novel_probe', 0);
    expect(corgiHint).not.toBe(parrotHint);
  });

  it('throws for a frame outside the manifest', () => {
    expect(() => getPoseHint('corgi', 'stalk', 0)).toThrow();
  });
});

describe('buildFramePrompt', () => {
  it('includes the style instructions and the pose hint', () => {
    const prompt = buildFramePrompt('cat', 'idle', 1);
    expect(prompt).toContain('8-bit');
    expect(prompt).toContain('transparent');
    expect(prompt).toContain(getPoseHint('cat', 'idle', 1));
  });
});
