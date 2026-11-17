// Checks what the family types before any of it is printed: the child's name and the
// About Me details.
//
// Three layers, cheapest first:
//   1. Rules in code: length, characters, no links, emails or phone numbers, and a word
//      list of insults, slurs and swear words (also caught when spelled with digits or
//      symbols, like "1d10t" or "s.t.u.p.i.d").
//   2. OpenAI's moderation endpoint (free): hate, harassment, sexual, violent content.
//   3. A small language model, for what lists can't judge: is this a real-sounding name
//      for a child (from any culture), or an insult, a joke or a thing; and is every
//      detail fit to print in a children's book.
// Layers 2 and 3 run only with an API key and outside mock mode. Results are cached.
import { createHash } from 'node:crypto';
import { getClient, isMock } from './image.js';
import { chatCost } from './cost.js';
import { log } from './log.js';

const CHECK_MODEL = process.env.TEXT_CHECK_MODEL || 'gpt-4.1-mini';

// Never printable anywhere: swear words, slurs and sexual words. Matched as whole words
// after normalising look-alike characters; STEMS also match inside longer words.
const ANYWHERE = new Set(`
bitch bastard asshole arsehole shit shithead bullshit piss pissed fuck fucker fucking
motherfucker dick dickhead cock prick pussy cunt slut whore skank wanker tosser bollocks
goddamn jackass dumbass smartass ass arse crap
nigger nigga coon spook chink gook wetback beaner spic kike yid heeb raghead towelhead
sandnigger gyppo pikey paki wog fag faggot dyke tranny shemale
nazi hitler rapist pedo pedophile paedo porn horny nude naked boobs tits penis vagina sexy
`.split(/\s+/).filter(Boolean));
const STEMS = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fagg', 'whore', 'slut', 'wank', 'twat', 'motherf', 'asshole', 'dickhead'];

// Insults and epithets someone might type as a child's "name". Fine elsewhere ("we have a
// pet pig"), never as the name.
const INSULTS = new Set(`
idiot stupid dumb dummy moron imbecile cretin loser fatso fatty fatass lardo pig piggy cow
ugly freak weirdo retard retarded spaz spastic mong cripple lame dork nerd geek twit
jerk creep scum trash garbage rubbish worthless useless pathetic brat snot booger poop poopy
poo poopoo stinky smelly butt butthead buttface poopface poophead dumbo dimwit nitwit halfwit
dope dunce numbskull bonehead blockhead knucklehead airhead pinhead meathead fathead
hoe tramp damn hell homo queer lesbo negro gypsy camel jihadi terrorist
satan devil demon killer murderer monster brat fool clown
`.split(/\s+/).filter(Boolean));

// Words that are fine on their own but not as a child's name.
const NOT_A_NAME = new Set(`
baby kid child boy girl son daughter brother sister mom mum dad mommy daddy
test testing asdf qwerty name firstname lastname none null undefined nobody anonymous unknown
hello hi yes no ok okay lol haha
`.split(/\s+/).filter(Boolean));

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };

function words(text) {
  const plain = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const leet = plain.replace(/[0134578@$!|+]/g, (c) => LEET[c] || c);
  const out = new Set();
  for (const variant of [plain, leet]) {
    for (const w of variant.split(/[^a-z]+/)) if (w) out.add(w);
    // "s.t.u.p.i.d", "s t u p i d": letters split by single symbols or spaces
    const joined = variant.replace(/(?<=\b[a-z])[\s.\-_*]+(?=[a-z]\b)/g, '');
    for (const w of joined.split(/[^a-z]+/)) if (w) out.add(w);
    out.add(variant.replace(/[^a-z]/g, ''));
  }
  return [...out];
}

const hasBlocked = (text, list = ANYWHERE) => words(text).some((w) => list.has(w) || ANYWHERE.has(w) || STEMS.some((st) => w.includes(st)));

const LABELS = { name: "The child's name", age: 'Age', favorites: 'Favorite things', about: 'More about me' };

// Rules every field must pass, and the ones only the name has.
function ruleCheck(about) {
  const errors = {};
  for (const [field, value] of Object.entries(about)) {
    if (!value) continue;
    if (/https?:|www\.|\.(com|net|org|io)\b/i.test(value)) errors[field] = `${LABELS[field]} can't contain a web address.`;
    else if (/\S+@\S+\.\S+/.test(value)) errors[field] = `${LABELS[field]} can't contain an email address.`;
    else if (/(\d[\s\-().]*){7,}/.test(value)) errors[field] = `${LABELS[field]} can't contain a phone number.`;
    else if (hasBlocked(value, field === 'name' ? INSULTS : ANYWHERE)) errors[field] = field === 'name'
      ? 'Please enter the child’s real first name. That word can’t be printed as a name.'
      : `${LABELS[field]} contains a word that can't be printed in a children's book.`;
  }
  const name = about.name || '';
  if (!errors.name && name) {
    const letters = name.replace(/[^\p{L}]/gu, '');
    if (!/^[\p{L}\p{M}][\p{L}\p{M}'’.\- ]*$/u.test(name)) errors.name = 'A name can only use letters, spaces, hyphens and apostrophes.';
    else if (letters.length < 2) errors.name = 'Please enter the child’s first name.';
    else if (name.split(/\s+/).length > 4) errors.name = 'Please enter just the child’s name, up to four words.';
    else if (/(\p{L})\1{2,}/iu.test(name)) errors.name = 'That doesn’t look like a real name. Please check the spelling.';
    else if (/^[^aeiouyàáâãäåèéêëìíîïòóôõöùúûüýÿ]{5,}$/i.test(letters) && /^[a-z]+$/i.test(letters)) errors.name = 'That doesn’t look like a real name. Please check the spelling.';
    else if (name.split(/\s+/).every((w) => NOT_A_NAME.has(w.toLowerCase()))) errors.name = 'Please enter the child’s real first name.';
  }
  if (about.age && !errors.age && !/\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|month|year|half/i.test(about.age)) {
    errors.age = 'Age should be a number, like 6 or "6 and a half".';
  }
  return errors;
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name_ok', 'name_reason', 'fields'],
  properties: {
    name_ok: { type: 'boolean', description: 'True if the name is a plausible real first name or nickname for a child, from any language or culture (including rare, invented-sounding or modern names). False for insults, epithets, slurs, body parts, swear words, mockery, objects, brands, celebrities used as a joke, or keyboard mashing.' },
    name_reason: { type: 'string', description: 'If name_ok is false: one short, kind sentence telling the parent what to fix. Otherwise empty.' },
    fields: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['field', 'ok', 'reason'],
        properties: {
          field: { type: 'string', enum: ['age', 'favorites', 'about'] },
          ok: { type: 'boolean', description: 'False if this text is inappropriate to print in a children\'s picture book: insults or put-downs (including about the child), mockery, sexual content, violence, hate, drugs, alcohol, profanity, personal data like addresses or school names, or anything a parent would be upset to see printed.' },
          reason: { type: 'string', description: 'If not ok: one short, kind sentence telling the parent what to change. Otherwise empty.' },
        },
      },
    },
  },
};

const cache = new Map();
const hashOf = (about) => createHash('sha1').update(JSON.stringify(about)).digest('hex');

async function modelCheck(about) {
  const key = hashOf(about);
  if (cache.has(key)) return cache.get(key);
  const errors = {};
  const client = getClient();
  const text = Object.entries(about).filter(([, v]) => v).map(([k, v]) => `${LABELS[k]}: ${v}`).join('\n');
  const [mod, chat] = await Promise.all([
    client.moderations.create({ model: 'omni-moderation-latest', input: text }),
    client.chat.completions.create({
      model: CHECK_MODEL,
      temperature: 0,
      max_tokens: 300,
      messages: [
        { role: 'system', content: 'You check what a parent typed for the "About Me" page of a personalised children\'s picture book before it is printed. Judge kindly but carefully: names from every culture are welcome; insults, jokes at the child\'s expense and anything unfit for a young child are not.' },
        { role: 'user', content: `Name: ${about.name}\nAge: ${about.age || '(empty)'}\nFavorite things: ${about.favorites || '(empty)'}\nMore about me: ${about.about || '(empty)'}\n\nReturn a verdict for the name, and for each of age, favorites and about that is not empty.` },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'about_check', strict: true, schema: SCHEMA } },
    }),
  ]);
  const flagged = mod.results?.[0]?.flagged;
  const verdict = JSON.parse(chat.choices[0].message.content);
  if (!verdict.name_ok) errors.name = verdict.name_reason || 'Please enter the child’s real first name.';
  for (const f of verdict.fields || []) if (!f.ok && about[f.field]) errors[f.field] = f.reason || `${LABELS[f.field]} can't be printed in a children's book.`;
  if (flagged && !Object.keys(errors).length) errors.about = 'Some of what you typed can’t be printed in a children’s book. Please change it.';
  const result = { errors, costUsd: chatCost(CHECK_MODEL, chat.usage) };
  if (cache.size > 2000) cache.clear();
  cache.set(key, result);
  return result;
}

// Returns { ok, errors: { field: message } }. Never throws: if the model check is down,
// the rule check alone decides, and the failure is logged.
export async function checkAbout(about) {
  const errors = ruleCheck(about);
  if (Object.keys(errors).length || isMock() || !process.env.OPENAI_API_KEY) return { ok: !Object.keys(errors).length, errors };
  try {
    const r = await modelCheck(about);
    return { ok: !Object.keys(r.errors).length, errors: r.errors, costUsd: r.costUsd };
  } catch (err) {
    log.error({ status: err?.status, message: err?.message }, 'about check failed; rules only');
    return { ok: true, errors: {} };
  }
}

export { ruleCheck as _ruleCheck };
