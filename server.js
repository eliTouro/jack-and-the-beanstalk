import express from 'express';
import cookieSession from 'cookie-session';
import { pinoHttp } from 'pino-http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateImage, HttpError, MODEL, isMock } from './src/image.js';
import { cartoonPrompt, scenePrompt, normalizeSettings, SCENES, STYLES, EXAGGERATION, PALETTES, LINES, DEFAULT_SETTINGS } from './src/prompts.js';
import { PAGES, ABOUT_FIELDS, BOOK_STYLE, SLOTS, SLOT_BY_ID, normalizeAbout, pageText } from './src/book.js';
import { buildBookPdf } from './src/pdf.js';
import { router as authRouter, requireUser } from './src/auth.js';
import * as store from './src/store.js';
import * as jobs from './src/jobs.js';
import { db } from './src/db.js';
import { log } from './src/log.js';

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

app.set('trust proxy', 1); // Render sits behind a proxy; needed for the per-IP limit and secure cookies.

// Request log: one line per request, without bodies (photos) or cookies. Polling and
// picture fetches are logged at debug level so the log stays readable.
app.use(pinoHttp({
  logger: log,
  autoLogging: { ignore: (req) => req.url === '/healthz' },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return req.method === 'GET' && req.url.startsWith('/api/books/') ? 'debug' : 'info';
  },
  serializers: { req: (req) => ({ id: req.id, method: req.method, url: req.url }), res: (res) => ({ status: res.statusCode }) },
}));

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  log.warn('SESSION_SECRET is not set: everyone is signed out whenever the server restarts');
}
app.use(cookieSession({
  name: 'beanstalk',
  keys: [process.env.SESSION_SECRET || randomBytes(32).toString('hex')],
  maxAge: 30 * 24 * 3600_000,
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
}));
app.use(express.json({ limit: '12mb' }));
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
app.use(authRouter);

// --- Cost guard: a small per-IP budget of image generations per hour. ---------
const LIMIT_PER_HOUR = Number(process.env.IMAGES_PER_HOUR || 25);
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
app.get('/healthz', (_req, res) => res.json({
  ok: true, model: MODEL, mock: isMock(),
  keyConfigured: Boolean(process.env.OPENAI_API_KEY),
  googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  database: process.env.DATABASE_URL ? 'postgres' : 'memory',
}));

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

// --- The picture book (signed-in users; every book is saved) -----------------------
// POST /api/books stores the photo and starts drawing every picture on the server.
// The browser polls GET /api/books/:id for per-picture progress.

app.get('/api/book', (_req, res) => {
  res.json({
    style: BOOK_STYLE,
    pages: PAGES.map(({ id, number, title, text, zone, tone }) => ({ id, number, title, text, zone, tone })),
    about: ABOUT_FIELDS,
    slots: SLOTS,
  });
});

const MAX_BOOKS = Number(process.env.MAX_BOOKS_PER_USER || 30);
const msOf = (d) => (d ? new Date(d).getTime() : null);

async function bookJson(row) {
  const [rows, est] = await Promise.all([store.getSlots(row.id), store.estimateMs()]);
  const bySlot = Object.fromEntries(rows.map((r) => [r.slot, r]));
  const slots = await Promise.all(SLOTS.map(async (def) => {
    const r = bySlot[def.id] || { status: 'empty' };
    let { status, error } = r;
    // Queued or running in the database, but not on this server: a restart cut it off.
    if ((status === 'queued' || status === 'running') && !jobs.isActive(row.id, def.id)) {
      error = 'This picture was interrupted because the server restarted. Try again.';
      status = r.has_image ? 'done' : 'error';
      await store.markFailed(row.id, def.id, error);
    }
    return {
      id: def.id, label: def.label, kind: def.kind, status, error: error || null,
      startedAt: msOf(r.started_at), finishedAt: msOf(r.finished_at),
      estimateMs: est[def.kind] ?? est.page,
      imageUrl: r.has_image ? `/api/books/${row.id}/images/${def.id}?v=${r.version}` : null,
      canUndo: Boolean(r.can_undo),
    };
  }));
  const about = normalizeAbout(row.about);
  const has = (id) => slots.find((s) => s.id === id)?.imageUrl;
  const busy = slots.some((s) => s.status === 'queued' || s.status === 'running');
  return {
    id: row.id, about, createdAt: msOf(row.created_at), updatedAt: msOf(row.updated_at),
    photoUrl: `/api/books/${row.id}/images/photo`,
    busy,
    pdfReady: !busy && Boolean(about.name) && Boolean(has('reference')) && PAGES.every((p) => has(p.id)),
    now: Date.now(),
    slots,
  };
}

async function ownBook(req) {
  const row = await store.getBookRow(req.params.id, req.userId);
  if (!row) throw new HttpError(404, "That book doesn't exist, or it belongs to someone else.");
  return row;
}

// Express 5 passes rejected promises from these handlers to the error handler.
app.get('/api/books', requireUser, async (req, res) => {
  const rows = await store.listBooks(req.userId);
  const thumb = (r) =>
    r.page1_v != null ? `/api/books/${r.id}/images/cupboard?v=${r.page1_v}`
    : r.ref_v != null ? `/api/books/${r.id}/images/reference?v=${r.ref_v}`
    : null;
  res.json({
    books: rows.map((r) => ({
      id: r.id, name: normalizeAbout(r.about).name, createdAt: msOf(r.created_at), updatedAt: msOf(r.updated_at),
      thumbUrl: thumb(r), done: r.done, total: r.total, busy: Boolean(r.busy),
    })),
  });
});

app.post('/api/books', requireUser, async (req, res) => {
  const photo = parseImage(req.body?.photo, 'photo');
  if ((await store.countBooks(req.userId)) >= MAX_BOOKS) {
    throw new HttpError(429, `You have ${MAX_BOOKS} books, which is the limit. Delete one to make another.`);
  }
  const bookId = await store.createBook(req.userId, { buffer: Buffer.from(photo.data, 'base64'), mimeType: photo.mimeType });
  try {
    await jobs.startGeneration({ bookId, userId: req.userId, slots: SLOTS.map((s) => s.id) });
  } catch (err) {
    await store.deleteBook(bookId);
    throw err;
  }
  await store.logEvent({ userId: req.userId, bookId, kind: 'book.create' });
  const row = await store.getBookRow(bookId, req.userId);
  res.status(201).json({ book: await bookJson(row) });
});

app.get('/api/books/:id', requireUser, async (req, res) => {
  res.json({ book: await bookJson(await ownBook(req)) });
});

app.post('/api/books/:id/generate', requireUser, async (req, res) => {
  const row = await ownBook(req);
  const slots = Array.isArray(req.body?.slots) ? req.body.slots.filter((s) => typeof s === 'string') : [];
  await jobs.startGeneration({ bookId: row.id, userId: req.userId, slots });
  res.status(202).json({ book: await bookJson(row) });
});

app.post('/api/books/:id/fix', requireUser, async (req, res) => {
  const row = await ownBook(req);
  const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  if (instruction.length < 3) throw new HttpError(400, 'Say what to change on this page.');
  await jobs.startFix({ bookId: row.id, userId: req.userId, pageId: req.body?.pageId, instruction });
  res.status(202).json({ book: await bookJson(row) });
});

app.post('/api/books/:id/undo', requireUser, async (req, res) => {
  const row = await ownBook(req);
  if (!(await store.undoImage(row.id, req.body?.pageId))) throw new HttpError(400, 'There is no earlier version of that page.');
  res.json({ book: await bookJson(row) });
});

app.patch('/api/books/:id', requireUser, async (req, res) => {
  const row = await ownBook(req);
  const about = normalizeAbout(req.body?.about);
  await store.saveAbout(row.id, about);
  res.json({ book: await bookJson({ ...row, about }) });
});

app.delete('/api/books/:id', requireUser, async (req, res) => {
  const row = await ownBook(req);
  await store.deleteBook(row.id);
  await store.logEvent({ userId: req.userId, bookId: row.id, kind: 'book.delete' });
  res.status(204).end();
});

// Pictures and the photo are only ever served to the book's owner.
app.get('/api/books/:id/images/:slot', requireUser, async (req, res) => {
  const row = await ownBook(req);
  const { slot } = req.params;
  const img = slot === 'photo' ? await store.getPhoto(row.id) : Object.hasOwn(SLOT_BY_ID, slot) ? await store.getImage(row.id, slot) : null;
  if (!img) throw new HttpError(404, 'No picture here yet.');
  res.set({ 'Content-Type': img.mimeType, 'Cache-Control': req.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache' });
  res.send(img.buffer);
});

// Pages + About Me -> one PDF. No model call; the text comes from the server's storyboard.
app.get('/api/books/:id/pdf', requireUser, async (req, res) => {
  const row = await ownBook(req);
  const about = normalizeAbout(row.about);
  if (!about.name) throw new HttpError(400, "Add the child's name for the About Me page.");
  const b64 = (img) => img && { data: img.buffer.toString('base64'), mimeType: img.mimeType };
  const reference = b64(await store.getImage(row.id, 'reference'));
  const pages = await Promise.all(PAGES.map(async (p) => ({ ...p, text: pageText(p, about.name), image: b64(await store.getImage(row.id, p.id)) })));
  const missing = pages.find((p) => !p.image);
  if (missing) throw new HttpError(400, `Page ${missing.number} hasn't been made yet.`);
  if (!reference) throw new HttpError(400, "Your Jack hasn't been made yet.");
  const pdf = await buildBookPdf({ pages, about, reference });
  const file = `${about.name.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'My'}-JackAndTheBeanstalk.pdf`;
  await store.logEvent({ userId: req.userId, bookId: row.id, kind: 'book.pdf' });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${file}"` });
  res.send(pdf);
});

app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500 && !(err instanceof HttpError)) log.error({ err }, 'unhandled error');
  const message = err instanceof HttpError ? err.message : status === 413 ? 'That upload is too large.' : 'Something went wrong on the server.';
  res.status(status).json({ error: message });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await db(); // connect and create the tables before taking traffic
  app.listen(PORT, () => log.info(`Jack and the Beanstalk on http://localhost:${PORT} (model ${MODEL}${isMock() ? ', MOCK images' : ''})`));
}

export default app;
