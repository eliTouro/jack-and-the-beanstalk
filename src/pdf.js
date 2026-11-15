// The PDF layer: page art with the story text printed by us (never drawn by the image
// model), then an About Me back page. Uses pdfkit with embedded fonts.
//
// Where the text goes on each page was decided by src/layout.js from the finished
// picture: 'top' | 'middle' | 'bottom' put a text plate on the art where it is clear;
// 'below' frames the art and prints the text on paper underneath.
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { PAGE } from './template.js';
import { textFraction, bandRect, TEXT } from './layout.js';

const font = (file) => fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url));
const FONTS = {
  body: font('Andika-Regular.ttf'),
  bold: font('Andika-Bold.ttf'),
  display: font('Chewy-Regular.ttf'),
};

// 6 x 9 in portrait, the same 2:3 shape as the 1024x1536 page art.
const W = PAGE.width;
const H = PAGE.height;
const MARGIN = 34;
const INK = '#2b2118';
const CREAM = '#f7efdc';
const PAD = TEXT.pad; // space between the plate edge and the text

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
function platedText(doc, { text, zone, tone, number }) {
  const band = bandRect(zone, textFraction(text));
  const x = band.x0 * W, w = (band.x1 - band.x0) * W;
  const maxH = (band.y1 - band.y0) * H;
  const { size, height } = fitText(doc, text, w - PAD * 2, maxH - PAD * 2);
  const plateH = Math.min(maxH, height + PAD * 2);
  // Hug the page edge for top/bottom; centre for middle.
  const y = zone === 'top' ? band.y0 * H : zone === 'bottom' ? band.y1 * H - plateH : (band.y0 * H + band.y1 * H - plateH) / 2;
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
function framedPage(doc, { text, image, number }) {
  doc.rect(0, 0, W, H).fill(CREAM);
  const textBox = Math.max(130, textFraction(text) * H + 30);
  const artH = H - textBox - 30;
  const artW = (artH * 2) / 3;
  const ax = (W - artW) / 2, ay = 22;
  doc.save();
  doc.roundedRect(ax, ay, artW, artH, 10).clip();
  doc.image(image, ax, ay, { width: artW, height: artH });
  doc.restore();
  doc.roundedRect(ax, ay, artW, artH, 10).lineWidth(1.2).strokeColor('#c9a85c').stroke();
  const width = W - MARGIN * 2;
  const { size, height } = fitText(doc, text, width, textBox - 26);
  doc.font(FONTS.bold).fontSize(size).fillColor(INK)
    .text(text, MARGIN, ay + artH + (H - ay - artH - height) / 2 - 4, { width, align: 'center', lineGap: 3 });
  doc.font(FONTS.body).fontSize(8).fillColor(INK, 0.6).text(String(number), 0, H - 16, { width: W, align: 'center', lineBreak: false });
  doc.fillOpacity(1);
}

function aboutPage(doc, about, reference, story) {
  doc.addPage({ size: [W, H], margin: 0 });
  doc.rect(0, 0, W, H).fill(CREAM);
  doc.rect(14, 14, W - 28, H - 28).lineWidth(1.5).strokeColor('#c9a85c').stroke();

  doc.font(FONTS.display).fontSize(38).fillColor('#2f5d34').text('About Me', 0, 44, { width: W, align: 'center' });

  // Round portrait from the same reference image used for every page.
  const d = 168;
  const cx = W / 2;
  const cy = 120 + d / 2;
  doc.save();
  doc.circle(cx, cy, d / 2).clip();
  doc.image(reference, cx - d / 2, cy - d / 2, { width: d, height: d });
  doc.restore();
  doc.circle(cx, cy, d / 2).lineWidth(4).strokeColor('#e8b33c').stroke();

  let y = cy + d / 2 + 22;
  doc.font(FONTS.display).fontSize(30).fillColor(INK).text(about.name, MARGIN, y, { width: W - MARGIN * 2, align: 'center' });
  y = doc.y + 14;

  const rows = [
    ['Age', about.age],
    ['Favorite things', about.favorites],
    ['More about me', about.about],
  ].filter(([, v]) => v);

  for (const [label, value] of rows) {
    doc.font(FONTS.bold).fontSize(12).fillColor('#2f5d34').text(label, MARGIN + 10, y, { width: W - MARGIN * 2 - 20 });
    doc.font(FONTS.body).fontSize(14).fillColor(INK).text(value, MARGIN + 10, doc.y + 2, { width: W - MARGIN * 2 - 20, lineGap: 3 });
    y = doc.y + 12;
  }

  doc.font(FONTS.body).fontSize(10).fillColor('#7a6a52').text(`${story.title}, starring ${about.name}`, 0, H - 40, { width: W, align: 'center' });
}

// pages: [{ number, text, zone, tone, image: Buffer }]   reference: Buffer
export function buildBookPdf({ story, pages, about, reference }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [W, H],
      margin: 0,
      autoFirstPage: false,
      info: { Title: `${story.title}, starring ${about.name}`, Author: 'beanstalk.eliweiss.me' },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    for (const page of pages) {
      doc.addPage({ size: [W, H], margin: 0 });
      if (page.zone === 'below') framedPage(doc, page);
      else {
        doc.image(page.image, 0, 0, { cover: [W, H], align: 'center', valign: 'center' }); // full bleed
        platedText(doc, page);
      }
    }
    aboutPage(doc, about, reference, story);
    doc.end();
  });
}
