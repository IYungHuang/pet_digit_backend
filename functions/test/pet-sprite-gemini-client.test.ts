import { describe, expect, it, vi, beforeEach } from 'vitest';

const generateContentMock = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: generateContentMock },
  })),
}));

import { generateFrameImage, generateFrameImageWithRetry } from '../src/pet-sprite-gemini-client';

beforeEach(() => {
  generateContentMock.mockReset();
});

describe('generateFrameImage', () => {
  it('extracts the inline image bytes from the Gemini response', async () => {
    generateContentMock.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('hi').toString('base64') } }] } }],
    });

    const result = await generateFrameImage({
      apiKey: 'key',
      promptText: 'draw a cat',
      referencePhotos: [{ mimeType: 'image/jpeg', base64Data: 'aaa' }],
    });

    expect(result.toString()).toBe('hi');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the response has no image part', async () => {
    generateContentMock.mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'sorry, no image' }] } }] });

    await expect(
      generateFrameImage({ apiKey: 'key', promptText: 'x', referencePhotos: [] }),
    ).rejects.toThrowError(/did not return an image/);
  });
});

describe('generateFrameImageWithRetry', () => {
  it('retries once after a failure and succeeds', async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('ok').toString('base64') } }] } }],
      });

    const result = await generateFrameImageWithRetry({ apiKey: 'key', promptText: 'x', referencePhotos: [] });
    expect(result.toString()).toBe('ok');
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after exhausting attempts', async () => {
    generateContentMock.mockRejectedValue(new Error('always fails'));
    await expect(
      generateFrameImageWithRetry({ apiKey: 'key', promptText: 'x', referencePhotos: [] }, 2),
    ).rejects.toThrowError(/always fails/);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });
});
