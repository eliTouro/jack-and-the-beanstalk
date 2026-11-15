// The quality loop every generated picture goes through:
//   draw -> check -> passed? done.  failed? draw again, telling the model what was wrong.
// At most MAX_ATTEMPTS drawings. If none passes, the best-scoring one is used.
// A deadline keeps a whole book under a minute: no new drawing starts after it, and
// the best so far wins.
import { HttpError } from './image.js';

export const MAX_ATTEMPTS = 3;

// make(attempt, feedback) -> image { data, mimeType, model, usage, costUsd, ms }
// check(image, attempt)   -> analysis { ok, score, issues, ... , costUsd, ms }
// onStep({ attempt, phase })  phase: 'drawing' | 'checking'
// onCall({ kind: 'image' | 'analysis', attempt, ok, model, usage, costUsd, ms, error })
// Returns { image, analysis, attempts, chosen, passed, history: [{ attempt, score, ok, issues, error }] }.
export async function drawWithQuality({ make, check, maxAttempts = MAX_ATTEMPTS, deadlineAt = Infinity, onStep = () => {}, onCall = () => {} }) {
  const tries = [];
  const history = [];
  let feedback = '';
  let lastError = null;
  let attempt = 0;

  while (attempt < maxAttempts) {
    if (attempt > 0 && Date.now() > deadlineAt) break; // out of time: keep the best so far
    attempt++;
    await onStep({ attempt, phase: 'drawing' });
    let image;
    const t0 = Date.now();
    try {
      image = await make(attempt, feedback);
      await onCall({ kind: 'image', attempt, ok: true, model: image.model, usage: image.usage, costUsd: image.costUsd, ms: image.ms });
    } catch (err) {
      lastError = err;
      await onCall({ kind: 'image', attempt, ok: false, costUsd: 0, ms: Date.now() - t0, error: err.message });
      history.push({ attempt, ok: false, score: null, issues: [], error: err instanceof HttpError ? err.message : 'The drawing failed.' });
      // A refusal (safety filter, bad request) will not change on a retry with the same input.
      if (err instanceof HttpError && [400, 401, 403, 422, 500].includes(err.status)) break;
      continue;
    }

    await onStep({ attempt, phase: 'checking' });
    let analysis;
    try {
      analysis = await check(image, attempt);
      await onCall({ kind: 'analysis', attempt, ok: true, model: analysis.model, usage: analysis.usage, costUsd: analysis.costUsd, ms: analysis.ms });
    } catch (err) {
      // The check itself broke. Keep the picture, unscored, rather than lose it.
      await onCall({ kind: 'analysis', attempt, ok: false, costUsd: 0, ms: 0, error: err.message });
      analysis = { ok: true, score: 50, issues: [], faces: [], objects: [], clear: {}, summary: 'The check could not run, so this picture was not scored.', unchecked: true };
    }
    tries.push({ attempt, image, analysis });
    history.push({ attempt, ok: analysis.ok, score: analysis.score, issues: analysis.issues, summary: analysis.summary });
    if (analysis.ok) break;
    feedback = analysis.issues.join('; ');
  }

  if (!tries.length) throw lastError || new HttpError(502, 'The picture could not be drawn.');
  const best = tries.reduce((a, b) => (b.analysis.score > a.analysis.score ? b : a));
  return { image: best.image, analysis: best.analysis, attempts: attempt, chosen: best.attempt, passed: best.analysis.ok, history };
}
