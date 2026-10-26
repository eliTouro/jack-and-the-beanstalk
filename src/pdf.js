// The PDF layer: full-bleed page art with the story text printed on top (never
// drawn by the image model), then an About Me page. Uses pdfkit with embedded fonts.
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

const font = (file) => fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url));
const FONTS = {
  body: font('Andika-Regular.ttf'),
  bold: font('Andika-Bold.ttf'),
  display: font('Chewy-Regular.ttf'),
};

// 6 x 9 in portrait, the same 2:3 shape as the 1024x1536 page art.
const W = 432;
const H = 648;
const MARGIN = 34;
const INK = '#2b2118';
const CREAM = '#f7efdc';

const bufferOf = (img) => Buffer.from(img.data, 'base64');

// Prints the story text in its zone, over a soft gradient scrim so it stays
// readable whatever the art behind it looks like.
function storyText(doc, { text, zone, tone }) {
  const size = 21;
  doc.font(FONTS.bold).fontSize(size);
  const width = W - MARGIN * 2;
  const textHeight = doc.heightOfString(text, { width, align: 'center', lineGap: 4 });
  const band = Math.max(H / 3, textHeight + 110);

  const top = zone === 'top';
  const y0 = top ? 0 : H - band;
  const scrimColor = tone === 'light' ? '#000000' : '#fffaf0';
  const strong = tone === 'light' ? 0.62 : 0.78;
  // Fade from clear (towards the middle of the page) to strong (at the page edge).
  const grad = top
    ? doc.linearGradient(0, band, 0, 0).stop(0, scrimColor, 0).stop(1, scrimColor, strong)
    : doc.linearGradient(0, y0, 0, H).stop(0, scrimColor, 0).stop(1, scrimColor, strong);
  doc.rect(0, y0, W, band).fill(grad);

  const ty = top ? MARGIN + 6 : H - MARGIN - textHeight - 6;
  doc
    .fillColor(tone === 'light' ? '#ffffff' : INK)
    .text(text, MARGIN, ty, { width, align: 'center', lineGap: 4 });
}

function pageNumber(doc, n, tone, zone) {
  doc.font(FONTS.body).fontSize(10).fillColor(tone === 'light' ? '#ffffff' : INK, 0.85);
  const y = zone === 'bottom' ? 12 : H - 22;
  doc.text(String(n), 0, y, { width: W, align: 'center' });
  doc.fillOpacity(1);
}

function aboutPage(doc, about, reference) {
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
  doc.image(bufferOf(reference), cx - d / 2, cy - d / 2, { width: d, height: d });
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
    doc.font(FONTS.bold).fontSize(12).fillColor('#2f5d34').text(label.toUpperCase(), MARGIN + 10, y, { width: W - MARGIN * 2 - 20, characterSpacing: 1 });
    doc.font(FONTS.body).fontSize(14).fillColor(INK).text(value, MARGIN + 10, doc.y + 2, { width: W - MARGIN * 2 - 20, lineGap: 3 });
    y = doc.y + 12;
  }

  doc.font(FONTS.body).fontSize(10).fillColor('#7a6a52').text('Jack and the Beanstalk, starring ' + about.name, 0, H - 40, { width: W, align: 'center' });
}

// pages: [{ number, text, zone, tone, image: {data, mimeType} }]
export function buildBookPdf({ pages, about, reference }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [W, H],
      margin: 0,
      autoFirstPage: false,
      info: { Title: `Jack and the Beanstalk, starring ${about.name}`, Author: 'beanstalk.eliweiss.me' },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    for (const page of pages) {
      doc.addPage({ size: [W, H], margin: 0 });
      doc.image(bufferOf(page.image), 0, 0, { cover: [W, H], align: 'center', valign: 'center' }); // full bleed
      storyText(doc, page);
      pageNumber(doc, page.number, page.tone, page.zone);
    }
    aboutPage(doc, about, reference);
    doc.end();
  });
}
