// Builds a book's PDF from what is stored in the database, and stores the PDF too, so
// a finished book downloads at once on any later visit.
import { buildBookPdf } from './pdf.js';
import { storyOf, pageText, normalizeAbout } from './book.js';
import * as store from './store.js';

// Returns the PDF bytes, or null if the book isn't complete (a page, the hero or the name is missing).
export async function buildAndStorePdf(bookId) {
  const book = await store.getBookForJob(bookId);
  if (!book) return null;
  const about = normalizeAbout(book.about);
  const story = storyOf(book.story);
  if (!about.name) return null;
  const [reference, ...pages] = await Promise.all([
    store.getImage(bookId, 'reference'),
    ...story.pages.map((p) => store.getPageForPdf(bookId, p.id)),
  ]);
  if (!reference || pages.some((p) => !p)) return null;
  const pdf = await buildBookPdf({
    story,
    about,
    reference: reference.buffer,
    pages: story.pages.map((p, i) => ({
      number: p.number, text: pageText(p, about.name, story), image: pages[i].buffer,
      zone: pages[i].zone || p.zone, tone: pages[i].tone || 'light',
    })),
  });
  await store.savePdf(bookId, pdf);
  return pdf;
}
