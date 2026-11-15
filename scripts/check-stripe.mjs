// Asks Stripe to start a test checkout exactly as the site does, and prints what Stripe
// says. Creates an unpaid test session and nothing else.
//   node --env-file-if-exists=.env scripts/check-stripe.mjs [base url]
import Stripe from 'stripe';

const key = (process.env.STRIPE_SECRET_KEY || '').trim();
const base = process.argv[2] || 'https://beanstalk.eliweiss.me';
if (!key.startsWith('sk_test_')) { console.log('STRIPE_SECRET_KEY is missing or is not a test key'); process.exit(1); }
const stripe = new Stripe(key, { maxNetworkRetries: 1, timeout: 20_000 });
for (const extra of [{}]) {
  try {
    const s = await stripe.checkout.sessions.create({
      mode: 'payment', ...extra,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 297, product_data: { name: 'Picture book credit: 3 books', description: '$0.99 a book' } } }],
      success_url: `${base}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?view=account&funding=cancelled`,
      client_reference_id: '0',
      metadata: { app: 'beanstalk', check: '1' },
    });
    console.log(JSON.stringify(extra), '-> ok:', new URL(s.url).host, s.id.slice(0, 12));
  } catch (err) {
    console.log(JSON.stringify(extra), '-> FAILED:', err.type, err.code, err.statusCode, err.message);
  }
}
