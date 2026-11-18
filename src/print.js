// Printed copies: pricing, the Lulu Print API (sandbox), and the order lifecycle.
//
//   1. The family opens the proof and approves it. The approval is tied to a fingerprint
//      of the book (every picture version, the name and details); any later change voids it.
//   2. They enter a delivery address and pick a shipping speed, then pay with Stripe.
//   3. When Stripe confirms the payment, the print files are built (interior with bleed,
//      case-wrap cover sized by Lulu's cover-dimensions endpoint), stored with the order,
//      and sent to Lulu as a print job. Lulu fetches them from a secret link on this site.
//   4. The order page asks Lulu for the job's status (at most once a minute per order).
//      A job Lulu rejects or cancels is refunded to the card automatically.
//
// Lulu is used only in its sandbox (api.sandbox.lulu.com): jobs there are never printed.
// Without LULU_CLIENT_KEY / LULU_CLIENT_SECRET a simulated printer stands in, moving the
// order through the same stages on a timer.
import { createHash, randomBytes } from 'node:crypto';
import { query, toBuffer } from './db.js';
import { HttpError } from './image.js';
import { PRINT } from './template.js';
import { FALLBACK_COVER_DIMS } from './pdf.js';
import { buildPrintFiles } from './bookpdf.js';
import { log } from './log.js';

// ---- price ----------------------------------------------------------------------------
// What a printed, shipped copy costs the customer. The math is in WRITEUP.md.
export const PRINT_PRICE_CENTS = Number(process.env.PRINT_PRICE_CENTS || 2899);
export const SHIPPING = [
  { level: 'MAIL', label: 'Standard', days: '11 to 13 business days', cents: 0 },
  { level: 'PRIORITY_MAIL', label: 'Priority', days: '9 to 11 business days, tracked', cents: 999 },
  { level: 'EXPEDITED', label: 'Expedited', days: '6 to 8 business days, tracked', cents: 1599 },
  { level: 'EXPRESS', label: 'Express', days: '5 to 7 business days, tracked', cents: 3099 },
];
export const SHIPPING_BY_LEVEL = Object.fromEntries(SHIPPING.map((s) => [s.level, s]));

export const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// ---- approval ---------------------------------------------------------------------------
// A fingerprint of everything that ends up on paper.
export function bookFingerprint(slots, about, story) {
  const parts = slots.map((s) => `${s.slot}:${s.version}:${s.zone || ''}:${s.tone || ''}`).sort();
  return createHash('sha256').update(JSON.stringify([story, about, parts])).digest('hex').slice(0, 24);
}

// ---- address --------------------------------------------------------------------------
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function normalizeAddress(input = {}) {
  const a = {
    name: clean(input.name, 60), street1: clean(input.street1, 80), street2: clean(input.street2, 80),
    city: clean(input.city, 50), state_code: clean(input.state_code, 2).toUpperCase(), postcode: clean(input.postcode, 10),
    country_code: 'US', phone_number: clean(input.phone_number, 20), email: clean(input.email, 120),
  };
  const errors = {};
  if (a.name.split(' ').filter(Boolean).length < 2) errors.name = 'Enter the full name of the person receiving the book.';
  if (a.street1.length < 4) errors.street1 = 'Enter the street address.';
  if (a.city.length < 2) errors.city = 'Enter the city.';
  if (!US_STATES[a.state_code]) errors.state_code = 'Choose the state.';
  if (!/^\d{5}(-\d{4})?$/.test(a.postcode)) errors.postcode = 'Enter a 5-digit ZIP code.';
  if (!/^\+?[\d\s\-.\/()]{10,20}$/.test(a.phone_number) || a.phone_number.replace(/\D/g, '').length < 10) errors.phone_number = 'Enter a phone number with area code. The carrier uses it only for delivery problems.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) errors.email = 'Enter an email address for delivery updates.';
  return { address: a, errors };
}

// ---- the printer ------------------------------------------------------------------------
const LULU_KEY = (process.env.LULU_CLIENT_KEY || '').trim();
const LULU_SECRET = (process.env.LULU_CLIENT_SECRET || '').trim();
const LULU_API = 'https://api.sandbox.lulu.com'; // sandbox only: never the production API
export const printerMode = () => (LULU_KEY && LULU_SECRET && process.env.PRINT_PROVIDER !== 'mock' ? 'lulu-sandbox' : 'simulated');

let token = { value: null, until: 0 };
async function luluToken() {
  if (token.value && Date.now() < token.until) return token.value;
  const res = await fetch(`${LULU_API}/auth/realms/glasstree/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${LULU_KEY}:${LULU_SECRET}`).toString('base64')}` },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Lulu sign-in failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  token = { value: j.access_token, until: Date.now() + (Number(j.expires_in || 3600) - 120) * 1000 };
  return token.value;
}

// For /healthz/printer: can this server sign in to the Lulu sandbox with its keys?
export async function checkSignIn() {
  if (printerMode() !== 'lulu-sandbox') return { printer: printerMode(), signIn: 'not configured' };
  try { await luluToken(); return { printer: 'lulu-sandbox', signIn: 'ok' }; }
  catch (err) { return { printer: 'lulu-sandbox', signIn: 'failed', error: err.message }; }
}

async function lulu(method, path, body) {
  const res = await fetch(`${LULU_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await luluToken()}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const err = new Error(`Lulu ${method} ${path} failed (${res.status}): ${text.slice(0, 400)}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

// Cover size in points for this book's page count (the printer decides the spine).
export async function coverDims() {
  if (printerMode() !== 'lulu-sandbox') return FALLBACK_COVER_DIMS;
  try {
    const d = await lulu('POST', '/cover-dimensions/', { pod_package_id: PRINT.podPackageId, interior_page_count: PRINT.interiorPages, unit: 'pt' });
    return { width: Number(d.width), height: Number(d.height) };
  } catch (err) {
    log.error({ message: err.message }, 'lulu cover-dimensions failed; using the known size');
    return FALLBACK_COVER_DIMS;
  }
}

// What Lulu charges us for one copy shipped to this address, if it can tell us.
export async function printCost(address, level) {
  if (printerMode() !== 'lulu-sandbox') return null;
  try {
    const c = await lulu('POST', '/print-job-cost-calculations/', {
      line_items: [{ page_count: PRINT.interiorPages, pod_package_id: PRINT.podPackageId, quantity: 1 }],
      shipping_address: { street1: address.street1, city: address.city, state_code: address.state_code, postcode: address.postcode, country_code: 'US', phone_number: address.phone_number },
      shipping_option: level,
    });
    return {
      printUsd: Number(c.line_item_costs?.[0]?.total_cost_incl_tax ?? 0),
      shippingUsd: Number(c.shipping_cost?.total_cost_incl_tax ?? 0),
      feesUsd: Number(c.fulfillment_cost?.total_cost_incl_tax ?? 0),
      totalUsd: Number(c.total_cost_incl_tax ?? 0),
    };
  } catch (err) {
    log.error({ message: err.message }, 'lulu cost calculation failed');
    return null;
  }
}

// ---- orders -------------------------------------------------------------------------------
const msOf = (d) => (d ? new Date(d).getTime() : null);

// The stage a customer sees, from our status and the printer's.
const STAGE = {
  awaiting_payment: { step: 0, label: 'Waiting for payment' },
  paid: { step: 1, label: 'Payment received' },
  preparing: { step: 1, label: 'Preparing the print files' },
  submitted: { step: 2, label: 'Sent to the printer' },
  in_production: { step: 3, label: 'Being printed' },
  shipped: { step: 4, label: 'Shipped' },
  canceled: { step: -1, label: 'Canceled' },
  failed: { step: -1, label: 'Could not be printed' },
};

export function orderJson(o) {
  const ship = SHIPPING_BY_LEVEL[o.shipping_level] || SHIPPING[0];
  const a = o.address || {};
  return {
    id: o.id, number: `BB-${String(o.id).padStart(5, '0')}`, bookId: o.book_id, title: o.title,
    status: o.status, stage: STAGE[o.status] || STAGE.paid, message: o.customer_message || null,
    shipping: { level: ship.level, label: ship.label, days: ship.days },
    shipTo: a.name ? `${a.name}, ${a.city}, ${a.state_code} ${a.postcode}` : '',
    totalCents: o.total_cents, priceCents: o.price_cents, shippingCents: o.shipping_cents,
    trackingUrl: o.tracking_url || null, carrier: o.carrier || null,
    createdAt: msOf(o.created_at), paidAt: msOf(o.paid_at), shippedAt: msOf(o.shipped_at),
  };
}

export async function createOrder({ userId, book, about, story, address, level, fingerprint }) {
  const ship = SHIPPING_BY_LEVEL[level];
  if (!ship) throw new HttpError(400, 'Choose a shipping speed.');
  const total = PRINT_PRICE_CENTS + ship.cents;
  const title = `${story.title}, starring ${about.name}`;
  const [row] = await query(
    `insert into print_orders (user_id, book_id, title, shipping_level, address, price_cents, shipping_cents, total_cents, approved_hash, file_token)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [userId, book.id, title, level, JSON.stringify(address), PRINT_PRICE_CENTS, ship.cents, total, fingerprint, randomBytes(24).toString('hex')],
  );
  return row;
}

export const getOrder = async (id) => (await query('select * from print_orders where id = $1', [id]))[0] || null;
export const listOrders = (userId) => query('select * from print_orders where user_id = $1 and status <> $2 order by id desc limit 50', [userId, 'awaiting_payment']);
const setOrder = (id, fields) => {
  const keys = Object.keys(fields);
  return query(`update print_orders set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [id, ...keys.map((k) => fields[k])]);
};

// The printer fetches the files from here, with the order's secret token in the link.
export async function printFile(orderId, tokenValue, which) {
  const [o] = await query('select file_token, interior_pdf, cover_pdf from print_orders where id = $1', [Number(orderId) || 0]);
  if (!o || !o.file_token || tokenValue !== o.file_token) return null;
  return toBuffer(which === 'interior' ? o.interior_pdf : which === 'cover' ? o.cover_pdf : null);
}

// Called once Stripe has confirmed the payment. Builds the files and sends the job.
// onFail(order, message) refunds the customer.
export async function submitOrder(orderId, { baseUrl, onFail }) {
  const claimed = await query(`update print_orders set status = 'preparing', paid_at = coalesce(paid_at, now()), updated_at = now() where id = $1 and status in ('awaiting_payment', 'paid') returning *`, [orderId]);
  const order = claimed[0];
  if (!order) return;
  try {
    const dims = await coverDims();
    const files = await buildPrintFiles(order.book_id, dims);
    if (!files) throw new Error('The book is no longer complete.');
    await setOrder(order.id, { interior_pdf: files.interior, cover_pdf: files.cover, cover_dims: JSON.stringify(dims) });
    const fileUrl = (which) => `${baseUrl}/print-files/${order.id}/${order.file_token}/${which}.pdf`;
    if (printerMode() === 'lulu-sandbox') {
      const a = order.address;
      const job = await lulu('POST', '/print-jobs/', {
        external_id: `BB-${order.id}`,
        contact_email: process.env.LULU_CONTACT_EMAIL || a.email,
        shipping_level: order.shipping_level,
        shipping_address: { name: a.name, street1: a.street1, ...(a.street2 ? { street2: a.street2 } : {}), city: a.city, state_code: a.state_code, postcode: a.postcode, country_code: 'US', phone_number: a.phone_number, email: a.email },
        line_items: [{
          external_id: `BB-${order.id}-1`, title: order.title.slice(0, 250), quantity: 1,
          printable_normalization: { pod_package_id: PRINT.podPackageId, interior: { source_url: fileUrl('interior') }, cover: { source_url: fileUrl('cover') } },
        }],
      });
      await setOrder(order.id, { status: 'submitted', provider: 'lulu-sandbox', provider_job_id: String(job.id), provider_status: job.status?.name || 'CREATED', submitted_at: new Date() });
    } else {
      await setOrder(order.id, { status: 'submitted', provider: 'simulated', provider_job_id: `SIM-${order.id}`, provider_status: 'CREATED', submitted_at: new Date() });
    }
    log.info({ event: 'print.submitted', orderId: order.id, provider: printerMode() }, 'print.submitted');
  } catch (err) {
    log.error({ message: err.message, orderId: order.id }, 'print order failed');
    await setOrder(order.id, { status: 'failed', provider_message: String(err.message).slice(0, 500), customer_message: 'We could not send this book to the printer, so your payment has been refunded.' });
    await onFail?.(await getOrder(order.id));
  }
}

// Asks the printer how an order is doing, at most once a minute per order.
export async function refreshOrder(order, { onFail } = {}) {
  if (!['submitted', 'in_production'].includes(order.status)) return order;
  if (order.checked_at && Date.now() - new Date(order.checked_at).getTime() < 60_000) return order;
  await query('update print_orders set checked_at = now() where id = $1', [order.id]);
  let status, tracking = {}, message = null, cost = null;
  if (order.provider === 'lulu-sandbox') {
    try {
      const job = await lulu('GET', `/print-jobs/${order.provider_job_id}/`);
      status = job.status?.name;
      message = job.status?.message || null;
      const li = job.line_items?.[0] || {};
      tracking = { tracking_url: li.tracking_urls?.[0] || null, carrier: li.carrier_name || null };
      cost = job.costs?.total_cost_incl_tax ? Number(job.costs.total_cost_incl_tax) : null;
    } catch (err) {
      log.error({ message: err.message, orderId: order.id }, 'lulu status check failed');
      return order;
    }
  } else {
    // The simulated printer: in production after 2 minutes, shipped after 6.
    const age = Date.now() - new Date(order.submitted_at || order.created_at).getTime();
    status = age > 6 * 60_000 ? 'SHIPPED' : age > 2 * 60_000 ? 'IN_PRODUCTION' : 'PRODUCTION_DELAYED';
    if (status === 'SHIPPED') tracking = { tracking_url: null, carrier: 'USPS' };
  }
  const ours = ['SHIPPED'].includes(status) ? 'shipped'
    : ['IN_PRODUCTION', 'PRODUCTION_READY'].includes(status) ? 'in_production'
    : ['REJECTED', 'ERROR'].includes(status) ? 'failed'
    : status === 'CANCELED' ? 'canceled'
    : 'submitted';
  const fields = { provider_status: status, provider_message: message, ...tracking };
  if (cost != null) fields.print_cost_usd = cost;
  if (ours !== order.status) fields.status = ours;
  if (ours === 'shipped' && !order.shipped_at) fields.shipped_at = new Date();
  if (ours === 'failed' || ours === 'canceled') fields.customer_message = 'The printer could not print this book, so your payment has been refunded.';
  await setOrder(order.id, fields);
  const updated = await getOrder(order.id);
  if ((ours === 'failed' || ours === 'canceled') && order.status !== ours) await onFail?.(updated);
  return updated;
}
