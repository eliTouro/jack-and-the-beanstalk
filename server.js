import express from 'express';
import cookieSession from 'cookie-session';
import compression from 'compression';
import { pinoHttp } from 'pino-http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateImage, HttpError, MODEL, isMock } from './src/image.js';
import { cartoonPrompt, scenePrompt, normalizeSettings, SCENES, STYLES, EXAGGERATION, PALETTES, LINES, DEFAULT_SETTINGS } from './src/prompts.js';
import { STORIES, storyOf, ABOUT_FIELDS, BOOK_STYLE, SLOTS, SLOT_BY_ID, normalizeAbout } from './src/book.js';
import { buildAndStorePdf } from './src/bookpdf.js';
import { MAX_ATTEMPTS } from './src/quality.js';
import * as library from './src/library.js';
import * as billing from './src/billing.js';
import * as printing from './src/print.js';
import { checkAbout } from './src/moderation.js';
import { router as authRouter, requireUser } from './src/auth.js';
import * as store from './src/store.js';
import * as jobs from './src/jobs.js';
import { db, query } from './src/db.js';
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
app.use(compression());
// Pages, scripts and styles always revalidate (a 304 is quick), so nobody is left on an
// old version after a deploy. Pictures and fonts are reused for a day.
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url)), {
  setHeaders: (res, path) => res.set('Cache-Control', /\.(html|js|css)$/.test(path) ? 'no-cache' : 'public, max-age=86400'),
}));
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
  payments: billing.stripeMode(),
  printer: printing.printerMode(),
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
// POST /api/books takes $0.99, stores the photo and starts drawing every picture on the
// server. The browser polls GET /api/books/:id for per-picture progress.

const MAX_BOOKS = Number(process.env.MAX_BOOKS_PER_USER || 40);
const msOf = (d) => (d ? new Date(d).getTime() : null);
const STAGES = ['Photo saved', 'Drawing your hero', 'Drawing the pages', 'Checking and fixing', 'Book ready'];

// The stories, the template text zones, the character bible and the pre-made scenes.
let storiesCache = null;
async function storiesJson() {
  if (storiesCache) return storiesCache;
  const { chars, scenes } = await library.libraryIndex();
  const v = (hash) => (hash || '').slice(0, 10);
  storiesCache = {
    style: BOOK_STYLE,
    priceCents: billing.PRICE_CENTS,
    maxAttempts: MAX_ATTEMPTS,
    about: ABOUT_FIELDS,
    slots: SLOTS,
    stories: Object.values(STORIES).map((st) => {
      const sc = Object.fromEntries(scenes.filter((r) => r.story === st.id).map((r) => [r.page, r]));
      return {
        id: st.id, title: st.title, heroRole: st.heroRole, heroOutfit: st.heroOutfit,
        scenesReady: Object.keys(sc).length,
        cover: {
          id: st.cover.id, number: 0, title: 'Front cover', text: st.cover.text, zone: st.cover.zone, shot: st.cover.shot, hero: true,
          sceneUrl: sc.cover ? `/api/library/${st.id}/scenes/cover?size=thumb&v=${v(sc.cover.hash)}` : null,
        },
        coverUrl: sc.p07 ? `/api/library/${st.id}/scenes/p07?size=thumb&v=${v(sc.p07.hash)}` : null,
        pages: st.pages.map((p) => ({
          id: p.id, number: p.number, title: p.title, text: p.text, zone: p.zone, shot: p.shot, hero: p.hero,
          sceneUrl: sc[p.id] ? `/api/library/${st.id}/scenes/${p.id}?size=thumb&v=${v(sc[p.id].hash)}` : null,
          sceneAttempts: sc[p.id]?.meta?.attempts ?? null,
        })),
        characters: chars.filter((c) => c.story === st.id).map((c) => ({
          id: c.id, name: c.name, description: c.description, attempts: c.meta?.attempts ?? null,
          imageUrl: `/api/library/${st.id}/characters/${c.id}?size=thumb&v=${v(c.hash)}`,
        })),
      };
    }),
  };
  return storiesCache;
}

app.get('/api/stories', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await storiesJson());
});

// Bible pictures and template scenes are the same for everyone, so they are public and cached hard.
app.get('/api/library/:story/:group/:id', async (req, res) => {
  const { story, group, id } = req.params;
  if (!Object.hasOwn(STORIES, story)) throw new HttpError(404, 'Unknown story.');
  const item = group === 'scenes' ? await library.getScene(story, id) : group === 'characters' ? await library.getCharacter(story, id) : null;
  if (!item) throw new HttpError(404, 'No picture here.');
  const thumb = req.query.size === 'thumb' && item.thumb;
  res.set({ 'Content-Type': thumb ? 'image/webp' : item.mimeType, 'Cache-Control': req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=300' });
  res.send(thumb ? item.thumb : item.buffer);
});

// Names the stage a book is in, for the progress bar.
function stageOf(slots, { name, story, pdfReady }) {
  const ref = slots[0];
  const pages = slots.slice(1);
  const busy = (s) => s.status === 'queued' || s.status === 'running';
  const done = pages.filter((s) => s.status === 'done').length;
  const who = name || 'your child';
  if (busy(ref)) {
    const label = ref.phase === 'checking' ? `Checking that the drawing looks like ${who}`
      : ref.attempt > 1 ? `Drawing ${who} as ${story.heroRole} again (try ${ref.attempt} of ${MAX_ATTEMPTS})`
      : `Drawing ${who} as ${story.heroRole}`;
    return { step: 1, label };
  }
  const working = pages.filter(busy);
  if (working.length) {
    const retrying = working.filter((s) => s.attempt > 1).length;
    const checking = working.filter((s) => s.phase === 'checking').length;
    if (retrying) return { step: 3, label: `Redrawing ${retrying} ${retrying === 1 ? 'page' : 'pages'} that failed the check, ${done} of ${pages.length} ready` };
    if (checking === working.length) return { step: 3, label: `Checking the last ${checking === 1 ? 'page' : `${checking} pages`}, ${done} of ${pages.length} ready` };
    return { step: 2, label: `Drawing the pages, ${done} of ${pages.length} ready` };
  }
  if (pdfReady) return { step: 4, label: 'Book ready: the PDF can be downloaded' };
  const failed = slots.filter((s) => s.status === 'error').length;
  if (failed) return { step: 3, label: `${failed} ${failed === 1 ? 'picture' : 'pictures'} could not be drawn` };
  return { step: 3, label: done === pages.length ? "Add the child's name to finish the PDF" : 'Some pages are not drawn yet' };
}

async function bookJson(row) {
  const [rows, est, cost, [made]] = await Promise.all([
    store.getSlots(row.id), store.estimateMs(), store.bookCost(row.id),
    query(`select ms from events where book_id = $1 and kind = 'book.done' order by id desc limit 1`, [row.id]),
  ]);
  const story = storyOf(row.story);
  if (await store.ensureSlots(row.id, rows.map((r) => r.slot))) return bookJson(row);
  const bySlot = Object.fromEntries(rows.map((r) => [r.slot, r]));
  // Books made before the front cover existed have an empty cover slot: draw it once,
  // at no charge, as soon as the book is opened.
  const cover = bySlot.cover;
  if (cover && cover.status === 'empty' && !cover.has_image && bySlot.reference?.has_image
    && !rows.some((r) => r.status === 'queued' || r.status === 'running') && !jobs.isActive(row.id, 'cover')) {
    try {
      await jobs.startGeneration({ bookId: row.id, userId: row.user_id, slots: ['cover'], purpose: 'upgrade' });
      return bookJson(row);
    } catch (err) {
      log.warn({ err, bookId: row.id }, 'could not start the missing cover');
    }
  }
  const slots = await Promise.all(SLOTS.map(async (def) => {
    const r = bySlot[def.id] || { status: 'empty' };
    let { status, error } = r;
    // Queued or running in the database, but not on this server: a restart cut it off.
    if ((status === 'queued' || status === 'running') && !jobs.isActive(row.id, def.id)) {
      error = 'This picture was interrupted because the server restarted. Try again.';
      status = r.has_image ? 'done' : 'error';
      await store.markFailed(row.id, def.id, error);
    }
    const url = (size) => (r.has_image ? `/api/books/${row.id}/images/${def.id}?${size ? `size=${size}&` : ''}v=${r.version}` : null);
    return {
      id: def.id, label: def.label, kind: def.kind, status, error: error || null,
      startedAt: msOf(r.started_at), finishedAt: msOf(r.finished_at),
      estimateMs: est[def.kind] ?? est.page,
      imageUrl: url(''), thumbUrl: url('thumb'),
      canUndo: Boolean(r.can_undo),
      // The quality loop: which drawing is under way, how many were made, which was kept.
      attempt: r.attempt || 0, phase: r.phase || null,
      attempts: r.attempts || 0, chosen: r.chosen ?? null, maxAttempts: MAX_ATTEMPTS,
      score: r.score ?? null, passed: r.passed ?? null, history: r.history || [],
      source: r.source || null,
      // Where the layout step put the text, and why.
      zone: r.zone || null, tone: r.tone || null, layoutReason: r.layout_reason || null,
    };
  }));
  const about = normalizeAbout(row.about);
  const busy = slots.some((s) => s.status === 'queued' || s.status === 'running');
  const pdfReady = !busy && Boolean(about.name) && slots.every((s) => s.imageUrl);
  // The proof approval is tied to exactly what would be printed.
  const fingerprint = printing.bookFingerprint(rows, about, story.id);
  const orders = await query('select * from print_orders where book_id = $1 and user_id = $2 and status <> $3 order by id desc', [row.id, row.user_id, 'awaiting_payment']);
  return {
    id: row.id, story: story.id, storyTitle: story.title, about, createdAt: msOf(row.created_at), updatedAt: msOf(row.updated_at),
    photoUrl: `/api/books/${row.id}/images/photo`,
    busy, pdfReady,
    stage: { ...stageOf(slots, { name: about.name, story, pdfReady }), steps: STAGES },
    madeInMs: made?.ms ?? null,
    refunded: Boolean(row.refunded),
    approval: { approved: pdfReady && row.approved_hash === fingerprint, approvedAt: msOf(row.approved_at), stale: Boolean(row.approved_hash) && row.approved_hash !== fingerprint },
    orders: orders.map(printing.orderJson),
    cost: { totalUsd: cost.total, firstDrawingsUsd: cost.first_drawings, retriesUsd: cost.retries, checksUsd: cost.checks, drawings: cost.n_first, retries: cost.n_retries, checks: cost.n_checks, priceCents: billing.PRICE_CENTS },
    now: Date.now(),
    slots,
  };
}

// Nothing inappropriate gets printed: the name must be a real-sounding name, and the
// About Me details must be fit for a children's book (src/moderation.js).
function fieldError(fields) {
  const err = new HttpError(422, Object.values(fields)[0]);
  err.fields = fields;
  return err;
}
async function assertPrintable(about) {
  const check = await checkAbout(about);
  if (!check.ok) throw fieldError(check.errors);
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
    r.cover_v != null ? `/api/books/${r.id}/images/cover?size=thumb&v=${r.cover_v}`
    : r.page1_v != null ? `/api/books/${r.id}/images/p01?size=thumb&v=${r.page1_v}`
    : r.ref_v != null ? `/api/books/${r.id}/images/reference?size=thumb&v=${r.ref_v}`
    : null;
  res.json({
    books: rows.map((r) => ({
      id: r.id, story: r.story, storyTitle: storyOf(r.story).title, name: normalizeAbout(r.about).name,
      createdAt: msOf(r.created_at), updatedAt: msOf(r.updated_at),
      thumbUrl: thumb(r), done: r.done, total: r.total, busy: Boolean(r.busy),
      pdfUrl: !r.busy && r.done >= r.total ? `/api/books/${r.id}/pdf` : null,
    })),
  });
});

app.post('/api/books', requireUser, async (req, res) => {
  const photo = parseImage(req.body?.photo, 'photo');
  const storyId = req.body?.story;
  if (!Object.hasOwn(STORIES, storyId)) throw new HttpError(400, 'Choose a story.');
  const about = normalizeAbout(req.body?.about);
  if (!about.name) throw new HttpError(400, "Add the child's name: it is printed in the story.");
  await assertPrintable(about);
  if ((await store.countBooks(req.userId)) >= MAX_BOOKS) {
    throw new HttpError(429, `You have ${MAX_BOOKS} books, which is the limit. Delete one to make another.`);
  }
  await jobs.checkBookBudget(req.userId);
  const story = STORIES[storyId];
  // The $0.99 leaves the balance first; it comes back if the book can't even start.
  const txId = await billing.chargeBook(req.userId, `${story.title}, starring ${about.name}`);
  let bookId;
  try {
    bookId = await store.createBook(req.userId, { buffer: Buffer.from(photo.data, 'base64'), mimeType: photo.mimeType }, { story: storyId, about });
    await billing.attachBook(txId, bookId);
    await jobs.startGeneration({ bookId, userId: req.userId, slots: SLOTS.map((s) => s.id), purpose: 'book' });
  } catch (err) {
    await billing.refundBook(req.userId, null, 'the book could not be started');
    if (bookId) await store.deleteBook(bookId);
    throw err;
  }
  await store.logEvent({ userId: req.userId, bookId, kind: 'book.create', detail: { story: storyId } });
  const row = await store.getBookRow(bookId, req.userId);
  res.status(201).json({ book: await bookJson(row), balanceCents: await billing.balance(req.userId) });
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
  if (!about.name) throw fieldError({ name: "Add the child's name: it is printed in the story." });
  await assertPrintable(about);
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
  const img = slot === 'photo' ? await store.getPhoto(row.id)
    : Object.hasOwn(SLOT_BY_ID, slot) ? await store.getImage(row.id, slot, { thumb: req.query.size === 'thumb' })
    : null;
  if (!img) throw new HttpError(404, 'No picture here yet.');
  res.set({ 'Content-Type': img.mimeType, 'Cache-Control': req.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache' });
  res.send(img.buffer);
});

// The stored PDF, or a fresh one if something changed since it was built. No model call.
app.get('/api/books/:id/pdf', requireUser, async (req, res) => {
  const row = await ownBook(req);
  const about = normalizeAbout(row.about);
  if (!about.name) throw new HttpError(400, "Add the child's name for the About Me page.");
  const pdf = (await store.getPdf(row.id)) || (await buildAndStorePdf(row.id));
  if (!pdf) throw new HttpError(400, "Some pages haven't been made yet.");
  const story = storyOf(row.story);
  const file = `${about.name.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'My'}-${story.title.replace(/[^A-Za-z]/g, '')}.pdf`;
  await store.logEvent({ userId: req.userId, bookId: row.id, kind: 'book.pdf' });
  const disposition = req.query.view === '1' ? 'inline' : 'attachment';
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${disposition}; filename="${file}"`, 'Cache-Control': 'private, no-cache' });
  res.send(pdf);
});

// --- Printed copies ---------------------------------------------------------------------
const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

app.get('/api/print/options', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    priceCents: printing.PRINT_PRICE_CENTS,
    product: 'Hardcover, 6 × 9 in, full colour, 24 pages',
    shipping: printing.SHIPPING,
    states: printing.US_STATES,
  });
});

// The family has looked through the proof and approves it for printing.
app.post('/api/books/:id/approve', requireUser, async (req, res) => {
  const row = await ownBook(req);
  const book = await bookJson(row);
  if (!book.pdfReady) throw new HttpError(400, 'Finish the book first: every picture drawn and the child’s name filled in.');
  await assertPrintable(book.about);
  const rows = await store.getSlots(row.id);
  await store.setApproval(row.id, printing.bookFingerprint(rows, book.about, row.story));
  await store.logEvent({ userId: req.userId, bookId: row.id, kind: 'book.approve' });
  res.json({ book: await bookJson(await ownBook(req)) });
});

app.delete('/api/books/:id/approve', requireUser, async (req, res) => {
  const row = await ownBook(req);
  await store.setApproval(row.id, null);
  res.json({ book: await bookJson(await ownBook(req)) });
});

// Address and shipping in; a Stripe payment page out. Nothing goes to the printer until
// Stripe confirms the payment.
app.post('/api/books/:id/print-order', requireUser, async (req, res) => {
  const row = await ownBook(req);
  const book = await bookJson(row);
  if (!book.approval.approved) throw new HttpError(409, book.approval.stale ? 'The book changed after you approved it. Please look through the proof and approve it again.' : 'Please look through the proof and approve it first.');
  await assertPrintable(book.about);
  const { address, errors } = printing.normalizeAddress(req.body?.address);
  if (Object.keys(errors).length) throw fieldError(errors);
  const level = req.body?.shippingLevel;
  if (!printing.SHIPPING_BY_LEVEL[level]) throw new HttpError(400, 'Choose a shipping speed.');
  const story = storyOf(row.story);
  const rows = await store.getSlots(row.id);
  const order = await printing.createOrder({ userId: req.userId, book: row, about: book.about, story, address, level, fingerprint: printing.bookFingerprint(rows, book.about, row.story) });
  await store.logEvent({ userId: req.userId, bookId: row.id, kind: 'print.checkout', detail: { orderId: order.id, level } });
  res.json(await billing.createPrintCheckout({ userId: req.userId, order, bookId: row.id, baseUrl: baseUrl(req) }));
});

app.get('/api/orders', requireUser, async (req, res) => {
  const rows = await printing.listOrders(req.userId);
  const fresh = await Promise.all(rows.map((o) => printing.refreshOrder(o, { onFail: billing.refundPrintOrder })));
  res.json({ orders: fresh.map(printing.orderJson) });
});

// The printer downloads the print files from here. The token in the link is the key.
app.get('/print-files/:id/:token/:file', async (req, res) => {
  const which = req.params.file.replace(/\.pdf$/, '');
  const pdf = await printing.printFile(req.params.id, req.params.token, which);
  if (!pdf) return res.status(404).end();
  res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="${which}.pdf"` });
  res.send(pdf);
});

billing.setPrintPaidHandler((orderId) => printing.submitOrder(orderId, { baseUrl: process.env.PUBLIC_URL || `http://localhost:${PORT}`, onFail: billing.refundPrintOrder }));

// --- Account and money ----------------------------------------------------------------

// Balance, every credit and debit, and refunds.
app.get('/api/account', requireUser, async (req, res) => {
  res.json(await billing.accountJson(await store.getUser(req.userId)));
});

// The cost report: what books cost to make (from the API call log), next to the price.
app.get('/api/costs', requireUser, async (req, res) => {
  const [site, mine, setupUsd, books, orders] = await Promise.all([
    store.costSummary(), store.costSummary({ userId: req.userId }), library.libraryCost(), store.bookCosts(req.userId),
    query(`select id, title, status, total_cents, print_cost_usd, shipping_level, provider, created_at from print_orders where user_id = $1 and status <> 'awaiting_payment' order by id desc limit 50`, [req.userId]),
  ]);
  const shape = (c) => ({
    books: c.books, totalUsd: c.total, averageUsd: c.books ? c.total / c.books : null,
    firstDrawingsUsd: c.first_drawings, retriesUsd: c.retries, checksUsd: c.checks,
    drawings: c.n_first, retries: c.n_retries, checks: c.n_checks,
  });
  res.json({
    priceCents: billing.PRICE_CENTS, site: shape(site), mine: shape(mine), setupUsd,
    books: books.map((b) => ({
      id: b.id, title: `${normalizeAbout(b.about).name || 'Untitled'} in ${storyOf(b.story).title}`, createdAt: msOf(b.created_at),
      totalUsd: b.total, drawings: b.n_first, retries: b.n_retries, checks: b.n_checks,
    })),
    print: { priceCents: printing.PRINT_PRICE_CENTS, shipping: printing.SHIPPING, printer: printing.printerMode() },
    orders: orders.map((o) => ({ id: o.id, title: o.title, status: o.status, totalCents: o.total_cents, printCostUsd: o.print_cost_usd == null ? null : Number(o.print_cost_usd), shippingLevel: o.shipping_level, provider: o.provider, createdAt: msOf(o.created_at) })),
  });
});

app.post('/api/billing/checkout', requireUser, async (req, res) => {
  res.json(await billing.createCheckout({ userId: req.userId, amountCents: req.body?.amountCents, baseUrl: baseUrl(req) }));
});

// Stripe sends the browser back here after a payment. The session is checked with Stripe before any credit.
async function afterPayment(res, result) {
  if (result.purpose === 'print') {
    const order = result.orderId ? await printing.getOrder(result.orderId) : null;
    return res.redirect(order?.book_id ? `/?book=${encodeURIComponent(order.book_id)}&order=${result.status === 'paid' ? 'placed' : result.status}` : '/?view=account');
  }
  res.redirect(`/?view=account&funding=${result.status}`);
}
app.get('/billing/return', async (req, res) => {
  const result = typeof req.query.session_id === 'string' ? await billing.confirmSession(req.query.session_id) : { status: 'unknown' };
  await afterPayment(res, result);
});

// Local and test runs without a Stripe key: a stand-in for Stripe's payment page.
app.get('/billing/mock-pay', async (req, res) => {
  if (billing.stripeMode() !== 'mock') return res.status(404).end();
  await afterPayment(res, await billing.confirmSession(String(req.query.session_id || ''), { mockPaid: true }));
});

app.post('/api/billing/refunds', requireUser, async (req, res) => {
  const id = await billing.requestRefund({ userId: req.userId, paymentId: req.body?.paymentId, reason: req.body?.reason });
  res.status(201).json({ refundId: id });
});

app.post('/api/billing/refunds/:id/process', requireUser, async (req, res) => {
  await billing.processRefund({ refundId: req.params.id, user: await store.getUser(req.userId) });
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500 && !(err instanceof HttpError)) log.error({ err }, 'unhandled error');
  const message = err instanceof HttpError ? err.message : status === 413 ? 'That upload is too large.' : 'Something went wrong on the server.';
  res.status(status).json({ error: message, ...(err.fields ? { fields: err.fields } : {}) });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await db(); // connect and create the tables before taking traffic
  await library.seedLibrary(); // the character bible and the pre-made scenes
  app.listen(PORT, () => log.info(`Jack and the Beanstalk on http://localhost:${PORT} (model ${MODEL}${isMock() ? ', MOCK images' : ''})`));
}

export default app;
