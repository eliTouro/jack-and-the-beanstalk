// Draws a book's pictures on the server and saves each one as soon as it's ready, so
// the browser only polls for progress and a closed tab doesn't lose the book.
//
// Order: the reference and the cast sheet at the same time, then every page at the
// same time (each page needs only those two images). One API call per
// picture, no automatic retries: a failed picture is marked failed and the user
// decides whether to try it again.
import { generateImage, HttpError, MODEL } from './image.js';
import { referencePrompt, castPrompt, pagePrompt, fixPrompt, PAGES, SLOT_BY_ID } from './book.js';
import * as store from './store.js';
import { log } from './log.js';

const PAGE_IDS = PAGES.map((p) => p.id);
const SIZE = { reference: '1024x1024', cast: '1536x1024', page: '1024x1536' };

const LIMIT_PER_USER_HOUR = Number(process.env.IMAGES_PER_HOUR || 30);
const LIMIT_SITE_DAY = Number(process.env.IMAGES_PER_DAY || 300);

// Pictures being drawn by this server process ("bookId:slot"). A slot marked
// queued/running in the database but missing here was cut off by a restart.
const active = new Set();
const key = (bookId, slot) => `${bookId}:${slot}`;
export const isActive = (bookId, slot) => active.has(key(bookId, slot));

const toB64 = (img) => ({ data: img.buffer.toString('base64'), mimeType: img.mimeType });

async function spendBudget(userId, count) {
  const hour = await store.countEvents('image.start', { userId, sinceMs: 3600_000 });
  if (hour + count > LIMIT_PER_USER_HOUR) {
    throw new HttpError(429, `That would go over the limit of ${LIMIT_PER_USER_HOUR} pictures per hour. Please come back a little later.`);
  }
  const day = await store.countEvents('image.start', { sinceMs: 86_400_000 });
  if (day + count > LIMIT_SITE_DAY) {
    throw new HttpError(429, 'The site has made all the pictures it can for today. Please try again tomorrow.');
  }
}

// Redrawing Jack or the cast changes what every page is built on, so the pages follow.
export function expandSlots(slots) {
  const wanted = new Set(slots.filter((s) => SLOT_BY_ID[s]));
  if (wanted.has('reference') || wanted.has('cast')) PAGE_IDS.forEach((p) => wanted.add(p));
  return Object.keys(SLOT_BY_ID).filter((s) => wanted.has(s));
}

// Validates, reserves budget, marks the slots queued, then draws in the background.
export async function startGeneration({ bookId, userId, slots }) {
  const todo = expandSlots(slots);
  if (!todo.length) throw new HttpError(400, 'Say which pictures to draw.');
  if (todo.some((s) => active.has(key(bookId, s)))) throw new HttpError(409, 'That picture is already being drawn.');
  await spendBudget(userId, todo.length);
  todo.forEach((s) => active.add(key(bookId, s)));
  await store.markQueued(bookId, todo);
  run({ bookId, userId, todo }).catch((err) => log.error({ err, bookId }, 'generation run crashed'));
}

async function run({ bookId, userId, todo }) {
  const photo = await store.getPhoto(bookId);
  const first = todo.filter((s) => s === 'reference' || s === 'cast');
  const pages = todo.filter((s) => PAGE_IDS.includes(s));

  await Promise.allSettled(first.map((slot) => drawSlot({ bookId, userId, slot, photo })));
  if (!pages.length) return;

  const [reference, cast] = await Promise.all([store.getImage(bookId, 'reference'), store.getImage(bookId, 'cast')]);
  if (!reference || !cast) {
    const msg = `Jack and the cast must be drawn before the pages. ${!reference ? 'Your Jack' : 'The cast'} failed, so try that first.`;
    await Promise.all(pages.map(async (slot) => { await store.markFailed(bookId, slot, msg); active.delete(key(bookId, slot)); }));
    return;
  }
  await Promise.allSettled(pages.map((slot) => drawSlot({ bookId, userId, slot, photo, reference, cast })));
}

async function drawSlot({ bookId, userId, slot, photo, reference, cast }) {
  const kind = SLOT_BY_ID[slot].kind;
  const call =
    kind === 'reference' ? { prompt: referencePrompt(), images: [toB64(photo)] }
    : kind === 'cast' ? { prompt: castPrompt(), images: [toB64(photo)] }
    : { prompt: pagePrompt(slot), images: [toB64(reference), toB64(cast)] };
  await withTiming({ bookId, userId, slot, kind }, async () => {
    const img = await generateImage({ ...call, size: SIZE[kind] });
    await store.saveImage(bookId, slot, img);
  });
}

// "Fix something on this page": an edit of the existing page, keeping the old one for undo.
export async function startFix({ bookId, userId, pageId, instruction }) {
  if (!PAGE_IDS.includes(pageId)) throw new HttpError(400, 'Unknown page.');
  if (active.has(key(bookId, pageId))) throw new HttpError(409, 'That page is already being drawn.');
  const [page, reference] = await Promise.all([store.getImage(bookId, pageId), store.getImage(bookId, 'reference')]);
  if (!page || !reference) throw new HttpError(400, 'Make this page before fixing it.');
  await spendBudget(userId, 1);
  active.add(key(bookId, pageId));
  await store.markQueued(bookId, [pageId]);
  withTiming({ bookId, userId, slot: pageId, kind: 'fix', instruction }, async () => {
    const img = await generateImage({ prompt: fixPrompt(pageId, instruction), images: [toB64(page), toB64(reference)], size: SIZE.page });
    await store.saveImage(bookId, pageId, img, { keepPrevious: true });
  }).catch((err) => log.error({ err, bookId }, 'fix crashed'));
}

// Marks the slot running, times the call, logs it, and records success or failure.
async function withTiming({ bookId, userId, slot, kind, instruction }, work) {
  const detail = { kind, model: MODEL, ...(instruction ? { instruction } : {}) };
  await store.markRunning(bookId, slot);
  await store.logEvent({ userId, bookId, kind: 'image.start', slot, detail });
  const t0 = Date.now();
  try {
    await work();
    await store.logEvent({ userId, bookId, kind: 'image.done', slot, ms: Date.now() - t0, detail });
  } catch (err) {
    const message = err instanceof HttpError ? err.message : 'Something went wrong drawing this picture.';
    if (!(err instanceof HttpError)) log.error({ err, bookId, slot }, 'image failed');
    await store.markFailed(bookId, slot, kind === 'fix' ? `The fix didn't work: ${message}` : message);
    await store.logEvent({ userId, bookId, kind: 'image.error', slot, ms: Date.now() - t0, detail: { ...detail, error: message } });
  } finally {
    active.delete(key(bookId, slot));
  }
}
