import OpenAI, { toFile } from 'openai';

// Swap models with the IMAGE_MODEL env var; no code change needed.
export const MODEL = process.env.IMAGE_MODEL || 'gpt-image-2.5-flare';
const QUALITY = process.env.IMAGE_QUALITY || 'low'; // low | medium | high

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let client;
function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new HttpError(500, 'The server has no OPENAI_API_KEY set.');
  }
  // The SDK reads OPENAI_API_KEY from the environment itself.
  client ??= new OpenAI();
  return client;
}

// `input_fidelity: high` makes the model work harder to keep faces. The mini
// model only supports `low` and gpt-image-2 doesn't take the parameter at all.
function fidelityFor(model) {
  return /^gpt-image-1(\.5)?$/.test(model) ? { input_fidelity: 'high' } : {};
}

// One request to the image model. Deliberately no retry loop: if it fails, the
// error goes back to the user, who decides whether to try again.
//
// images: [{ data: base64, mimeType }]   size: '1024x1024' | '1536x1024' | '1024x1536'
export async function generateImage({ prompt, images, size = '1024x1024' }) {
  const files = await Promise.all(
    images.map((img, i) => toFile(Buffer.from(img.data, 'base64'), `image-${i + 1}.${img.mimeType.split('/')[1]}`, { type: img.mimeType })),
  );

  let result;
  try {
    const common = { model: MODEL, prompt, size, quality: QUALITY, output_format: 'jpeg', n: 1 };
    // With reference photos this is an edit; with none (only used by the test-face helper) it's plain generation.
    result = files.length
      ? await getClient().images.edit({ ...common, image: files, ...fidelityFor(MODEL) })
      : await getClient().images.generate(common);
  } catch (err) {
    throw translateError(err);
  }

  const data = result.data?.[0]?.b64_json;
  if (!data) {
    throw new HttpError(422, "The model didn't return a picture (it may have been blocked by a safety filter). Try a different photo.");
  }
  return { data, mimeType: 'image/jpeg' };
}

function translateError(err) {
  if (err instanceof HttpError) return err;
  const status = err?.status;
  console.error('Image API error', status, err?.code, err?.message);
  if (err?.code === 'moderation_blocked' || /safety|moderation/i.test(err?.message || '')) {
    return new HttpError(422, 'The image service declined that photo or scene (safety filter). Try a different, clearer photo.');
  }
  if (status === 429) {
    return new HttpError(429, 'The image service is busy or out of credit right now. Please wait a minute and try again.');
  }
  if (status === 400) {
    return new HttpError(400, 'The image service rejected that request. Try a different, clearer photo.');
  }
  if (status === 401 || status === 403) {
    return new HttpError(500, "The server's API key was refused or isn't allowed to use this model. The site owner needs to check it.");
  }
  return new HttpError(502, 'The image service had a problem. Please try again.');
}
