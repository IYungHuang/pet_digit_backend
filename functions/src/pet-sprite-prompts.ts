import type { PetType } from './pet-sprite-contracts';

const GENERIC_POSE_HINTS: Record<string, string[]> = {
  idle: [
    'Standing idle, relaxed posture, tail resting down, eyes open.',
    'Standing idle, relaxed posture, tail slightly raised, mid-blink.',
    'Standing idle, head tilted slightly to one side, mouth slightly open.',
    'Standing idle, relaxed posture, chest slightly puffed from breathing.',
  ],
  walk: [
    'Side-view walking cycle, right front leg planted, left front leg lifted forward.',
    'Side-view walking cycle, mid-stride, body weight shifting forward.',
    'Side-view walking cycle, left front leg planted, right front leg lifted forward.',
    'Side-view walking cycle, mid-stride on the opposite side, body weight shifting forward.',
  ],
  run: [
    'Full sprint, legs extended forward and backward, body stretched low.',
    'Full sprint, legs gathered underneath the body, mid-bound.',
  ],
  jump: [
    'Crouched down, legs bent, gathering power right before leaping.',
    'Airborne mid-jump, legs tucked, body arched upward.',
  ],
  observe: [
    'Curious pose, head tilted to the left, ears perked toward something interesting.',
    'Curious pose, head tilted to the right, ears perked toward something interesting.',
  ],
};

const SPECIES_ACTION_POSE_HINTS: Partial<Record<PetType, Record<string, string[]>>> = {
  corgi: {
    novel_probe: [
      'Cautiously stretching neck forward, nose sniffing at an unfamiliar object.',
      'Front paw lifted, about to poke the unfamiliar object.',
      'Nose making contact with the object, ears back in surprise.',
      'Jumping back slightly, startled, tail tucked.',
      'Approaching again, head low, tail wagging slowly, curious.',
      'Relaxed after investigating, sitting back on haunches near the object.',
    ],
  },
  cat: {
    stalk: [
      'Low stalking crouch, body flattened, eyes fixed forward.',
      'Stalking crouch, one front paw slowly extending forward.',
      'Stalking crouch, weight shifted onto the extended front paw.',
      'Stalking crouch, back legs coiling, tail flicking low.',
    ],
    paw_test: [
      'Sitting, one paw raised, about to tap an object.',
      'Paw making first light contact with the object.',
      'Paw pressing down on the object, head tilted to watch.',
      'Paw pulling back sharply after the object reacted.',
      'Both front paws now near the object, batting at it again.',
      'Sitting back, satisfied, watching the object settle.',
    ],
  },
  parrot: {
    novel_probe: [
      'Head cocked, one eye examining an unfamiliar object closely.',
      'Beak lowering slowly toward the object.',
      'Beak gently pecking at the object.',
      'Wings flaring slightly, startled by the object.',
      'Settling back, head tilted, still watching the object.',
      'Calm again, feathers relaxed, standing near the object.',
    ],
  },
};

export function getPoseHint(petType: PetType, action: string, index: number): string {
  const speciesHints = SPECIES_ACTION_POSE_HINTS[petType]?.[action];
  const hints = speciesHints ?? GENERIC_POSE_HINTS[action];
  const hint = hints?.[index];
  if (!hint) {
    throw new Error(`No pose hint defined for ${petType}/${action}/${index}`);
  }
  return hint;
}

export function buildFramePrompt(petType: PetType, action: string, index: number): string {
  const poseHint = getPoseHint(petType, action, index);
  return [
    'Redraw this pet as a cute Q-version 8-bit pixel-art / chibi cartoon character,',
    'using its coat colors, markings, body shape, and facial features from the reference photos.',
    'Square canvas, fully transparent background (no background at all), clean pixel-art outlines,',
    'consistent art style and proportions across every frame you are asked to generate for this pet.',
    `Pose for this specific frame: ${poseHint}`,
  ].join(' ');
}
