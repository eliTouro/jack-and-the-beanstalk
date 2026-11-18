// Checks the Lulu SANDBOX keys in .env without printing them:
//   node --env-file-if-exists=.env scripts/check-lulu.mjs
// Signs in, then asks for the cover size of the book's print product.
const key = (process.env.LULU_CLIENT_KEY || '').trim();
const secret = (process.env.LULU_CLIENT_SECRET || '').trim();
const API = 'https://api.sandbox.lulu.com';
if (!key || !secret) { console.log('LULU_CLIENT_KEY and LULU_CLIENT_SECRET are not both set in .env'); process.exit(1); }
console.log(`key: ${key.length} characters, starts ${key.slice(0, 4)}…   secret: ${secret.length} characters`);
if (/[\s"']/.test(key + secret)) console.log('warning: a key contains spaces or quotes; paste the bare values');

const res = await fetch(`${API}/auth/realms/glasstree/protocol/openid-connect/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` },
  body: 'grant_type=client_credentials',
});
if (!res.ok) {
  console.log(`sandbox sign-in FAILED (${res.status}): ${(await res.text()).slice(0, 200)}`);
  console.log('Use the Client Key and Client Secret from https://developers.sandbox.lulu.com/user-profile/api-keys (the sandbox site, not developers.lulu.com), not the "Base64 encoded" string.');
  process.exit(1);
}
const { access_token: token } = await res.json();
console.log('sandbox sign-in OK');
const dims = await fetch(`${API}/cover-dimensions/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ pod_package_id: process.env.LULU_POD_PACKAGE_ID || '0600X0900FCPRECW080CW444GXX', interior_page_count: 24, unit: 'pt' }),
});
console.log(`cover dimensions: ${dims.status} ${(await dims.text()).slice(0, 200)}`);
