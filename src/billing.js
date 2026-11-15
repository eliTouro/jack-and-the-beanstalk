// Accounts and money. A user funds their account through Stripe Checkout (sandbox),
// every book takes $0.99 from the balance, and a top-up can be refunded.
//
// The balance is never stored on its own: it is the sum of the user's rows in
// `transactions`, so the history page and the balance can't disagree.
//
// Stripe is only ever used in test mode: a key that doesn't start with sk_test_ is
// ignored. Without a key, local runs and the tests use a mock checkout that "pays"
// at once; in production payments are simply off.
import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';
import { query } from './db.js';
import { HttpError } from './image.js';
import { log } from './log.js';

export const PRICE_CENTS = 99;
// Credit is bought by the book: any whole number of books, up to MAX_FUND.
const MIN_FUND = PRICE_CENTS;
const MAX_FUND = 50 * PRICE_CENTS;

const PROD = process.env.NODE_ENV === 'production';
const KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
if (KEY && !KEY.startsWith('sk_test_')) log.warn('STRIPE_SECRET_KEY is not a test key, so it is ignored: this app only runs Stripe in test mode');
// STRIPE_MOCK=1 (set by mock.env) forces the simulated checkout even when a key is present.
export const stripeMode = () => (process.env.STRIPE_MOCK === '1' && !PROD ? 'mock' : KEY.startsWith('sk_test_') ? 'test' : PROD ? 'off' : 'mock');

let client;
const stripe = () => (client ??= new Stripe(KEY, { maxNetworkRetries: 1, timeout: 20_000 }));

const ADMINS = new Set((process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
export const isAdmin = (user) => Boolean(user?.email && ADMINS.has(user.email.toLowerCase()));

export const dollars = (cents) => `$${(Math.abs(cents) / 100).toFixed(2)}`;
const day = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// ---- the ledger ------------------------------------------------------------------
export async function balance(userId) {
  const [row] = await query('select coalesce(sum(amount_cents), 0)::int as cents from transactions where user_id = $1', [userId]);
  return row.cents;
}

// Adds one row. A debit that would take the balance below zero inserts nothing and returns null.
async function addTx({ userId, amount, kind, description, bookId = null, paymentId = null, refundId = null }) {
  const rows = await query(
    `insert into transactions (user_id, amount_cents, kind, description, book_id, payment_id, refund_id, balance_after)
     select $1::bigint, $2::int, $3, $4, $5::uuid, $6::bigint, $7::bigint, b.cents + $2::int
     from (select coalesce(sum(amount_cents), 0)::int as cents from transactions where user_id = $1::bigint) b
     where b.cents + $2::int >= 0 or $2::int >= 0
     on conflict do nothing
     returning id, balance_after`,
    [userId, amount, kind, description, bookId, paymentId, refundId],
  );
  return rows[0] || null;
}

// ---- $0.99 per book ----------------------------------------------------------------
export async function chargeBook(userId, title) {
  const tx = await addTx({ userId, amount: -PRICE_CENTS, kind: 'book', description: `Book made: ${title}` });
  if (!tx) {
    throw new HttpError(402, `A book costs ${dollars(PRICE_CENTS)} and your balance is ${dollars(await balance(userId))}. Add money to your account first.`, 'insufficient_funds');
  }
  return tx.id;
}
export const attachBook = (txId, bookId) => query('update transactions set book_id = $2 where id = $1', [txId, bookId]);

// Gives the $0.99 back when a book could not be made at all.
export async function refundBook(userId, bookId, why) {
  return addTx({ userId, amount: PRICE_CENTS, kind: 'book_refund', description: `Book not made, ${dollars(PRICE_CENTS)} returned: ${why}`, bookId });
}

// ---- funding through Stripe Checkout -------------------------------------------------
export async function createCheckout({ userId, amountCents, baseUrl }) {
  const amount = Math.round(Number(amountCents));
  if (!Number.isFinite(amount) || amount < MIN_FUND || amount > MAX_FUND) {
    throw new HttpError(400, `Choose between 1 and ${MAX_FUND / PRICE_CENTS} books.`);
  }
  const mode = stripeMode();
  if (mode === 'off') throw new HttpError(503, 'Payments are not set up on this server yet.');
  let sessionId, url;
  if (mode === 'mock') {
    sessionId = `mock_${randomBytes(12).toString('hex')}`;
    url = `/billing/mock-pay?session_id=${sessionId}`;
  } else {
    let session;
    try {
      session = await stripe().checkout.sessions.create({
        mode: 'payment',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount, product_data: { name: amount % PRICE_CENTS === 0 ? `Picture book credit: ${amount / PRICE_CENTS} ${amount === PRICE_CENTS ? 'book' : 'books'}` : 'Picture book credit', description: `${dollars(PRICE_CENTS)} a book` } } }],
        success_url: `${baseUrl}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/?view=account&funding=cancelled`,
        client_reference_id: String(userId),
        metadata: { app: 'beanstalk', user_id: String(userId) },
      });
    } catch (err) {
      log.error({ type: err?.type, code: err?.code, status: err?.statusCode, message: err?.message }, 'stripe checkout failed');
      throw new HttpError(502, 'Stripe could not start the payment. Please try again.');
    }
    sessionId = session.id;
    url = session.url;
  }
  await query('insert into payments (user_id, session_id, amount_cents) values ($1, $2, $3)', [userId, sessionId, amount]);
  return { url };
}

// Looks the session up at Stripe and, if it was paid, credits the account exactly once.
// Safe to call any number of times. Returns 'paid' | 'pending' | 'expired' | 'unknown'.
export async function confirmSession(sessionId, { mockPaid = false } = {}) {
  const [pay] = await query('select id, user_id, amount_cents, status from payments where session_id = $1', [sessionId]);
  if (!pay) return 'unknown';
  if (pay.status === 'paid') return 'paid';
  let paid = false, intent = null, expired = false;
  if (sessionId.startsWith('mock_')) {
    if (stripeMode() !== 'mock') return 'unknown';
    paid = mockPaid; intent = `mock_pi_${sessionId.slice(5)}`;
  } else {
    try {
      const s = await stripe().checkout.sessions.retrieve(sessionId);
      // Never trust the redirect alone: the amount and the owner come from Stripe.
      paid = s.payment_status === 'paid' && s.amount_total === pay.amount_cents && s.client_reference_id === String(pay.user_id);
      intent = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id || null;
      expired = s.status === 'expired';
    } catch (err) {
      log.error({ type: err?.type, message: err?.message }, 'stripe session lookup failed');
      return 'pending';
    }
  }
  if (!paid) {
    if (expired) await query(`update payments set status = 'expired' where id = $1`, [pay.id]);
    return expired ? 'expired' : 'pending';
  }
  await query(`update payments set status = 'paid', payment_intent = $2, paid_at = now() where id = $1 and status <> 'paid'`, [pay.id, intent]);
  // The unique index on (payment_id) where kind = 'fund' makes a second credit impossible.
  await addTx({ userId: pay.user_id, amount: pay.amount_cents, kind: 'fund', description: `Added ${dollars(pay.amount_cents)} with Stripe`, paymentId: pay.id });
  log.info({ event: 'billing.fund', userId: pay.user_id, cents: pay.amount_cents }, 'billing.fund');
  return 'paid';
}

// Picks up payments whose redirect never arrived (the tab was closed on Stripe's page).
async function reconcile(userId) {
  const rows = await query(
    `select session_id from payments where user_id = $1 and status = 'pending' and created_at > now() - interval '2 days' order by id desc limit 4`,
    [userId],
  );
  await Promise.all(rows.filter((r) => !r.session_id.startsWith('mock_')).map((r) => confirmSession(r.session_id)));
}

// ---- refunds: the user asks, then it is processed at Stripe --------------------------
export async function requestRefund({ userId, paymentId, reason }) {
  const [pay] = await query(`select id, amount_cents, paid_at from payments where id = $1 and user_id = $2 and status = 'paid'`, [Number(paymentId) || 0, userId]);
  if (!pay) throw new HttpError(404, "That payment doesn't exist.");
  const [used] = await query(`select coalesce(sum(amount_cents), 0)::int as cents from refunds where payment_id = $1 and status in ('requested', 'processed')`, [pay.id]);
  const amount = Math.min(pay.amount_cents - used.cents, await balance(userId));
  if (amount <= 0) throw new HttpError(400, 'There is nothing left to refund on that payment: it has been spent or already refunded.');
  const why = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const [refund] = await query('insert into refunds (user_id, payment_id, amount_cents, reason) values ($1, $2, $3, $4) returning id', [userId, pay.id, amount, why || null]);
  // The money leaves the balance now, so it can't be spent while the refund waits.
  const tx = await addTx({ userId, amount: -amount, kind: 'refund', description: `Refund of the ${day(pay.paid_at)} top-up`, paymentId: pay.id, refundId: refund.id });
  if (!tx) {
    await query('delete from refunds where id = $1', [refund.id]);
    throw new HttpError(409, 'Your balance changed. Please try again.');
  }
  log.info({ event: 'billing.refund.request', userId, cents: amount }, 'billing.refund.request');
  return refund.id;
}

export async function processRefund({ refundId, user }) {
  const [r] = await query(
    `select r.id, r.user_id, r.amount_cents, r.status, p.payment_intent, p.session_id
     from refunds r join payments p on p.id = r.payment_id where r.id = $1`,
    [Number(refundId) || 0],
  );
  const mode = stripeMode();
  // In the sandbox the person who asked may also press "process", so the whole flow can
  // be seen from one account. With real money only an admin could.
  const allowed = r && (isAdmin(user) || (r.user_id === user.id && mode !== 'off'));
  if (!allowed) throw new HttpError(404, "That refund doesn't exist.");
  const claimed = await query(`update refunds set status = 'processing' where id = $1 and status = 'requested' returning id`, [r.id]);
  if (!claimed.length) throw new HttpError(409, 'That refund has already been processed.');
  try {
    let stripeId;
    if (r.session_id.startsWith('mock_')) stripeId = `mock_re_${randomBytes(6).toString('hex')}`;
    else {
      const re = await stripe().refunds.create({ payment_intent: r.payment_intent, amount: r.amount_cents, reason: 'requested_by_customer', metadata: { app: 'beanstalk', refund_id: String(r.id) } });
      stripeId = re.id;
    }
    await query(`update refunds set status = 'processed', stripe_refund_id = $2, processed_at = now() where id = $1`, [r.id, stripeId]);
    log.info({ event: 'billing.refund.process', userId: r.user_id, cents: r.amount_cents }, 'billing.refund.process');
  } catch (err) {
    log.error({ type: err?.type, message: err?.message }, 'stripe refund failed');
    await query(`update refunds set status = 'failed', error = $2, processed_at = now() where id = $1`, [r.id, String(err?.message || 'Stripe refused the refund').slice(0, 300)]);
    await addTx({ userId: r.user_id, amount: r.amount_cents, kind: 'refund_reversal', description: 'Refund failed at Stripe, money returned to your balance', refundId: r.id });
    throw new HttpError(502, 'Stripe could not process that refund, so the money is back in your balance.');
  }
}

// ---- everything the account page shows -------------------------------------------------
const msOf = (d) => (d ? new Date(d).getTime() : null);

export async function accountJson(user) {
  if (stripeMode() === 'test') await reconcile(user.id);
  const [cents, txs, pays, refunds] = await Promise.all([
    balance(user.id),
    query(
      `select t.id, t.at, t.amount_cents, t.kind, t.description, t.book_id, t.balance_after, r.status as refund_status, r.stripe_refund_id
       from transactions t left join refunds r on r.id = t.refund_id
       where t.user_id = $1 order by t.id desc limit 200`,
      [user.id],
    ),
    query(
      `select p.id, p.amount_cents, p.paid_at,
         coalesce((select sum(amount_cents) from refunds r where r.payment_id = p.id and r.status in ('requested', 'processing', 'processed')), 0)::int as refunded
       from payments p where p.user_id = $1 and p.status = 'paid' order by p.id desc limit 50`,
      [user.id],
    ),
    query(
      `select r.id, r.amount_cents, r.reason, r.status, r.stripe_refund_id, r.error, r.requested_at, r.processed_at, r.user_id, u.email
       from refunds r join users u on u.id = r.user_id
       where r.user_id = $1 or ($2 and r.status = 'requested') order by r.id desc limit 50`,
      [user.id, isAdmin(user)],
    ),
  ]);
  const mode = stripeMode();
  return {
    balanceCents: cents,
    priceCents: PRICE_CENTS,
    maxFundCents: MAX_FUND,
    stripeMode: mode,
    isAdmin: isAdmin(user),
    transactions: txs.map((t) => ({
      id: t.id, at: msOf(t.at), amountCents: t.amount_cents, kind: t.kind, description: t.description,
      bookId: t.book_id, balanceAfterCents: t.balance_after, refundStatus: t.refund_status || null, stripeRefundId: t.stripe_refund_id || null,
    })),
    payments: pays.map((p) => ({
      id: p.id, amountCents: p.amount_cents, paidAt: msOf(p.paid_at), refundedCents: p.refunded,
      refundableCents: Math.max(0, Math.min(p.amount_cents - p.refunded, cents)),
    })),
    refunds: refunds.map((r) => ({
      id: r.id, amountCents: r.amount_cents, reason: r.reason, status: r.status, stripeRefundId: r.stripe_refund_id, error: r.error,
      requestedAt: msOf(r.requested_at), processedAt: msOf(r.processed_at),
      mine: r.user_id === user.id, email: r.user_id === user.id ? null : r.email,
      canProcess: r.status === 'requested' && (isAdmin(user) || (r.user_id === user.id && mode !== 'off')),
    })),
  };
}
