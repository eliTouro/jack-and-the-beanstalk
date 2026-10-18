// Offline tests: no API key, no network calls to the image model.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cartoonPrompt, scenePrompt, normalizeSettings, SCENES, DEFAULT_SETTINGS } from '../src/prompts.js';

delete process.env.GEMINI_API_KEY;
const { default: app } = await import('../server.js');

let server, base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('unknown settings fall back to defaults', () => {
  assert.deepEqual(normalizeSettings({ style: '<script>', palette: 'nope' }), DEFAULT_SETTINGS);
  assert.equal(normalizeSettings({ style: 'comic' }).style, 'comic');
});

test('each scene prompt contains its caption word for word', () => {
  for (const id of Object.keys(SCENES)) {
    assert.ok(scenePrompt(id, {}).includes(SCENES[id].spec), id);
  }
});

test('prompts carry the identity instructions and chosen style', () => {
  const p = cartoonPrompt({ style: 'clay' });
  assert.match(p, /recognizably the same individual/);
  assert.match(p, /claymation/);
});

test('GET /api/options lists both scenes', async () => {
  const body = await (await fetch(base + '/api/options')).json();
  assert.deepEqual(body.scenes.map((s) => s.id), ['plant', 'climb']);
  assert.ok(body.styles.length >= 3);
});

test('rejects a missing photo with 400', async () => {
  const res = await post('/api/cartoon', {});
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /photo/);
});

test('rejects a non-image data URL', async () => {
  const res = await post('/api/cartoon', { photo: 'data:text/html;base64,PGgxPg==' });
  assert.equal(res.status, 400);
});

test('rejects an unknown scene', async () => {
  const res = await post('/api/scene', { sceneId: 'giant', photo: tinyPng, cartoon: tinyPng });
  assert.equal(res.status, 400);
});

test('without a key the server says so instead of crashing', async () => {
  const res = await post('/api/cartoon', { photo: tinyPng });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /GEMINI_API_KEY/);
});

test('healthz reports the key is missing, never its value', async () => {
  const body = await (await fetch(base + '/healthz')).json();
  assert.equal(body.keyConfigured, false);
});
