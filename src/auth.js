// Sign in with Google (OAuth 2.0 authorization-code flow + verified ID token).
// The session is a signed cookie holding only the user's id, so no session store is needed.
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import * as store from './store.js';
import { log } from './log.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PROD = process.env.NODE_ENV === 'production';
// A shortcut sign-in for local testing only; never available in production.
export const DEV_LOGIN = process.env.DEV_LOGIN === '1' && !PROD;

const callbackUrl = (req) => `${process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`}/auth/google/callback`;
const safeNext = (next) => (typeof next === 'string' && /^\/(?!\/)/.test(next) ? next : '/');

export const router = Router();

router.get('/auth/google', (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(503).send('Google sign-in is not set up on this server yet.');
  const state = randomBytes(16).toString('hex');
  req.session.oauth = { state, next: safeNext(req.query.next) };
  const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, callbackUrl(req));
  res.redirect(client.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, prompt: 'select_account' }));
});

router.get('/auth/google/callback', async (req, res) => {
  const pending = req.session.oauth;
  req.session.oauth = null;
  if (req.query.error) return res.redirect('/?signin=cancelled');
  if (!pending || !req.query.state || req.query.state !== pending.state || typeof req.query.code !== 'string') {
    log.warn('sign-in callback with a missing or wrong state');
    return res.redirect('/?signin=failed');
  }
  try {
    const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, callbackUrl(req));
    const { tokens } = await client.getToken(req.query.code);
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: CLIENT_ID });
    const p = ticket.getPayload();
    const user = await store.upsertUser({ sub: p.sub, email: p.email, name: p.name || p.email, picture: p.picture || null });
    req.session.uid = user.id;
    await store.logEvent({ userId: user.id, kind: 'login', detail: { via: 'google' } });
    res.redirect(pending.next);
  } catch (err) {
    log.error({ err }, 'google sign-in failed');
    res.redirect('/?signin=failed');
  }
});

router.get('/auth/dev-login', async (req, res) => {
  if (!DEV_LOGIN) return res.status(404).end();
  const user = await store.upsertUser({ sub: 'dev-local', email: 'dev@localhost', name: 'Dev Tester', picture: null });
  req.session.uid = user.id;
  await store.logEvent({ userId: user.id, kind: 'login', detail: { via: 'dev' } });
  res.redirect('/');
});

router.post('/auth/logout', (req, res) => {
  req.session = null;
  res.status(204).end();
});

router.get('/api/me', async (req, res, next) => {
  try {
    const user = req.session?.uid ? await store.getUser(req.session.uid) : null;
    res.json({
      user: user && { name: user.name, email: user.email, picture: user.picture },
      signInUrl: '/auth/google',
      devLogin: DEV_LOGIN,
    });
  } catch (err) {
    next(err);
  }
});

export function requireUser(req, res, next) {
  if (!req.session?.uid) return res.status(401).json({ error: 'Please sign in with Google first.' });
  req.userId = req.session.uid;
  next();
}
