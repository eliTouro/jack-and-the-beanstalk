import OpenAI, { toFile } from 'openai';
import { log } from './log.js';
import { imageCost } from './cost.js';

// Swap models with the IMAGE_MODEL env var; no code change needed.
export const MODEL = process.env.IMAGE_MODEL || 'gpt-image-2.5-flare';
const QUALITY = process.env.IMAGE_QUALITY || 'low'; // low | medium | high
// IMAGE_PROVIDER=mock skips the API: after a short random wait it returns the first
// input image. Free and fast, for testing sign-in, storage, money and the progress bars.
export const isMock = () => process.env.IMAGE_PROVIDER === 'mock';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

let client;
export function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new HttpError(500, 'The server has no OPENAI_API_KEY set.');
  }
  // The SDK reads OPENAI_API_KEY from the environment itself.
  client ??= new OpenAI({ timeout: 120_000, maxRetries: 1 });
  return client;
}

// `input_fidelity: high` makes the model work harder to keep faces. The mini
// model only supports `low` and gpt-image-2 doesn't take the parameter at all.
function fidelityFor(model) {
  return /^gpt-image-1(\.5)?$/.test(model) ? { input_fidelity: 'high' } : {};
}

// At most IMAGE_CONCURRENCY image calls run at once across the whole server, so one
// 20-page book can't trip the API's rate limit for everyone else.
const MAX_PARALLEL = Number(process.env.IMAGE_CONCURRENCY || 22);
let running = 0;
const waiting = [];
async function withSlot(work) {
  if (running >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// One request to the image model. Apart from waiting out a rate limit there is no retry
// here: the quality loop in src/quality.js decides whether a picture is drawn again.
//
// images: [{ data: base64, mimeType }]   size: '1024x1024' | '1536x1024' | '1024x1536'
// Returns { data, mimeType, model, usage, costUsd, ms }.
export async function generateImage({ prompt, images = [], size = '1024x1024', quality = QUALITY }) {
  const t0 = Date.now();
  if (isMock()) return mockImage(images, t0);
  const files = await Promise.all(
    images.map((img, i) => toFile(Buffer.from(img.data, 'base64'), `image-${i + 1}.${img.mimeType.split('/')[1]}`, { type: img.mimeType })),
  );

  let result;
  const common = { model: MODEL, prompt, size, quality, output_format: 'jpeg', n: 1 };
  // The account's image rate limit is shared by every book being made. When it is hit,
  // wait as long as the API asks and try the same call again (up to 5 times, about a
  // minute in all). These waits are not quality-loop attempts and cost nothing.
  for (let wait = 0; ; wait++) {
    try {
      // With input pictures this is an edit; with none it's plain generation.
      result = await withSlot(() => (files.length
        ? getClient().images.edit({ ...common, image: files, ...fidelityFor(MODEL) })
        : getClient().images.generate(common)));
      break;
    } catch (err) {
      if (err?.status === 429 && err?.code === 'rate_limit_exceeded' && wait < 5) {
        const asked = Number(/try again in ([\d.]+)s/i.exec(err?.message || '')?.[1] || 0);
        await new Promise((r) => setTimeout(r, Math.min(20, Math.max(2, asked) + wait * 2) * 1000 + Math.random() * 1500));
        continue;
      }
      throw translateError(err);
    }
  }

  const data = result.data?.[0]?.b64_json;
  if (!data) {
    throw new HttpError(422, "The model didn't return a picture (it may have been blocked by a safety filter). Try a different photo.");
  }
  return { data, mimeType: 'image/jpeg', model: MODEL, usage: result.usage || null, costUsd: imageCost(MODEL, result.usage), ms: Date.now() - t0 };
}

async function mockImage(images, t0) {
  const min = Number(process.env.MOCK_MIN_MS ?? 3000);
  const max = Number(process.env.MOCK_MAX_MS ?? 9000);
  await new Promise((r) => setTimeout(r, min + Math.random() * Math.max(0, max - min)));
  if (!images.length) throw new HttpError(400, 'Mock mode needs an input image.');
  // Made-up token counts, so the cost pages have something to show in mock mode.
  const usage = { input_tokens: 700, output_tokens: 400, input_tokens_details: { text_tokens: 300, image_tokens: 400 } };
  return { data: images[0].data, mimeType: images[0].mimeType, model: 'mock', usage, costUsd: imageCost(MODEL, usage), ms: Date.now() - t0 };
}

function translateError(err) {
  if (err instanceof HttpError) return err;
  const status = err?.status;
  log.error({ status, code: err?.code, message: err?.message }, 'image API error');
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
