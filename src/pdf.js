// The PDF layer: everything with words on it is set by us, never drawn by the image model.
//
// The book, as a reader holds it:
//   front cover   the cover art, the title, "starring" the child's name, the publisher
//   copyright     the copyright notice and the publisher (the first inside page)
//   pages 1-20    the story: art with the text where src/layout.js found the picture clear
//   The End
//   back cover    About Me: the child's portrait and the details the family typed
//
// Three outputs share the same drawing code:
//   buildBookPdf        the downloadable book, one 6 x 9 in page per side, covers included
//   buildPrintInterior  the printer's interior file: 6.25 x 9.25 in pages (0.125 in bleed)
//   buildPrintCover     the printer's cover file: back cover, spine and front cover as
//                       one wrap, sized from the printer's cover dimensions
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { PAGE, PRINT } from './template.js';
import { textFraction, bandRect, TEXT } from './layout.js';

const font = (file) => fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url));
const FONTS = {
  body: font('Andika-Regular.ttf'),
  bold: font('Andika-Bold.ttf'),
  display: font('Chewy-Regular.ttf'),
};

export const PUBLISHER = process.env.PUBLISHER_NAME || 'Beanstalk Books';
export const PUBLISHER_SITE = process.env.PUBLISHER_SITE || 'beanstalk.eliweiss.me';

const W = PAGE.width;   // 432 pt = 6 in
const H = PAGE.height;  // 648 pt = 9 in
const BLEED = 9;        // 0.125 in
const SAFE = 36;        // 0.5 in: nothing important closer than this to a trimmed edge
const INK = '#2b2118';
const CREAM = '#f7efdc';
const GREEN = '#2f5d34';
const GOLD = '#e8b33c';
const PAD = TEXT.pad;

const newDoc = (size, info) => new PDFDocument({ size, margin: 0, autoFirstPage: false, info });
const collect = (doc) => new Promise((resolve, reject) => {
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
});

// ---- story pages ---------------------------------------------------------------------

// The story type size, stepping down only if a very long text would not fit its box.
function fitText(doc, text, width, maxHeight) {
  for (let size = TEXT.size; size >= 12; size -= 0.5) {
    doc.font(FONTS.bold).fontSize(size);
    const height = doc.heightOfString(text, { width, align: 'center', lineGap: TEXT.lineGap });
    if (height <= maxHeight + 0.5 || size === 12) return { size, height };
  }
  return { size: 12, height: maxHeight };
}

// Text on the art: a rounded plate exactly where the layout step found the picture clear.
// (ox, oy) is the top-left corner of the trimmed page.
function platedText(doc, { text, zone, tone, number }, ox, oy) {
  const band = bandRect(zone, textFraction(text));
  const x = ox + band.x0 * W, w = (band.x1 - band.x0) * W;
  const maxH = (band.y1 - band.y0) * H;
  const { size, height } = fitText(doc, text, w - PAD * 2, maxH - PAD * 2);
  const plateH = Math.min(maxH, height + PAD * 2);
  const y = oy + (zone === 'top' ? band.y0 * H : zone === 'bottom' ? band.y1 * H - plateH : ((band.y0 + band.y1) * H - plateH) / 2);
  const light = tone !== 'dark';
  doc.save();
  doc.roundedRect(x, y, w, plateH, 14).fillOpacity(light ? 0.66 : 0.88).fill(light ? '#1a130b' : '#fffaf0');
  doc.restore();
  doc.fillOpacity(1).font(FONTS.bold).fontSize(size).fillColor(light ? '#ffffff' : INK)
    .text(text, x + PAD, y + (plateH - height) / 2, { width: w - PAD * 2, align: 'center', lineGap: TEXT.lineGap });
  doc.font(FONTS.body).fontSize(8).fillColor(light ? '#ffffff' : INK, 0.7)
    .text(String(number), x + w - 30, y + plateH - 13, { width: 22, align: 'right', lineBreak: false });
  doc.fillOpacity(1);
}

// No clear place on the art: frame the art and print the text on paper below it.
function framedPage(doc, { text, image, number }, ox, oy, bleed) {
  doc.rect(ox - bleed, oy - bleed, W + bleed * 2, H + bleed * 2).fill(CREAM);
  const textBox = Math.max(130, textFraction(text) * H + 30);
  const artH = H - textBox - 34;
  const artW = (artH * 2) / 3;
  const ax = ox + (W - artW) / 2, ay = oy + SAFE - 8;
  doc.save();
  doc.roundedRect(ax, ay, artW, artH, 10).clip();
  doc.image(image, ax, ay, { width: artW, height: artH });
  doc.restore();
  doc.roundedRect(ax, ay, artW, artH, 10).lineWidth(1.2).strokeColor('#c9a85c').stroke();
  const width = W - SAFE * 2;
  const { size, height } = fitText(doc, text, width, textBox - 40);
  doc.font(FONTS.bold).fontSize(size).fillColor(INK)
    .text(text, ox + SAFE, ay + artH + (oy + H - SAFE - ay - artH - height) / 2, { width, align: 'center', lineGap: TEXT.lineGap });
  doc.font(FONTS.body).fontSize(8).fillColor(INK, 0.6).text(String(number), ox, oy + H - SAFE + 10, { width: W, align: 'center', lineBreak: false });
  doc.fillOpacity(1);
}

// One story page inside a box that may carry bleed on every side.
function storyPage(doc, page, ox, oy, bleed) {
  if (page.zone === 'below') return framedPage(doc, page, ox, oy, bleed);
  const bw = W + bleed * 2, bh = H + bleed * 2;
  doc.image(page.image, ox - bleed, oy - bleed, { cover: [bw, bh], align: 'center', valign: 'center' });
  platedText(doc, page, ox, oy);
}

// ---- front cover ----------------------------------------------------------------------

// Text with a soft dark shadow, so it reads on any picture.
function shadowText(doc, text, x, y, opts, { color = '#ffffff', shadow = 0.55, offset = 2.2 } = {}) {
  doc.fillColor('#1a130b', shadow).text(text, x + offset * 0.6, y + offset, opts);
  doc.fillColor(color, 1).text(text, x, y, opts);
}

// The largest title that fits the space the picture leaves clear.
function fitTitle(doc, title, width, maxHeight) {
  for (let size = 46; size >= 24; size -= 1) {
    doc.font(FONTS.display).fontSize(size);
    const h = doc.heightOfString(title, { width, align: 'center', lineGap: -4 });
    if (h + size * 0.62 + 10 <= maxHeight || size === 24) return { size, h };
  }
  return { size: 24, h: maxHeight };
}

// The front cover in the trimmed box at (ox, oy); art fills the box plus `bleed`, except on
// the spine side of a printed cover (`spineBleed`), where the wrap handles it.
function frontCover(doc, { art, faces = [], title, name }, ox, oy, { bleedLeft = 0, bleed = 0 } = {}) {
  doc.save();
  doc.rect(ox - bleedLeft, oy - bleed, W + bleedLeft + bleed, H + bleed * 2).clip();
  doc.image(art, ox - bleedLeft, oy - bleed, { cover: [W + bleedLeft + bleed, H + bleed * 2], align: 'center', valign: 'center' });
  // A soft shade at the top, where the title sits, so white letters read on a bright sky.
  const shade = doc.linearGradient(0, oy - bleed, 0, oy + H * 0.42).stop(0, '#0d1a2b', 0.45).stop(1, '#0d1a2b', 0);
  doc.rect(ox - bleedLeft, oy - bleed, W + bleedLeft + bleed, H * 0.42 + bleed).fill(shade);
  const low = doc.linearGradient(0, oy + H * 0.82, 0, oy + H + bleed).stop(0, '#0d1a2b', 0).stop(1, '#0d1a2b', 0.45);
  doc.rect(ox - bleedLeft, oy + H * 0.82, W + bleedLeft + bleed, H * 0.18 + bleed).fill(low);
  doc.restore();

  // Title room: from the top safety margin down to the highest face on the cover.
  const topFace = Math.min(0.42, ...faces.map((f) => f.y0)) * H;
  const width = W - SAFE * 2;
  const room = Math.max(110, topFace - SAFE - 10);
  const { size, h } = fitTitle(doc, title, width, room);
  doc.font(FONTS.display).fontSize(size);
  shadowText(doc, title, ox + SAFE, oy + SAFE, { width, align: 'center', lineGap: -4 });
  const sub = `starring ${name}`;
  doc.font(FONTS.bold).fontSize(Math.round(size * 0.5));
  shadowText(doc, sub, ox + SAFE, oy + SAFE + h + 4, { width, align: 'center' }, { color: '#ffd76a', offset: 1.6 });
  doc.font(FONTS.bold).fontSize(10);
  shadowText(doc, PUBLISHER, ox + SAFE, oy + H - SAFE - 4, { width, align: 'center', characterSpacing: 1.2 }, { offset: 1 });
}

// ---- inside pages ---------------------------------------------------------------------

function copyrightPage(doc, { story, about, bookId, year, printed }, ox, oy, bleed) {
  doc.rect(ox - bleed, oy - bleed, W + bleed * 2, H + bleed * 2).fill('#fffdf7');
  const x = ox + SAFE + 18, width = W - (SAFE + 18) * 2;
  let y = oy + H * 0.5;
  const line = (text, { f = FONTS.body, s = 9.5, c = '#4a4033', gap = 7 } = {}) => {
    doc.font(f).fontSize(s).fillColor(c).text(text, x, y, { width, align: 'center', lineGap: 2 });
    y = doc.y + gap;
  };
  line(`${story.title}, starring ${about.name}`, { f: FONTS.bold, s: 11, c: INK, gap: 14 });
  line(`Text and illustrations copyright © ${year} ${PUBLISHER}. All rights reserved.`);
  line('No part of this book may be reproduced, stored or transmitted in any form or by any means without written permission from the publisher.', { gap: 12 });
  line('Based on the traditional folk tale, retold for this edition.');
  line(`Illustrated especially for ${about.name}.`, { gap: 12 });
  line(`Published by ${PUBLISHER}`, { f: FONTS.bold, c: INK, gap: 2 });
  line(PUBLISHER_SITE, { gap: 12 });
  line(`First edition, ${year}${printed ? '. Printed on demand in the United States of America' : ''}.`, { gap: 2 });
  line(`Book number ${String(bookId).slice(0, 8).toUpperCase()}`, { s: 8.5, c: '#7a6a52' });
}

function theEndPage(doc, ox, oy, bleed) {
  doc.rect(ox - bleed, oy - bleed, W + bleed * 2, H + bleed * 2).fill(CREAM);
  doc.font(FONTS.display).fontSize(52).fillColor(GREEN).text('The End', ox, oy + H * 0.4, { width: W, align: 'center' });
  // a small bean sprig
  const cx = ox + W / 2, cy = oy + H * 0.4 + 86;
  doc.save().lineWidth(2).strokeColor(GREEN).moveTo(cx - 40, cy).bezierCurveTo(cx - 10, cy - 10, cx + 10, cy + 10, cx + 40, cy).stroke().restore();
  doc.save().fillColor(GOLD).ellipse(cx, cy, 7, 5).fill().restore();
}

function blankPage(doc, ox, oy, bleed) {
  doc.rect(ox - bleed, oy - bleed, W + bleed * 2, H + bleed * 2).fill('#fffdf7');
}

// ---- back cover: About Me --------------------------------------------------------------

function backCover(doc, { about, reference, story }, ox, oy, { bleed = 0, bleedRight = bleed } = {}) {
  doc.rect(ox - bleed, oy - bleed, W + bleed + bleedRight, H + bleed * 2).fill(CREAM);
  doc.rect(ox + 16, oy + 16, W - 32, H - 32).lineWidth(1.5).strokeColor('#c9a85c').stroke();

  doc.font(FONTS.display).fontSize(36).fillColor(GREEN).text('About Me', ox, oy + SAFE + 8, { width: W, align: 'center' });

  const d = 150;
  const cx = ox + W / 2;
  const cy = oy + SAFE + 70 + d / 2;
  doc.save();
  doc.circle(cx, cy, d / 2).clip();
  doc.image(reference, cx - d / 2, cy - d / 2, { width: d, height: d });
  doc.restore();
  doc.circle(cx, cy, d / 2).lineWidth(4).strokeColor(GOLD).stroke();

  const x = ox + SAFE + 8, width = W - (SAFE + 8) * 2;
  let y = cy + d / 2 + 16;
  doc.font(FONTS.display).fontSize(28).fillColor(INK).text(about.name, x, y, { width, align: 'center' });
  y = doc.y + 10;

  const rows = [['Age', about.age], ['Favorite things', about.favorites], ['More about me', about.about]].filter(([, v]) => v);
  const bottom = oy + H - SAFE - 46;
  for (const [label, value] of rows) {
    if (y > bottom - 30) break;
    doc.font(FONTS.bold).fontSize(11).fillColor(GREEN).text(label, x, y, { width });
    doc.font(FONTS.body).fontSize(12.5).fillColor(INK).text(value, x, doc.y + 1, { width, lineGap: 2, height: bottom - doc.y, ellipsis: true });
    y = doc.y + 9;
  }

  doc.font(FONTS.bold).fontSize(9.5).fillColor('#5b4f38').text(`${story.title}, starring ${about.name}`, ox, oy + H - SAFE - 26, { width: W, align: 'center' });
  doc.font(FONTS.body).fontSize(8.5).fillColor('#7a6a52').text(`${PUBLISHER} · ${PUBLISHER_SITE}`, ox, oy + H - SAFE - 12, { width: W, align: 'center' });
}

// ---- the three files ---------------------------------------------------------------------

const yearOf = (d) => new Date(d || Date.now()).getFullYear();

// book: { story, about, reference, cover: { art, faces }, pages: [{ number, text, zone, tone, image }], bookId, createdAt }
export async function buildBookPdf(book) {
  const { story, about } = book;
  const doc = newDoc([W, H], { Title: `${story.title}, starring ${about.name}`, Author: PUBLISHER, Creator: PUBLISHER_SITE });
  const done = collect(doc);
  const page = () => doc.addPage({ size: [W, H], margin: 0 });
  page(); frontCover(doc, { art: book.cover.art, faces: book.cover.faces, title: story.title, name: about.name }, 0, 0);
  page(); copyrightPage(doc, { story, about, bookId: book.bookId, year: yearOf(book.createdAt) }, 0, 0, 0);
  for (const p of book.pages) { page(); storyPage(doc, p, 0, 0, 0); }
  page(); theEndPage(doc, 0, 0, 0);
  page(); backCover(doc, { about, reference: book.reference, story }, 0, 0);
  doc.end();
  return done;
}

// The interior file for the printer: every page carries 0.125 in bleed on all sides.
export async function buildPrintInterior(book) {
  const { story, about } = book;
  const size = [W + BLEED * 2, H + BLEED * 2];
  const doc = newDoc(size, { Title: `${story.title}, starring ${about.name} (interior)`, Author: PUBLISHER });
  const done = collect(doc);
  const page = () => doc.addPage({ size, margin: 0 });
  let count = 0;
  page(); copyrightPage(doc, { story, about, bookId: book.bookId, year: yearOf(book.createdAt), printed: true }, BLEED, BLEED, BLEED); count++;
  for (const p of book.pages) { page(); storyPage(doc, p, BLEED, BLEED, BLEED); count++; }
  page(); theEndPage(doc, BLEED, BLEED, BLEED); count++;
  while (count < PRINT.interiorPages) { page(); blankPage(doc, BLEED, BLEED, BLEED); count++; }
  doc.end();
  return done;
}

// The cover file: one wide page holding the back cover, the spine and the front cover.
// dims: { width, height } in points, from the printer's cover-dimensions answer. The wrap
// (the part that folds round the hard boards) is the same on all four edges.
export async function buildPrintCover(book, dims) {
  const { story, about } = book;
  const width = Number(dims.width), height = Number(dims.height);
  const wrap = (height - H) / 2;
  const spine = width - wrap * 2 - W * 2;
  if (!(wrap > 0 && spine >= 0)) throw new Error(`Unexpected cover size ${width} x ${height}`);
  const doc = newDoc([width, height], { Title: `${story.title}, starring ${about.name} (cover)`, Author: PUBLISHER });
  const done = collect(doc);
  doc.addPage({ size: [width, height], margin: 0 });
  const backX = wrap, frontX = wrap + W + spine;
  backCover(doc, { about, reference: book.reference, story }, backX, wrap, { bleed: wrap, bleedRight: spine / 2 });
  frontCover(doc, { art: book.cover.art, faces: book.cover.faces, title: story.title, name: about.name }, frontX, wrap, { bleedLeft: spine / 2, bleed: wrap });
  // The spine: a solid band in the book's green. Too thin for lettering at this page count.
  doc.rect(backX + W, 0, spine, height).fill('#244a2a');
  doc.end();
  return done;
}

// Without the printer's answer: the case-wrap size for this page count (Lulu, 6 x 9 in, 24 pages).
export const FALLBACK_COVER_DIMS = { width: 1008, height: 774 };
