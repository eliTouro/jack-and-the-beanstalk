// Data access: users, books, their pictures, and the event log.
import { randomUUID } from 'node:crypto';
import { query, toBuffer } from './db.js';
import { log } from './log.js';
import { SLOTS } from './book.js';

const ms = (d) => (d ? new Date(d).getTime() : null);

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

// Average time of the last 20 successful image calls of each kind, cached for a minute.
const FALLBACK_MS = { reference: 15000, cast: 20000, page: 20000, fix: 20000 };
let estimates = { at: 0, value: FALLBACK_MS };
export async function estimateMs() {
  if (Date.now() - estimates.at < 60_000) return estimates.value;
  const rows = await query(
    `select k, avg(ms)::int as avg from (
       select detail->>'kind' as k, ms, row_number() over (partition by detail->>'kind' order by at desc) as rn
       from events where kind = 'image.done' and ms is not null) t
     where rn <= 20 group by k`,
  );
  const value = { ...FALLBACK_MS };
  for (const r of rows) if (r.k in value) value[r.k] = r.avg;
  estimates = { at: Date.now(), value };
  return value;
}

// ---- books -----------------------------------------------------------------------
export async function createBook(userId, photo) {
  const id = randomUUID();
  await query('insert into books (id, user_id, photo, photo_mime) values ($1, $2, $3, $4)', [id, userId, photo.buffer, photo.mimeType]);
  for (const s of SLOTS) await query('insert into book_images (book_id, slot) values ($1, $2)', [id, s.id]);
  return id;
}

export async function countBooks(userId) {
  const [row] = await query('select count(*)::int as n from books where user_id = $1', [userId]);
  return row.n;
}

// The book row (no image bytes) if it belongs to this user, else null.
export async function getBookRow(bookId, userId) {
  if (!/^[0-9a-f-]{36}$/i.test(bookId || '')) return null;
  const [row] = await query('select id, user_id, about, created_at, updated_at from books where id = $1 and user_id = $2', [bookId, userId]);
  return row || null;
}

export async function getSlots(bookId) {
  return query(
    `select slot, status, error, version, started_at, finished_at, data is not null as has_image, prev_data is not null as can_undo
     from book_images where book_id = $1`,
    [bookId],
  );
}

export async function listBooks(userId) {
  return query(
    `select b.id, b.about, b.created_at, b.updated_at,
       count(*) filter (where i.status = 'done')::int as done,
       count(*)::int as total,
       bool_or(i.status in ('queued', 'running')) as busy,
       max(case when i.slot = 'cupboard' and i.data is not null then i.version end) as page1_v,
       max(case when i.slot = 'reference' and i.data is not null then i.version end) as ref_v
     from books b join book_images i on i.book_id = b.id
     where b.user_id = $1 group by b.id order by b.created_at desc`,
    [userId],
  );
}

export async function saveAbout(bookId, about) {
  await query('update books set about = $2, updated_at = now() where id = $1', [bookId, JSON.stringify(about)]);
}

export async function deleteBook(bookId) {
  await query('delete from books where id = $1', [bookId]);
}

export async function getPhoto(bookId) {
  const [row] = await query('select photo, photo_mime from books where id = $1', [bookId]);
  return row ? { buffer: toBuffer(row.photo), mimeType: row.photo_mime } : null;
}

export async function getImage(bookId, slot) {
  const [row] = await query('select data, mime from book_images where book_id = $1 and slot = $2 and data is not null', [bookId, slot]);
  return row ? { buffer: toBuffer(row.data), mimeType: row.mime } : null;
}

// ---- picture status changes --------------------------------------------------------
export const markQueued = (bookId, slots) =>
  query(`update book_images set status = 'queued', error = null, started_at = null, finished_at = null where book_id = $1 and slot = any($2)`, [bookId, slots]);

export const markRunning = (bookId, slot) =>
  query(`update book_images set status = 'running', error = null, started_at = now(), finished_at = null where book_id = $1 and slot = $2`, [bookId, slot]);

// A fresh picture replaces the old one and clears any undo.
export async function saveImage(bookId, slot, img, { keepPrevious = false } = {}) {
  await query(
    `update book_images set status = 'done', error = null, mime = $3, finished_at = now(), version = version + 1,
       prev_data = ${keepPrevious ? 'data' : 'null'}, data = $4
     where book_id = $1 and slot = $2`,
    [bookId, slot, img.mimeType, Buffer.from(img.data, 'base64')],
  );
  await query('update books set updated_at = now() where id = $1', [bookId]);
}

// Failed with no picture to fall back on: status 'error'. Failed edit of an existing
// picture: the picture stays ('done') and the message is shown next to it.
export const markFailed = (bookId, slot, message) =>
  query(
    `update book_images set status = case when data is null then 'error' else 'done' end, error = $3, finished_at = now()
     where book_id = $1 and slot = $2`,
    [bookId, slot, message],
  );

export async function undoImage(bookId, slot) {
  const rows = await query(
    `update book_images set data = prev_data, prev_data = null, version = version + 1, error = null
     where book_id = $1 and slot = $2 and prev_data is not null returning slot`,
    [bookId, slot],
  );
  return rows.length > 0;
}
