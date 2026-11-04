// Postgres in production (DATABASE_URL, e.g. Neon); an in-memory PGlite (real Postgres
// compiled to WebAssembly) for local runs and tests, so the same SQL runs everywhere.
import { log } from './log.js';

const SCHEMA = `
create table if not exists users (
  id bigserial primary key,
  google_sub text unique not null,
  email text,
  name text,
  picture text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create table if not exists books (
  id uuid primary key,
  user_id bigint not null references users(id) on delete cascade,
  about jsonb not null default '{}',
  photo bytea not null,
  photo_mime text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists books_by_user on books (user_id, created_at desc);

-- One row per picture in a book: reference, cast, and each page.
create table if not exists book_images (
  book_id uuid not null references books(id) on delete cascade,
  slot text not null,
  status text not null default 'empty',
  error text,
  data bytea,
  mime text,
  prev_data bytea,
  version int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  primary key (book_id, slot)
);

-- Event log: sign-ins, books, and every image call with its duration.
create table if not exists events (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id bigint,
  book_id uuid,
  kind text not null,
  slot text,
  ms int,
  detail jsonb
);
create index if not exists events_by_kind on events (kind, at desc);
create index if not exists events_by_user on events (user_id, at desc);
`;

async function connect() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: pg } = await import('pg');
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    const pool = new pg.Pool({ connectionString: url, max: 5, ssl: local ? false : { rejectUnauthorized: false } });
    pool.on('error', (err) => log.error({ err }, 'postgres pool error'));
    log.info('database: postgres (DATABASE_URL)');
    return { query: (sql, params) => pool.query(sql, params), exec: (sql) => pool.query(sql), close: () => pool.end() };
  }
  if (process.env.NODE_ENV === 'production') {
    log.warn('database: DATABASE_URL is not set, so books live in memory and vanish on restart');
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  return { query: (sql, params) => db.query(sql, params), exec: (sql) => db.exec(sql), close: () => db.close() };
}

let ready;
// Lazily connects and creates the tables once.
export function db() {
  ready ??= connect().then(async (conn) => {
    await conn.exec(SCHEMA);
    return conn;
  });
  return ready;
}

export async function query(sql, params = []) {
  const { rows } = await (await db()).query(sql, params);
  return rows;
}

// bytea comes back as a Buffer from pg and a Uint8Array from PGlite.
export const toBuffer = (v) => (v == null ? null : Buffer.isBuffer(v) ? v : Buffer.from(v));
