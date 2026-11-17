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
-- ---- homework 4: stories, the quality loop, layout, money and API cost -------------
alter table books add column if not exists story text not null default 'jack';
alter table books add column if not exists template int not null default 1;
alter table books add column if not exists pdf bytea;
alter table books add column if not exists refunded boolean not null default false;

alter table book_images add column if not exists thumb bytea;
alter table book_images add column if not exists prev_thumb bytea;
alter table book_images add column if not exists prev_meta jsonb;
alter table book_images add column if not exists attempt int not null default 0;   -- drawing in progress
alter table book_images add column if not exists phase text;                      -- 'drawing' | 'checking'
alter table book_images add column if not exists attempts int not null default 0;  -- drawings made for the saved picture
alter table book_images add column if not exists chosen int;                      -- which drawing was kept
alter table book_images add column if not exists score real;
alter table book_images add column if not exists passed boolean;
alter table book_images add column if not exists analysis jsonb;
alter table book_images add column if not exists zone text;                       -- where the text goes
alter table book_images add column if not exists tone text;
alter table book_images add column if not exists layout_reason text;
alter table book_images add column if not exists source text;                     -- 'generated' | 'template'

-- The character bible: one picture per character per story ('hero' is the stand-in).
create table if not exists characters (
  story text not null,
  id text not null,
  name text not null,
  description text not null,
  data bytea not null,
  mime text not null,
  thumb bytea,
  hash text,
  meta jsonb,
  updated_at timestamptz not null default now(),
  primary key (story, id)
);

-- The pre-made scenes: 20 per story, one per template page.
create table if not exists scenes (
  story text not null,
  page text not null,
  data bytea not null,
  mime text not null,
  thumb bytea,
  hash text,
  meta jsonb,
  updated_at timestamptz not null default now(),
  primary key (story, page)
);

-- Money. A user's balance is the sum of their transactions (cents, signed).
create table if not exists payments (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  session_id text unique not null,
  payment_intent text,
  amount_cents int not null,
  status text not null default 'pending',     -- pending | paid | expired
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create table if not exists refunds (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  payment_id bigint not null references payments(id) on delete cascade,
  amount_cents int not null,
  reason text,
  status text not null default 'requested',   -- requested | processed | failed
  stripe_refund_id text,
  error text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz
);
create table if not exists transactions (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id bigint not null references users(id) on delete cascade,
  amount_cents int not null,                  -- credit > 0, debit < 0
  kind text not null,                         -- fund | book | book_refund | refund | refund_reversal
  description text not null,
  book_id uuid,
  payment_id bigint,
  refund_id bigint,
  balance_after int not null
);
create index if not exists transactions_by_user on transactions (user_id, id desc);
create unique index if not exists one_credit_per_payment on transactions (payment_id) where kind = 'fund';

-- Every call to a paid API, with what it cost us.
create table if not exists api_calls (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id bigint,
  book_id uuid,
  slot text,
  kind text not null,                         -- image | analysis
  purpose text not null,                      -- book | redo | fix
  attempt int not null default 1,
  model text,
  tokens_in int,
  tokens_out int,
  cost_usd numeric(12,6) not null default 0,
  ms int,
  ok boolean not null default true,
  mock boolean not null default false
);
create index if not exists api_calls_by_book on api_calls (book_id);

-- ---- homework 5: print and ship ------------------------------------------------------
alter table books add column if not exists approved_hash text;   -- fingerprint of the approved proof
alter table books add column if not exists approved_at timestamptz;
alter table payments add column if not exists purpose text not null default 'fund';  -- fund | print
alter table payments add column if not exists order_id bigint;
create unique index if not exists one_print_payment on transactions (payment_id) where kind = 'print_payment';

create table if not exists print_orders (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  book_id uuid,                                  -- kept even if the book is deleted later
  title text not null,
  status text not null default 'awaiting_payment', -- awaiting_payment | preparing | submitted | in_production | shipped | failed | canceled
  shipping_level text not null,
  address jsonb not null,
  price_cents int not null,
  shipping_cents int not null,
  total_cents int not null,
  approved_hash text not null,
  file_token text not null,
  interior_pdf bytea,
  cover_pdf bytea,
  cover_dims jsonb,
  provider text,
  provider_job_id text,
  provider_status text,
  provider_message text,
  customer_message text,
  print_cost_usd numeric(10,2),
  tracking_url text,
  carrier text,
  refunded boolean not null default false,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  submitted_at timestamptz,
  shipped_at timestamptz,
  checked_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists print_orders_by_user on print_orders (user_id, id desc);
`;

async function connect() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: pg } = await import('pg');
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    const pool = new pg.Pool({ connectionString: url, max: 8, ssl: local ? false : { rejectUnauthorized: false } });
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
