// Data access: users, books, their pictures, the event log and the API cost log.
import { randomUUID } from 'node:crypto';
import { query, toBuffer } from './db.js';
import { log } from './log.js';
import { SLOTS } from './book.js';
import { isMock } from './image.js';
import { tokensOf } from './cost.js';

// ---- users -----------------------------------------------------------------------
export async function upsertUser({ sub, email, name, picture }) {
  const [user] = await query(
    `insert into users (google_sub, email, name, picture) values ($1, $2, $3, $4)
     on conflict (google_sub) do update set email = $2, name = $3, picture = $4, last_login_at = now()
     returning id, email, name, picture`,
    [sub, email, name, picture],
  );
  return user;
}

export async function getUser(id) {
  const [user] = await query('select id, email, name, picture from users where id = $1', [id]);
  return user || null;
}

// ---- events (also the source of the progress-bar time estimates) -----------------
export async function logEvent({ userId = null, bookId = null, kind, slot = null, ms: took = null, detail = null }) {
  log.info({ event: kind, userId, bookId, slot, ms: took, ...(detail || {}) }, kind);
  try {
    await query('insert into events (user_id, book_id, kind, slot, ms, detail) values ($1, $2, $3, $4, $5, $6)', [
      userId, bookId, kind, slot, took, detail ? JSON.stringify(detail) : null,
    ]);
  } catch (err) {
    log.error({ err, kind }, 'could not write event');
  }
}

export async function countEvents(kind, { userId = null, sinceMs }) {
  const [row] = await query(
    `select count(*)::int as n from events where kind = $1 and at > to_timestamp($2 / 1000.0) and ($3::bigint is null or user_id = $3)`,
    [kind, Date.now() - sinceMs, userId],
  );
  return row.n;
}

// Average time of the last 40 successful drawings of each kind, cached for a minute.
const FALLBACK_MS = { reference: 16000, page: 24000, fix: 24000 };
let estimates = { at: 0, value: FALLBACK_MS };
export async function estimateMs() {
  if (Date.now() - estimates.at < 60_000) return estimates.value;
  const rows = await query(
    `select k, avg(ms)::int as avg from (
       select detail->>'kind' as k, ms, row_number() over (partition by detail->>'kind' order by at desc) as rn
       from events where kind = 'image.done' and ms is not null) t
     where rn <= 40 group by k`,
  );
  const value = { ...FALLBACK_MS };
  for (const r of rows) if (r.k in value) value[r.k] = r.avg;
  estimates = { at: Date.now(), value };
  return value;
}

// ---- API cost log -------------------------------------------------------------------
// One row per paid API call: every drawing, every retry, every picture check.
export async function logCall({ userId = null, bookId = null, slot = null, kind, purpose, attempt = 1, model = null, usage = null, costUsd = 0, ms = null, ok = true }) {
  const t = tokensOf(usage);
  try {
    await query(
      `insert into api_calls (user_id, book_id, slot, kind, purpose, attempt, model, tokens_in, tokens_out, cost_usd, ms, ok, mock)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [userId, bookId, slot, kind, purpose, attempt, model, t.in, t.out, costUsd, ms, ok, isMock()],
    );
  } catch (err) {
    log.error({ err }, 'could not write api call');
  }
}

const COST_COLUMNS = `
  coalesce(sum(cost_usd), 0)::float as total,
  coalesce(sum(cost_usd) filter (where kind = 'image' and attempt = 1), 0)::float as first_drawings,
  coalesce(sum(cost_usd) filter (where kind = 'image' and attempt > 1), 0)::float as retries,
  coalesce(sum(cost_usd) filter (where kind = 'analysis'), 0)::float as checks,
  count(*) filter (where kind = 'image' and attempt = 1)::int as n_first,
  count(*) filter (where kind = 'image' and attempt > 1)::int as n_retries,
  count(*) filter (where kind = 'analysis')::int as n_checks`;

// What every book cost to make, summed, so the caller can show the average next to the price.
export async function costSummary({ userId = null } = {}) {
  const [row] = await query(
    `select count(distinct book_id)::int as books, ${COST_COLUMNS}
     from api_calls where book_id is not null and mock = $1 and ($2::bigint is null or user_id = $2)`,
    [isMock(), userId],
  );
  return row;
}

export async function bookCost(bookId) {
  const [row] = await query(`select ${COST_COLUMNS} from api_calls where book_id = $1`, [bookId]);
  return row;
}

// ---- books -----------------------------------------------------------------------
export const TEMPLATE_VERSION = 2; // 20-page template; version 1 was the 4-page book

export async function createBook(userId, photo, { story, about }) {
  const id = randomUUID();
  await query('insert into books (id, user_id, photo, photo_mime, story, about, template) values ($1, $2, $3, $4, $5, $6, $7)', [
    id, userId, photo.buffer, photo.mimeType, story, JSON.stringify(about), TEMPLATE_VERSION,
  ]);
  await query('insert into book_images (book_id, slot) select $1, unnest($2::text[])', [id, SLOTS.map((s) => s.id)]);
  return id;
}

export async function countBooks(userId) {
  const [row] = await query('select count(*)::int as n from books where user_id = $1 and template = $2', [userId, TEMPLATE_VERSION]);
  return row.n;
}

export async function countRecentBooks(userId, sinceMs) {
  const [row] = await query('select count(*)::int as n from books where user_id = $1 and created_at > to_timestamp($2 / 1000.0)', [userId, Date.now() - sinceMs]);
  return row.n;
}

// The book row (no image bytes) if it belongs to this user, else null.
export async function getBookRow(bookId, userId) {
  if (!/^[0-9a-f-]{36}$/i.test(bookId || '')) return null;
  const [row] = await query(
    'select id, user_id, story, about, refunded, created_at, updated_at, pdf is not null as has_pdf from books where id = $1 and user_id = $2 and template = $3',
    [bookId, userId, TEMPLATE_VERSION],
  );
  return row || null;
}

export async function getBookForJob(bookId) {
  const [row] = await query('select id, user_id, story, about, refunded from books where id = $1', [bookId]);
  return row || null;
}

export async function getSlots(bookId) {
  return query(
    `select slot, status, error, version, started_at, finished_at, attempt, phase, attempts, chosen, score, passed,
       zone, tone, layout_reason, source, analysis->'history' as history,
       data is not null as has_image, prev_data is not null as can_undo
     from book_images where book_id = $1`,
    [bookId],
  );
}

export async function listBooks(userId) {
  return query(
    `select b.id, b.story, b.about, b.created_at, b.updated_at,
       count(*) filter (where i.status = 'done')::int as done,
       count(*)::int as total,
       bool_or(i.status in ('queued', 'running')) as busy,
       max(case when i.slot = 'p01' and i.data is not null then i.version end) as page1_v,
       max(case when i.slot = 'reference' and i.data is not null then i.version end) as ref_v
     from books b join book_images i on i.book_id = b.id
     where b.user_id = $1 and b.template = $2 group by b.id order by b.created_at desc`,
    [userId, TEMPLATE_VERSION],
  );
}

export async function saveAbout(bookId, about) {
  await query('update books set about = $2, updated_at = now(), pdf = null where id = $1', [bookId, JSON.stringify(about)]);
}

export async function deleteBook(bookId) {
  await query('delete from books where id = $1', [bookId]);
}

export async function getPhoto(bookId) {
  const [row] = await query('select photo, photo_mime from books where id = $1', [bookId]);
  return row ? { buffer: toBuffer(row.photo), mimeType: row.photo_mime } : null;
}

export async function getImage(bookId, slot, { thumb = false } = {}) {
  const col = thumb ? 'coalesce(thumb, data)' : 'data';
  const [row] = await query(
    `select ${col} as data, case when ${thumb ? 'thumb is not null' : 'false'} then 'image/webp' else mime end as mime
     from book_images where book_id = $1 and slot = $2 and data is not null`,
    [bookId, slot],
  );
  return row ? { buffer: toBuffer(row.data), mimeType: row.mime } : null;
}

// Everything the PDF needs for one page.
export async function getPageForPdf(bookId, slot) {
  const [row] = await query('select data, mime, zone, tone from book_images where book_id = $1 and slot = $2 and data is not null', [bookId, slot]);
  return row ? { buffer: toBuffer(row.data), mimeType: row.mime, zone: row.zone, tone: row.tone } : null;
}

export async function getPdf(bookId) {
  const [row] = await query('select pdf from books where id = $1', [bookId]);
  return toBuffer(row?.pdf);
}
export const savePdf = (bookId, pdf) => query('update books set pdf = $2 where id = $1', [bookId, pdf]);
export const markRefunded = (bookId) => query('update books set refunded = true where id = $1 and refunded = false returning id', [bookId]);

// ---- picture status changes --------------------------------------------------------
export const markQueued = (bookId, slots) =>
  query(`update book_images set status = 'queued', error = null, started_at = null, finished_at = null, attempt = 0, phase = null where book_id = $1 and slot = any($2)`, [bookId, slots]);

export const markRunning = (bookId, slot) =>
  query(`update book_images set status = 'running', error = null, started_at = now(), finished_at = null, attempt = 1, phase = 'drawing' where book_id = $1 and slot = $2`, [bookId, slot]);

// Which drawing is under way, and whether it is being drawn or checked.
export const markStep = (bookId, slot, attempt, phase) =>
  query('update book_images set attempt = $3, phase = $4 where book_id = $1 and slot = $2', [bookId, slot, attempt, phase]);

// A fresh picture replaces the old one. meta: { attempts, chosen, score, passed, analysis, zone, tone, layoutReason, source }.
export async function saveImage(bookId, slot, { buffer, mimeType, thumb }, meta, { keepPrevious = false } = {}) {
  const prev = keepPrevious
    ? `prev_data = data, prev_thumb = thumb, prev_meta = jsonb_build_object('attempts', attempts, 'chosen', chosen, 'score', score, 'passed', passed, 'zone', zone, 'tone', tone, 'layout_reason', layout_reason, 'analysis', analysis)`
    : 'prev_data = null, prev_thumb = null, prev_meta = null';
  await query(
    `update book_images set status = 'done', error = null, finished_at = now(), version = version + 1, phase = null, ${prev},
       data = $3, mime = $4, thumb = $5, attempts = $6, chosen = $7, score = $8, passed = $9, analysis = $10,
       zone = $11, tone = $12, layout_reason = $13, source = $14
     where book_id = $1 and slot = $2`,
    [bookId, slot, buffer, mimeType, thumb, meta.attempts, meta.chosen, meta.score, meta.passed, JSON.stringify(meta.analysis || null),
      meta.zone || null, meta.tone || null, meta.layoutReason || null, meta.source || 'generated'],
  );
  await query('update books set updated_at = now(), pdf = null where id = $1', [bookId]);
}

// Failed with no picture to fall back on: status 'error'. Failed redo of an existing
// picture: the picture stays ('done') and the message is shown next to it.
export const markFailed = (bookId, slot, message) =>
  query(
    `update book_images set status = case when data is null then 'error' else 'done' end, error = $3, finished_at = now(), phase = null
     where book_id = $1 and slot = $2`,
    [bookId, slot, message],
  );

export async function undoImage(bookId, slot) {
  const rows = await query(
    `update book_images set data = prev_data, thumb = prev_thumb, version = version + 1, error = null,
       attempts = coalesce((prev_meta->>'attempts')::int, attempts), chosen = (prev_meta->>'chosen')::int,
       score = (prev_meta->>'score')::real, passed = (prev_meta->>'passed')::boolean,
       zone = prev_meta->>'zone', tone = prev_meta->>'tone', layout_reason = prev_meta->>'layout_reason', analysis = prev_meta->'analysis',
       prev_data = null, prev_thumb = null, prev_meta = null
     where book_id = $1 and slot = $2 and prev_data is not null returning slot`,
    [bookId, slot],
  );
  if (rows.length) await query('update books set pdf = null where id = $1', [bookId]);
  return rows.length > 0;
}
