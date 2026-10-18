import { GoogleGenAI } from '@google/genai';

export const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1';

let client;
function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new HttpError(500, 'The server has no GEMINI_API_KEY set.');
  }
  // The SDK reads GEMINI_API_KEY from the environment itself.
  client ??= new GoogleGenAI({});
  return client;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// One request to the image model. Deliberately no retry loop: if it fails,
// the error goes back to the user, who decides whether to try again.
//
// images: [{ data: base64, mimeType }]  prompt: string
export async function generateImage({ prompt, images, aspectRatio = '1:1' }) {
  const input = [
    { type: 'text', text: prompt },
    ...images.map((img) => ({ type: 'image', mime_type: img.mimeType, data: img.data })),
  ];

  let interaction;
  try {
    interaction = await getClient().interactions.create({
      model: MODEL,
      input,
      // Uploaded faces are personal data: don't keep them on Google's side.
      store: false,
      response_format: {
        type: 'image',
        mime_type: 'image/jpeg',
        aspect_ratio: aspectRatio,
        image_size: '1K',
      },
    });
  } catch (err) {
    throw translateError(err);
  }

  const image = interaction.output_image;
  if (!image?.data) {
    const said = interaction.output_text?.trim();
    throw new HttpError(
      422,
      said
        ? `The model didn't return a picture. It said: "${said.slice(0, 300)}"`
        : "The model didn't return a picture (it may have been blocked by a safety filter). Try a different photo.",
    );
  }
  return { data: image.data, mimeType: image.mime_type || 'image/jpeg' };
}

function translateError(err) {
  if (err instanceof HttpError) return err;
  const status = err?.status;
  console.error('Gemini error', status, err?.message);
  if (status === 429) {
    return new HttpError(429, 'The image service is busy or out of quota right now. Please wait a minute and try again.');
  }
  if (status === 400) {
    return new HttpError(400, 'The image service rejected that request. Try a different, clearer photo.');
  }
  if (status === 401 || status === 403) {
    return new HttpError(500, "The server's API key was refused. The site owner needs to check it.");
  }
  return new HttpError(502, 'The image service had a problem. Please try again.');
}
