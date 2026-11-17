// Builds a book's PDFs from what is stored in the database. The reading copy is stored
// with the book, so a finished book downloads at once on any later visit; the print files
// are stored with each print order.
import { buildBookPdf, buildPrintInterior, buildPrintCover } from './pdf.js';
import { storyOf, pageText, normalizeAbout } from './book.js';
import * as store from './store.js';

// Everything the PDF layer needs, or null if the book isn't complete
// (a page, the hero or the name is missing).
export async function loadBook(bookId) {
  const book = await store.getBookForJob(bookId);
  if (!book) return null;
  const about = normalizeAbout(book.about);
  const story = storyOf(book.story);
  if (!about.name) return null;
  const [reference, cover, ...pages] = await Promise.all([
    store.getImage(bookId, 'reference'),
    store.getPageForPdf(bookId, 'cover'),
    ...story.pages.map((p) => store.getPageForPdf(bookId, p.id)),
  ]);
  if (!reference || pages.some((p) => !p)) return null;
  // Books made before the cover existed use their first page as the cover art.
  const coverArt = cover || pages[0];
  return {
    bookId, story, about, createdAt: book.created_at,
    reference: reference.buffer,
    cover: { art: coverArt.buffer, faces: coverArt.analysis?.faces || [] },
    pages: story.pages.map((p, i) => ({
      number: p.number, text: pageText(p, about.name, story), image: pages[i].buffer,
      zone: pages[i].zone || p.zone, tone: pages[i].tone || 'light',
    })),
  };
}

// Returns the reading copy's bytes (and stores them), or null if the book isn't complete.
export async function buildAndStorePdf(bookId) {
  const book = await loadBook(bookId);
  if (!book) return null;
  const pdf = await buildBookPdf(book);
  await store.savePdf(bookId, pdf);
  return pdf;
}

// The two files the printer needs.
export async function buildPrintFiles(bookId, coverDims) {
  const book = await loadBook(bookId);
  if (!book) return null;
  const [interior, cover] = await Promise.all([buildPrintInterior(book), buildPrintCover(book, coverDims)]);
  return { interior, cover };
}
