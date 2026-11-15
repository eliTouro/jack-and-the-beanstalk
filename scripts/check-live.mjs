// Waits for the live site to serve the current build, then prints what it reports.
//   node scripts/check-live.mjs [base url]
const base = process.argv[2] || 'https://beanstalk.eliweiss.me';
const get = async (path) => { const r = await fetch(base + path, { signal: AbortSignal.timeout(60_000) }); return { status: r.status, body: await r.text() }; };
for (let i = 0; i < 40; i++) {
  try {
    const h = await get('/healthz');
    const health = JSON.parse(h.body);
    if ('payments' in health) {
      const s = JSON.parse((await get('/api/stories')).body);
      console.log('healthz', JSON.stringify(health));
      console.log('stories', s.stories.map((x) => `${x.id}: ${x.scenesReady} scenes, ${x.characters.length} bible pictures`).join(' | '));
      const css = await get('/css/app.css');
      console.log('app.css', css.status, `${css.body.length} bytes`);
      process.exit(0);
    }
    console.log(`${i * 15}s: old build still serving`);
  } catch (e) { console.log(`${i * 15}s: ${e.message}`); }
  await new Promise((r) => setTimeout(r, 15_000));
}
console.log('gave up waiting');
process.exit(1);
