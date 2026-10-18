import express from 'express';
import { fileURLToPath } from 'node:url';
import { generateImage, HttpError, MODEL } from './src/image.js';
import { cartoonPrompt, scenePrompt, normalizeSettings, SCENES, STYLES, EXAGGERATION, PALETTES, LINES, DEFAULT_SETTINGS } from './src/prompts.js';

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

app.set('trust proxy', 1); // Render sits behind a proxy; needed for the per-IP limit.
app.use(express.json({ limit: '25mb' }));
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

// --- Cost guard: a small per-IP budget of image generations per hour. ---------
const LIMIT_PER_HOUR = Number(process.env.IMAGES_PER_HOUR || 15);
const usage = new Map(); // ip -> timestamps (ms) of recent generations
function spendBudget(req) {
  const now = Date.now();
  const recent = (usage.get(req.ip) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= LIMIT_PER_HOUR) {
    throw new HttpError(429, `You've made ${LIMIT_PER_HOUR} pictures this hour, which is the limit. Please come back later.`);
  }
  recent.push(now);
  usage.set(req.ip, recent);
}

// Accepts a data URL ("data:image/jpeg;base64,...") and returns { data, mimeType }.
function parseImage(dataUrl, field) {
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new HttpError(400, `Missing or unreadable ${field} image.`);
  const [, mimeType, data] = match;
  if (!ALLOWED_TYPES.has(mimeType)) throw new HttpError(400, `The ${field} must be a JPEG, PNG or WebP image.`);
  if (Buffer.byteLength(data, 'base64') > MAX_IMAGE_BYTES) throw new HttpError(413, `The ${field} image is larger than 8 MB.`);
  return { data, mimeType };
}

const toDataUrl = (img) => `data:${img.mimeType};base64,${img.data}`;

// --- Routes -------------------------------------------------------------------
app.get('/healthz', (_req, res) => res.json({ ok: true, model: MODEL, keyConfigured: Boolean(process.env.OPENAI_API_KEY) }));

// The menus the UI renders, so the server stays the single source of truth.
app.get('/api/options', (_req, res) => {
  const menu = (table) => Object.entries(table).map(([id, v]) => ({ id, label: v.label ?? id }));
  res.json({
    defaults: DEFAULT_SETTINGS,
    styles: menu(STYLES),
    exaggeration: menu(EXAGGERATION),
    palettes: menu(PALETTES),
    lines: menu(LINES),
    scenes: Object.entries(SCENES).map(([id, s]) => ({ id, title: s.title, spec: s.spec })),
  });
});

// Photo -> cartoon portrait. One model call.
app.post('/api/cartoon', async (req, res, next) => {
  try {
    const photo = parseImage(req.body?.photo, 'photo');
    const settings = normalizeSettings(req.body?.settings);
    spendBudget(req);
    const image = await generateImage({ prompt: cartoonPrompt(settings), images: [photo], size: '1024x1024' });
    res.json({ image: toDataUrl(image), settings });
  } catch (err) {
    next(err);
  }
});

// Photo + cartoon -> one Jack and the Beanstalk scene. One model call.
app.post('/api/scene', async (req, res, next) => {
  try {
    const sceneId = req.body?.sceneId;
    if (!Object.hasOwn(SCENES, sceneId)) throw new HttpError(400, 'Unknown scene.');
    const photo = parseImage(req.body?.photo, 'photo');
    const cartoon = parseImage(req.body?.cartoon, 'cartoon');
    const settings = normalizeSettings(req.body?.settings);
    spendBudget(req);
    const image = await generateImage({ prompt: scenePrompt(sceneId, settings), images: [photo, cartoon], size: '1536x1024' });
    // The caption is the exact scene specification that was sent to the model.
    res.json({ image: toDataUrl(image), sceneId, title: SCENES[sceneId].title, caption: SCENES[sceneId].spec });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500 && !(err instanceof HttpError)) console.error(err);
  const message = err instanceof HttpError ? err.message : status === 413 ? 'That upload is too large.' : 'Something went wrong on the server.';
  res.status(status).json({ error: message });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => console.log(`Jack and the Beanstalk on http://localhost:${PORT} (model ${MODEL})`));
}

export default app;
