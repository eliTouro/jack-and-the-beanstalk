// Draws a book's pictures on the server and saves each one as soon as it's ready, so
// the browser only polls for progress and a closed tab doesn't lose the book.
//
// Order of work for a new book:
//   1. Pages the hero is not on are copied straight from the pre-made scenes (instant).
//   2. The reference: the child drawn as the hero, from the photo.
//   3. Every other page at the same time: the pre-made scene is edited so its stand-in
//      hero becomes this child.
//   4. The PDF is built and stored.
// Every drawing goes through the quality loop (src/quality.js): draw, check, and draw
// again on failure, at most 3 drawings, best one kept. Every API call is logged with
// its cost (store.logCall).
import sharp from 'sharp';
import { generateImage, HttpError, MODEL } from './image.js';
import { analyzeImage } from './analyze.js';
import { drawWithQuality, MAX_ATTEMPTS } from './quality.js';
import { layoutFor } from './layout.js';
import { referencePrompt, pagePrompt, pageFromScratchPrompt, fixPrompt, storyOf, pageText, normalizeAbout, PAGE_IDS, SLOT_BY_ID } from './book.js';
import { getScene, getCharacter, makeThumb } from './library.js';
import { buildAndStorePdf } from './bookpdf.js';
import * as billing from './billing.js';
import * as store from './store.js';
import { log } from './log.js';

const SIZE = { reference: '1024x1024', page: '1024x1536' };
const BOOKS_PER_HOUR = Number(process.env.BOOKS_PER_HOUR || 6);
const REDOS_PER_HOUR = Number(process.env.REDOS_PER_HOUR || 40);
// A new book stops starting fresh drawings this long after it began, so the whole book
// lands inside a minute. Redoing one page later has no such limit.
const BOOK_DEADLINE_MS = Number(process.env.BOOK_DEADLINE_MS || 40_000);
const REFERENCE_DEADLINE_MS = Number(process.env.REFERENCE_DEADLINE_MS || 16_000);
// Input pictures are sent small. The model bills input pictures by size, and a test showed
// the same page quality from a 640 px scene and a 384 px reference at about a third less cost.
const SCENE_INPUT_PX = Number(process.env.SCENE_INPUT_PX || 640);
const REFERENCE_INPUT_PX = Number(process.env.REFERENCE_INPUT_PX || 384);
// A page drawing normally takes 13-18 s. Now and then one call hangs for 40 s or more
// and would hold the whole book up, so in a new book a call still running after this
// long gets a second, identical call, and the first to finish is used. Both are paid for
// and both are logged.
const STRAGGLER_MS = Number(process.env.STRAGGLER_MS || 21_000);

async function withBackup(call, onLoser) {
  const first = call();
  let timer;
  const state = await Promise.race([
    first.then(() => 'settled', () => 'settled'),
    new Promise((r) => { timer = setTimeout(r, STRAGGLER_MS, 'slow'); }),
  ]);
  clearTimeout(timer);
  if (state === 'settled') return first;
  const second = call();
  const winner = await Promise.any([first.then((v) => ({ v, loser: second })), second.then((v) => ({ v, loser: first }))])
    .catch((agg) => { throw agg.errors?.[0] || agg; });
  winner.loser.then(onLoser, () => {});
  return winner.v;
}

// Pictures being drawn by this server process ("bookId:slot"). A slot marked
// queued/running in the database but missing here was cut off by a restart.
const active = new Set();
const key = (bookId, slot) => `${bookId}:${slot}`;
export const isActive = (bookId, slot) => active.has(key(bookId, slot));

const b64 = (buffer, mimeType = 'image/jpeg') => ({ data: buffer.toString('base64'), mimeType });
const shrink = async (buffer, width) => b64(await sharp(buffer).resize({ width, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer());

export async function checkBookBudget(userId) {
  if ((await store.countRecentBooks(userId, 3600_000)) >= BOOKS_PER_HOUR) {
    throw new HttpError(429, `You've made ${BOOKS_PER_HOUR} books this hour, which is the limit. Please come back a little later.`);
  }
}

// Redrawing the hero changes what every page is built on, so the hero's pages follow.
export function expandSlots(slots, story) {
  const wanted = new Set(slots.filter((s) => SLOT_BY_ID[s]));
  if (wanted.has('reference')) story.pages.filter((p) => p.hero).forEach((p) => wanted.add(p.id));
  return Object.keys(SLOT_BY_ID).filter((s) => wanted.has(s));
}

// Marks the slots queued, then draws in the background.
export async function startGeneration({ bookId, userId, slots, purpose = 'redo' }) {
  const book = await store.getBookForJob(bookId);
  const story = storyOf(book.story);
  const todo = expandSlots(slots, story);
  if (!todo.length) throw new HttpError(400, 'Say which pictures to draw.');
  if (todo.some((s) => active.has(key(bookId, s)))) throw new HttpError(409, 'That picture is already being drawn.');
  if (purpose !== 'book' && (await store.countEvents('image.start', { userId, sinceMs: 3600_000 })) + todo.length > REDOS_PER_HOUR + 21 * BOOKS_PER_HOUR) {
    throw new HttpError(429, 'That is a lot of redrawing for one hour. Please come back a little later.');
  }
  todo.forEach((s) => active.add(key(bookId, s)));
  await store.markQueued(bookId, todo);
  const deadlineAt = purpose === 'book' ? Date.now() + BOOK_DEADLINE_MS : Infinity;
  run({ book, story, userId, todo, purpose, deadlineAt })
    .catch((err) => log.error({ err, bookId }, 'generation run crashed'))
    .finally(() => todo.forEach((s) => active.delete(key(bookId, s))));
}

async function run({ book, story, userId, todo, purpose, deadlineAt }) {
  const bookId = book.id;
  const t0 = Date.now();
  const name = normalizeAbout(book.about).name;
  const ctx = { bookId, userId, story, name, purpose };
  const pages = todo.filter((s) => PAGE_IDS.includes(s)).map((s) => story.pageById[s]);
  const scenes = Object.fromEntries(await Promise.all(pages.map(async (p) => [p.id, await getScene(story.id, p.id)])));

  // 1. Pages without the hero come straight from the template.
  const ready = pages.filter((p) => !p.hero && scenes[p.id]);
  const templateWork = Promise.allSettled(ready.map((p) => copyScene(ctx, p, scenes[p.id])));
  const toDraw = pages.filter((p) => !ready.includes(p));

  // 2. The reference.
  if (todo.includes('reference')) {
    const photo = await store.getPhoto(bookId);
    await drawSlot(ctx, 'reference', {
      kind: 'reference',
      deadlineAt: purpose === 'book' ? t0 + REFERENCE_DEADLINE_MS : Infinity,
      make: (_n, feedback) => generateImage({ prompt: referencePrompt(story, feedback), images: [b64(photo.buffer, photo.mimeType)], size: SIZE.reference }),
      check: (img, attempt) => analyzeImage({ image: Buffer.from(img.data, 'base64'), compare: photo.buffer, kind: 'reference', description: `one child, waist up, wearing: ${story.heroOutfit}`, slot: 'reference', attempt }),
    });
  }
  await templateWork;

  // 3. Every page that needs drawing, at the same time.
  if (toDraw.length) {
    const reference = await store.getImage(bookId, 'reference');
    if (!reference && toDraw.some((p) => p.hero)) {
      const msg = 'Your hero must be drawn before the pages. That picture failed, so try it first.';
      await Promise.all(toDraw.map((p) => store.markFailed(bookId, p.id, msg)));
    } else {
      const refSmall = reference ? await shrink(reference.buffer, REFERENCE_INPUT_PX) : null;
      await Promise.allSettled(toDraw.map((p) => drawPage(ctx, p, { scene: scenes[p.id], reference, refSmall, deadlineAt })));
    }
  }

  // 4. The PDF, and the money back if the book could not be made at all.
  if (purpose === 'book') {
    const slots = await store.getSlots(bookId);
    const made = slots.filter((s) => s.has_image && s.slot !== 'reference').length;
    if (made === 0) {
      const [first] = await store.markRefunded(bookId);
      if (first) await billing.refundBook(userId, bookId, 'the pictures could not be drawn');
    }
    await store.logEvent({ userId, bookId, kind: 'book.done', ms: Date.now() - t0, detail: { story: story.id, pages: made } });
  }
  await buildAndStorePdf(bookId).catch((err) => log.error({ err, bookId }, 'could not build the pdf'));
}

async function drawPage(ctx, page, { scene, reference, refSmall, deadlineAt }) {
  const { story } = ctx;
  let make;
  if (scene && page.hero) {
    // The normal path: the template scene, with its stand-in hero swapped for this child.
    const sceneImg = await shrink(scene.buffer, SCENE_INPUT_PX);
    const once = (feedback) => generateImage({ prompt: pagePrompt(story, page, feedback), images: [sceneImg, refSmall], size: SIZE.page });
    const logLoser = (attempt) => (img) => store.logCall({ userId: ctx.userId, bookId: ctx.bookId, slot: page.id, kind: 'image', purpose: ctx.purpose, attempt, model: img.model, usage: img.usage, costUsd: img.costUsd, ms: img.ms });
    make = (n, feedback) => (Number.isFinite(deadlineAt) ? withBackup(() => once(feedback), logLoser(n)) : once(feedback));
  } else {
    // No pre-made scene yet: draw the page from the reference and the bible pictures.
    const cast = (await Promise.all(page.cast.map((id) => getCharacter(story.id, id)))).filter(Boolean);
    const images = [...(page.hero ? [refSmall] : []), ...(await Promise.all(cast.map((c) => shrink(c.buffer, SCENE_INPUT_PX))))];
    const fallback = images.length ? images : [refSmall].filter(Boolean);
    make = (_n, feedback) => generateImage({ prompt: pageFromScratchPrompt(story, page, feedback), images: fallback, size: SIZE.page });
  }
  await drawSlot(ctx, page.id, {
    kind: 'page', page, deadlineAt, make,
    check: (img, attempt) => analyzeImage({
      image: Buffer.from(img.data, 'base64'), compare: page.hero ? reference?.buffer : null, kind: 'page',
      description: page.scene, hasHero: page.hero, slot: page.id, attempt,
    }),
  });
}

// A page the hero is not on: the pre-made scene is the page. It was drawn and checked
// by the same quality loop when the template was made, and keeps those numbers.
async function copyScene({ bookId, userId, story, name }, page, scene) {
  await store.markRunning(bookId, page.id);
  const m = scene.meta || {};
  const layout = await layoutFor({ buffer: scene.buffer, analysis: m.analysis, preferred: page.zone, text: pageText(page, name, story) });
  await store.saveImage(bookId, page.id, { buffer: scene.buffer, mimeType: scene.mimeType, thumb: scene.thumb }, {
    attempts: m.attempts || 1, chosen: m.chosen || 1, score: m.score ?? null, passed: m.passed ?? true,
    analysis: { history: m.history || [], ...(m.analysis || {}) },
    zone: layout.zone, tone: layout.tone, layoutReason: layout.reason, source: 'template',
  });
  await store.logEvent({ userId, bookId, kind: 'image.template', slot: page.id });
}

// One picture through the quality loop, saved with its thumbnail, check results and text layout.
async function drawSlot(ctx, slot, { kind, page = null, make, check, deadlineAt = Infinity, keepPrevious = false, instruction, maxAttempts = MAX_ATTEMPTS }) {
  const { bookId, userId, story, name, purpose } = ctx;
  const detail = { kind, model: MODEL, ...(instruction ? { instruction } : {}) };
  await store.markRunning(bookId, slot);
  await store.logEvent({ userId, bookId, kind: 'image.start', slot, detail });
  const t0 = Date.now();
  try {
    const result = await drawWithQuality({
      make, check, deadlineAt, maxAttempts,
      onStep: ({ attempt, phase }) => store.markStep(bookId, slot, attempt, phase),
      onCall: (c) => store.logCall({ userId, bookId, slot, kind: c.kind, purpose, attempt: c.attempt, model: c.model, usage: c.usage, costUsd: c.costUsd, ms: c.ms, ok: c.ok }),
    });
    const buffer = Buffer.from(result.image.data, 'base64');
    const a = result.analysis;
    const layout = page ? await layoutFor({ buffer, analysis: a, preferred: page.zone, text: pageText(page, name, story) }) : {};
    await store.saveImage(bookId, slot, { buffer, mimeType: result.image.mimeType, thumb: await makeThumb(buffer) }, {
      attempts: result.attempts, chosen: result.chosen, score: a.score, passed: result.passed,
      analysis: { history: result.history, summary: a.summary, likeness: a.likeness, sceneMatch: a.sceneMatch, faces: a.faces, objects: a.objects, clear: a.clear },
      zone: layout.zone, tone: layout.tone, layoutReason: layout.reason, source: 'generated',
    }, { keepPrevious });
    await store.logEvent({ userId, bookId, kind: 'image.done', slot, ms: Date.now() - t0, detail: { ...detail, attempts: result.attempts, chosen: result.chosen, score: a.score, passed: result.passed, zone: layout.zone } });
  } catch (err) {
    const message = err instanceof HttpError ? err.message : 'Something went wrong drawing this picture.';
    if (!(err instanceof HttpError)) log.error({ err, bookId, slot }, 'image failed');
    await store.markFailed(bookId, slot, kind === 'fix' ? `The fix didn't work: ${message}` : message);
    await store.logEvent({ userId, bookId, kind: 'image.error', slot, ms: Date.now() - t0, detail: { ...detail, error: message } });
  }
}

// "Fix something on this page": an edit of the existing page, keeping the old one for undo.
export async function startFix({ bookId, userId, pageId, instruction }) {
  if (!PAGE_IDS.includes(pageId)) throw new HttpError(400, 'Unknown page.');
  if (active.has(key(bookId, pageId))) throw new HttpError(409, 'That page is already being drawn.');
  const book = await store.getBookForJob(bookId);
  const story = storyOf(book.story);
  const page = story.pageById[pageId];
  const [current, reference] = await Promise.all([store.getImage(bookId, pageId), store.getImage(bookId, 'reference')]);
  if (!current || !reference) throw new HttpError(400, 'Make this page before fixing it.');
  if ((await store.countEvents('image.start', { userId, sinceMs: 3600_000 })) >= REDOS_PER_HOUR + 21 * BOOKS_PER_HOUR) {
    throw new HttpError(429, 'That is a lot of redrawing for one hour. Please come back a little later.');
  }
  active.add(key(bookId, pageId));
  await store.markQueued(bookId, [pageId]);
  const ctx = { bookId, userId, story, name: normalizeAbout(book.about).name, purpose: 'fix' };
  const images = [await shrink(current.buffer, SCENE_INPUT_PX), await shrink(reference.buffer, REFERENCE_INPUT_PX)];
  drawSlot(ctx, pageId, {
    kind: 'fix', page, keepPrevious: true, instruction,
    make: () => generateImage({ prompt: fixPrompt(story, page, instruction), images, size: SIZE.page }),
    check: (img, attempt) => analyzeImage({ image: Buffer.from(img.data, 'base64'), compare: page.hero ? reference.buffer : null, kind: 'page', description: page.scene, hasHero: page.hero, slot: pageId, attempt }),
  })
    .then(() => buildAndStorePdf(bookId))
    .catch((err) => log.error({ err, bookId }, 'fix crashed'))
    .finally(() => active.delete(key(bookId, pageId)));
}
