// What each API call costs us, in US dollars, worked out from the token usage the API
// reports. Prices are dollars per 1 million tokens, from OpenAI's pricing pages
// (checked 2026-11-15). Override or add models with PRICE_OVERRIDES, a JSON object
// shaped like the tables below.
const IMAGE_PRICES = [
  [/^gpt-image-2\.[56]-(flare|sunburst)/, { text: 5, image: 8, output: 30 }],
  [/^gpt-image-2/, { text: 5, image: 8, output: 30 }],
  [/^gpt-image-1\.5/, { text: 5, image: 8, output: 32 }],
  [/^gpt-image-1-mini/, { text: 2, image: 2.5, output: 8 }],
  [/^gpt-image-1/, { text: 5, image: 10, output: 40 }],
];
const CHAT_PRICES = [
  [/^gpt-4\.1-mini/, { input: 0.4, output: 1.6 }],
  [/^gpt-4\.1-nano/, { input: 0.1, output: 0.4 }],
  [/^gpt-4o-mini/, { input: 0.15, output: 0.6 }],
  [/^gpt-4\.1/, { input: 2, output: 8 }],
];
const FALLBACK_IMAGE = { text: 5, image: 8, output: 30 };
const FALLBACK_CHAT = { input: 0.4, output: 1.6 };

let overrides = {};
try { overrides = JSON.parse(process.env.PRICE_OVERRIDES || '{}'); } catch { /* ignore a bad value */ }

const find = (table, model, fallback) => overrides[model] || table.find(([re]) => re.test(model))?.[1] || fallback;
const round = (usd) => Math.round(usd * 1e6) / 1e6;

// usage: the `usage` object of an images.generate / images.edit response.
export function imageCost(model, usage) {
  if (!usage) return 0;
  const p = find(IMAGE_PRICES, model, FALLBACK_IMAGE);
  const d = usage.input_tokens_details || {};
  const imageIn = d.image_tokens ?? 0;
  const textIn = d.text_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - imageIn);
  return round((textIn * p.text + imageIn * p.image + (usage.output_tokens ?? 0) * p.output) / 1e6);
}

// usage: the `usage` object of a chat.completions response.
export function chatCost(model, usage) {
  if (!usage) return 0;
  const p = find(CHAT_PRICES, model, FALLBACK_CHAT);
  return round(((usage.prompt_tokens ?? 0) * p.input + (usage.completion_tokens ?? 0) * p.output) / 1e6);
}

export const tokensOf = (usage) => ({
  in: usage?.input_tokens ?? usage?.prompt_tokens ?? 0,
  out: usage?.output_tokens ?? usage?.completion_tokens ?? 0,
});
