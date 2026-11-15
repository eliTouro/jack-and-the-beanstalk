// Lists the image and vision models this OPENAI_API_KEY can use (no cost).
//   node --env-file-if-exists=.env scripts/probe-models.mjs
const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
const j = await r.json();
if (!j.data) {
  console.log(JSON.stringify(j).slice(0, 300));
} else {
  const ids = j.data.map((m) => m.id).filter((id) => /image|gpt-4\.1|gpt-4o-mini$|gpt-5|gpt-6|nano|mini/.test(id) && !/audio|realtime|tts|transcribe|search|codex/.test(id));
  console.log(ids.sort().join('\n'));
}
console.log('IMAGE_MODEL', process.env.IMAGE_MODEL, '| IMAGE_QUALITY', process.env.IMAGE_QUALITY, '| PUBLIC_URL', process.env.PUBLIC_URL, '| NODE_ENV', process.env.NODE_ENV);
