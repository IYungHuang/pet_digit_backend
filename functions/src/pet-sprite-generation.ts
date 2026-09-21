import { HttpsError } from 'firebase-functions/v2/https';
import {
  FRAME_MANIFEST,
  validateFrameSpec,
  validatePetType,
  validateRequestId,
  type FrameSpec,
  type PetType,
} from './pet-sprite-contracts';
import { buildFramePrompt } from './pet-sprite-prompts';
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
  readGeneratedFrame: (uid: string, requestId: string, filename: string) => Promise<ReferencePhoto | null>;
  claimRequestLock: (lockId: string) => Promise<boolean>;
  releaseRequestLock: (lockId: string) => Promise<void>;
};

export type GeneratedFrameResult = {
  filename: string;
  storagePath?: string;
  downloadUrl?: string;
  needsReview?: boolean;
  error?: string;
};

type FrameGenerationOutcome = GeneratedFrameResult & { normalizedBuffer: Buffer };

function requireCallerUid(context: AuthenticatedContext): string {
  const uid = context.auth?.uid;
  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  return uid;
}

async function withRequestLock<T>(
  deps: SpriteGenerationDependencies,
  lockId: string,
  work: () => Promise<T>,
): Promise<T> {
  const claimed = await deps.claimRequestLock(lockId);
  if (!claimed) {
    throw new HttpsError('already-exists', 'A generation request is already in progress for this id');
  }
  try {
    return await work();
  } finally {
    await deps.releaseRequestLock(lockId);
  }
}

async function fetchActionStyleAnchor(
  deps: SpriteGenerationDependencies,
  uid: string,
  requestId: string,
  petType: PetType,
  spec: FrameSpec,
): Promise<ReferencePhoto | undefined> {
  if (spec.index === 0) {
    return undefined;
  }
  const frameZero = FRAME_MANIFEST[petType].find((f) => f.action === spec.action && f.index === 0);
  if (!frameZero) {
    return undefined;
  }
  return (await deps.readGeneratedFrame(uid, requestId, frameZero.filename)) ?? undefined;
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
  const promptText = buildFramePrompt(petType, spec.action, spec.index);
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

  return withRequestLock(deps, `${uid}_${requestId}`, async () => {
    const frames: GeneratedFrameResult[] = [];
    const firstFrameByAction = new Map<string, ReferencePhoto>();
    for (const spec of FRAME_MANIFEST[petType]) {
      const firstFrameReference = firstFrameByAction.get(spec.action);
      try {
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
      } catch (error) {
        frames.push({
          filename: spec.filename,
          error: error instanceof Error ? error.message : 'Frame generation failed',
        });
      }
    }
    return { frames };
  });
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

  return withRequestLock(deps, `${uid}_${requestId}_${spec.action}_${spec.index}`, async () => {
    const styleAnchor = await fetchActionStyleAnchor(deps, uid, requestId, petType, spec);
    const outcome = await generateOneFrame(deps, uid, requestId, petType, spec, referencePhotos, styleAnchor);
    return {
      filename: outcome.filename,
      storagePath: outcome.storagePath,
      downloadUrl: outcome.downloadUrl,
      needsReview: outcome.needsReview,
    };
  });
}
