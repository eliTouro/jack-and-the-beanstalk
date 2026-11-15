// Where the story text goes on a page. This is decided by code for every finished
// picture, never left to the image model:
//
//   1. The picture check (src/analyze.js) gives a box for every face and every
//      story-critical object, and says which bands look clear.
//   2. For the top, bottom and middle bands, the text block is measured against those
//      boxes. A band is usable only if it touches no face, covers no important object,
//      AND the checker also called it clear.
//   3. The template's own zone is used if it is usable; otherwise the calmest usable
//      band (least pixel detail, measured from the picture itself).
//   4. If no band is usable, the text does not go on the picture at all: the page is
//      laid out with the art in a frame and the text on plain paper below it.
//
// The pixels of the chosen band also decide the text colour (white on a dark plate, or
// dark on a pale plate), so it is readable on any picture.
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { PAGE } from './template.js';

export const ZONES = ['top', 'bottom', 'middle'];
const EDGE = 0.03;       // gap between the text plate and the page edge
const FACE_PAD = 0.012;  // extra room kept around every face

// The story type: one face, one size, measured with the same engine that prints it.
export const TEXT = {
  font: fileURLToPath(new URL('../assets/fonts/Andika-Bold.ttf', import.meta.url)),
  size: 16,
  lineGap: 3,
  pad: 12, // space between the plate edge and the text, in points
};
export const textWidth = () => PAGE.width * (1 - EDGE * 2) - TEXT.pad * 2;

let ruler;
// Height of the printed text block in points, measured, not guessed.
export function measureText(text) {
  ruler ??= new PDFDocument({ size: [PAGE.width, PAGE.height], autoFirstPage: false }).font(TEXT.font);
  return ruler.fontSize(TEXT.size).heightOfString(text || ' ', { width: textWidth(), align: 'center', lineGap: TEXT.lineGap });
}

// Height of the text plate as a fraction of the page.
export function textFraction(text) {
  return Math.min(0.34, (measureText(text) + TEXT.pad * 2) / PAGE.height);
}

export function bandRect(zone, frac) {
  const y0 = zone === 'top' ? EDGE : zone === 'bottom' ? 1 - EDGE - frac : 0.5 - frac / 2;
  return { x0: EDGE, y0, x1: 1 - EDGE, y1: y0 + frac };
}

const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const overlap = (a, b) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const pad = (b, p) => ({ x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p });

// True if a text plate in this band would cover nothing that matters.
export function zoneIsClear(zone, frac, analysis) {
  if (analysis?.clear && analysis.clear[zone] === false) return false;
  const band = bandRect(zone, frac);
  for (const f of analysis?.faces || []) if (overlap(band, pad(f, FACE_PAD)) > 0) return false;
  for (const o of analysis?.objects || []) {
    const a = area(o);
    if (a > 0 && overlap(band, o) / a > 0.2) return false;
  }
  return true;
}

// Brightness (0-1) and busyness (standard deviation, 0-1) of each band of the picture.
export async function bandStats(buffer, frac) {
  const out = {};
  try {
    const img = sharp(buffer).greyscale();
    const { width, height } = await img.metadata();
    for (const zone of ZONES) {
      const r = bandRect(zone, frac);
      const region = {
        left: Math.floor(r.x0 * width), top: Math.floor(r.y0 * height),
        width: Math.max(1, Math.floor((r.x1 - r.x0) * width)), height: Math.max(1, Math.floor((r.y1 - r.y0) * height)),
      };
      const s = (await img.clone().extract(region).stats()).channels[0];
      out[zone] = { brightness: s.mean / 255, busy: s.stdev / 255 };
    }
  } catch {
    for (const zone of ZONES) out[zone] ??= { brightness: 0.3, busy: 0.5 };
  }
  return out;
}

// Returns { zone: 'top' | 'bottom' | 'middle' | 'below', tone: 'light' | 'dark', moved, reason }.
//   tone 'light' = white text on a dark plate; 'dark' = dark text on a pale plate.
//   zone 'below' = the framed layout: text on paper under the art.
export function chooseLayout({ analysis, preferred, frac, stats }) {
  const usable = ZONES.filter((z) => zoneIsClear(z, frac, analysis));
  let zone;
  if (usable.includes(preferred)) zone = preferred;
  else if (usable.length) zone = [...usable].sort((a, b) => (stats?.[a]?.busy ?? 1) - (stats?.[b]?.busy ?? 1))[0];
  else zone = 'below';
  const tone = zone === 'below' ? 'dark' : (stats?.[zone]?.brightness ?? 0.3) > 0.58 ? 'dark' : 'light';
  const reason =
    zone === preferred ? `The ${zone} of the picture is clear, as the template planned.`
    : zone === 'below' ? 'No part of the picture was clear of faces and story details, so the text sits on paper under the art.'
    : `The ${preferred} was not clear on this picture, so the text moved to the ${zone}.`;
  return { zone, tone, moved: zone !== preferred, reason };
}

// The whole decision for one finished picture.
export async function layoutFor({ buffer, analysis, preferred, text }) {
  const frac = textFraction(text);
  const stats = await bandStats(buffer, frac);
  return chooseLayout({ analysis, preferred, frac, stats });
}
