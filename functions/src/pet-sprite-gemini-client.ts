import { GoogleGenAI } from '@google/genai';

export type ReferencePhoto = {
  mimeType: string;
  base64Data: string;
};

export type GenerateFrameImageInput = {
  apiKey: string;
  promptText: string;
  referencePhotos: ReferencePhoto[];
  firstFrameReference?: ReferencePhoto;
};

export async function generateFrameImage(input: GenerateFrameImageInput): Promise<Buffer> {
  const ai = new GoogleGenAI({ apiKey: input.apiKey });
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: input.promptText },
    ...input.referencePhotos.map((photo) => ({ inlineData: { mimeType: photo.mimeType, data: photo.base64Data } })),
  ];
  if (input.firstFrameReference) {
    parts.push({
      inlineData: { mimeType: input.firstFrameReference.mimeType, data: input.firstFrameReference.base64Data },
    });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [{ role: 'user', parts }],
  });

  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    (part: { inlineData?: { data?: string } }) => Boolean(part.inlineData?.data),
  );
  if (!imagePart?.inlineData?.data) {
    throw new Error('Gemini did not return an image for this frame');
  }
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

export async function generateFrameImageWithRetry(
  input: GenerateFrameImageInput,
  attempts = 2,
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await generateFrameImage(input);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Gemini generation failed after retries');
}
