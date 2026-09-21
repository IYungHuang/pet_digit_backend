import { HttpsError } from 'firebase-functions/v2/https';
import {
  FRAME_MANIFEST,
  validateFrameSpec,
  validatePetType,
  validateRequestId,
  type FrameSpec,
  type PetType,
} from './pet-sprite-contracts';
import { getPoseHint } from './pet-sprite-prompts';
import { generateFrameImageWithRetry, type ReferencePhoto } from './pet-sprite-gemini-client';
import { hasTransparentBackground, normalizeFrame } from './pet-sprite-postprocess';

export type AuthenticatedContext = {
  auth: { uid: string } | null;
  data: Record<string, unknown>;
};

export type SpriteGenerationDependencies = {
  apiKey: string;
  readSourcePhotos: (uid: string, requestId: string) => Promise<ReferencePhoto[]>;
  writeGeneratedFrame: (uid: string, requestId: string, filename: string, buffer: Buffer) => Promise<string>;
  generateImage: typeof generateFrameImageWithRetry;
};

export type GeneratedFrameResult = {
  filename: string;
  storagePath: string;
  downloadUrl: string;
  needsReview: boolean;
};

type FrameGenerationOutcome = GeneratedFrameResult & { normalizedBuffer: Buffer };

function requireCallerUid(context: AuthenticatedContext): string {
  const uid = context.auth?.uid;
  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  return uid;
}

async function requireThreeSourcePhotos(
  deps: SpriteGenerationDependencies,
  uid: string,
  requestId: string,
): Promise<ReferencePhoto[]> {
  const referencePhotos = await deps.readSourcePhotos(uid, requestId);
  if (referencePhotos.length !== 3) {
    throw new HttpsError('failed-precondition', 'Exactly 3 source photos are required for this request');
  }
  return referencePhotos;
}

async function generateOneFrame(
  deps: SpriteGenerationDependencies,
  uid: string,
  requestId: string,
  petType: PetType,
  spec: FrameSpec,
  referencePhotos: ReferencePhoto[],
  firstFrameReference: ReferencePhoto | undefined,
): Promise<FrameGenerationOutcome> {
  const promptText = getPoseHint(petType, spec.action, spec.index);
  const rawBuffer = await deps.generateImage({
    apiKey: deps.apiKey,
    promptText,
    referencePhotos,
    firstFrameReference,
  });
  const needsReview = !(await hasTransparentBackground(rawBuffer));
  const normalizedBuffer = await normalizeFrame(rawBuffer);
  const downloadUrl = await deps.writeGeneratedFrame(uid, requestId, spec.filename, normalizedBuffer);
  return {
    filename: spec.filename,
    storagePath: `users/${uid}/pet-sprite-requests/${requestId}/generated/${spec.filename}`,
    downloadUrl,
    needsReview,
    normalizedBuffer,
  };
}

export async function generatePetSpritesHandler(
  context: AuthenticatedContext,
  deps: SpriteGenerationDependencies,
): Promise<{ frames: GeneratedFrameResult[] }> {
  const uid = requireCallerUid(context);
  const requestId = validateRequestId(context.data.requestId);
  const petType = validatePetType(context.data.petType);
  const referencePhotos = await requireThreeSourcePhotos(deps, uid, requestId);

  const frames: GeneratedFrameResult[] = [];
  const firstFrameByAction = new Map<string, ReferencePhoto>();
  for (const spec of FRAME_MANIFEST[petType]) {
    const firstFrameReference = firstFrameByAction.get(spec.action);
    const outcome = await generateOneFrame(deps, uid, requestId, petType, spec, referencePhotos, firstFrameReference);
    frames.push({
      filename: outcome.filename,
      storagePath: outcome.storagePath,
      downloadUrl: outcome.downloadUrl,
      needsReview: outcome.needsReview,
    });
    if (spec.index === 0) {
      firstFrameByAction.set(spec.action, {
        mimeType: 'image/png',
        base64Data: outcome.normalizedBuffer.toString('base64'),
      });
    }
  }
  return { frames };
}

export async function regeneratePetSpriteFrameHandler(
  context: AuthenticatedContext,
  deps: SpriteGenerationDependencies,
): Promise<GeneratedFrameResult> {
  const uid = requireCallerUid(context);
  const requestId = validateRequestId(context.data.requestId);
  const petType = validatePetType(context.data.petType);
  const spec = validateFrameSpec(petType, context.data.action, context.data.index);
  const referencePhotos = await requireThreeSourcePhotos(deps, uid, requestId);

  const outcome = await generateOneFrame(deps, uid, requestId, petType, spec, referencePhotos, undefined);
  return {
    filename: outcome.filename,
    storagePath: outcome.storagePath,
    downloadUrl: outcome.downloadUrl,
    needsReview: outcome.needsReview,
  };
}
