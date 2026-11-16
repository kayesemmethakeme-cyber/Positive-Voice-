require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { google } = require('googleapis');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
app.set('trust proxy', 1); // Render terminates HTTPS at its proxy; required for secure session cookies.
const PORT = process.env.PORT || 3000;
const required = ['SESSION_SECRET','GOOGLE_CLIENT_ID','GOOGLE_REDIRECT_URI','YOUTUBE_API_KEY'];
const missing = required.filter(k => !process.env[k]);
const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
const youtubePublic = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
const published = new Map();
let lastPublishAt = 0;
const dataDir = path.join(__dirname, 'data');
const discoveryFile = path.join(dataDir, 'discovery-state.json');
fs.mkdirSync(dataDir, { recursive: true });
function loadDiscoveryState() {
  try { return JSON.parse(fs.readFileSync(discoveryFile, 'utf8')); }
  catch { return { seenIds: [], nextPageToken: null, batches: 0 }; }
}
let discoveryState = loadDiscoveryState();
function saveDiscoveryState() {
  const temp = discoveryFile + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(discoveryState));
  fs.renameSync(temp, discoveryFile);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(session({
  name: 'pv.sid', secret: process.env.SESSION_SECRET || 'development-only-change-me',
  proxy: true, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));
const apiLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api', apiLimiter);

function ensureConfigured(req, res, next) {
  if (missing.length) return res.status(503).json({ error: 'The app still needs its Google Cloud settings.', missing });
  next();
}
function ensureAuth(req, res, next) {
  if (!req.session.tokens) return res.status(401).json({ error: 'Connect your YouTube account first.' });
  oauth2Client.setCredentials(req.session.tokens);
  next();
}

app.get('/api/status', (req, res) => res.json({
  configured: missing.length === 0,
  missing,
  connected: Boolean(req.session.tokens),
  channel: req.session.channel || null,
  aiConfigured: Boolean(process.env.OPENAI_API_KEY),
  mode: 'individual-approval'
}));

const pendingOAuth = new Map();
function createOAuthState() {
  const nonce = crypto.randomBytes(24).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const payload = Buffer.from(JSON.stringify({ t: Date.now(), n: nonce })).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  pendingOAuth.set(nonce, { codeVerifier, createdAt: Date.now() });
  return { state: payload + '.' + signature, codeChallenge, nonce };
}
function readOAuthState(state) {
  if (typeof state !== 'string') return null;
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!Number.isFinite(payload.t) || Date.now() - payload.t < 0 || Date.now() - payload.t >= 10 * 60 * 1000) return null;
    const pending = pendingOAuth.get(payload.n);
    if (!pending || Date.now() - pending.createdAt >= 10 * 60 * 1000) return null;
    pendingOAuth.delete(payload.n);
    return pending;
  } catch { return null; }
}
app.get('/api/oauth-config', ensureConfigured, (req, res) => {
  req.session.oauthNonce = crypto.randomBytes(24).toString('hex');
  req.session.save(err => {
    if (err) return res.status(500).json({ error: 'Could not initialize Google sign-in. Please reload and try again.' });
    res.json({ clientId: process.env.GOOGLE_CLIENT_ID, csrf: req.session.oauthNonce });
  });
});

app.post('/auth/google/code', ensureConfigured, async (req, res) => {
  try {
    if (req.get('X-Requested-With') !== 'XmlHttpRequest') {
      return res.status(400).json({ error: 'Invalid Google sign-in request.' });
    }
    const csrf = req.get('X-PV-CSRF');
    if (!req.session.oauthNonce || !csrf || csrf !== req.session.oauthNonce) {
      return res.status(400).json({ error: 'Google sign-in expired. Reload Positive Voice and connect again.' });
    }
    delete req.session.oauthNonce;
    const code = String(req.body?.code || '');
    if (!code) return res.status(400).json({ error: 'Google did not return an authorization code.' });

    // Google Identity Services Code Model (popup UX). For current Google
    // Web application OAuth clients, client_secret is not used. In popup
    // mode, redirect_uri is the web origin, not the old callback path.
    const body = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      code,
      grant_type: 'authorization_code',
      redirect_uri: new URL(process.env.BASE_URL).origin
    });
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      console.error('OAuth token exchange:', tokenData.error, tokenData.error_description);
      return res.status(502).json({ error: 'Google token exchange failed: ' + String(tokenData.error_description || tokenData.error || 'unknown error') });
    }
    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      scope: tokenData.scope,
      token_type: tokenData.token_type,
      expiry_date: Date.now() + Number(tokenData.expires_in || 3600) * 1000
    };
    oauth2Client.setCredentials(tokens);
    const yt = google.youtube({ version: 'v3', auth: oauth2Client });
    const me = await yt.channels.list({ part: ['snippet'], mine: true });
    const channel = me.data.items?.[0];
    req.session.tokens = tokens;
    req.session.channel = channel ? { id: channel.id, title: channel.snippet?.title } : { title: 'Connected YouTube account' };
    req.session.save(err => {
      if (err) return res.status(500).json({ error: 'YouTube connected, but the app could not save your login session. Please try again.' });
      res.json({ ok: true, channel: req.session.channel });
    });
  } catch (e) {
    console.error('OAuth callback:', e.message);
    res.status(500).json({ error: 'Could not connect YouTube. Check the server logs for the OAuth callback error.' });
  }
});
app.post('/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.post('/api/discover', async (req, res) => {
  try {
    const requested = Number(req.body?.limit) || 100;
    const limit = Math.min(Math.max(Math.floor(requested), 1), 100);
    const seen = new Set(discoveryState.seenIds);
    const videos = [];
    let pageToken = discoveryState.nextPageToken || undefined;
    let pagesChecked = 0;
    // YouTube returns at most 50 search results per page. Continue through
    // pages until this batch is full or the current result stream is exhausted.
    while (videos.length < limit && pagesChecked < 12) {
      const params = {
        part: ['snippet'], type: ['video'], maxResults: 50,
        order: 'date', safeSearch: 'moderate', regionCode: 'US'
      };
      if (pageToken) params.pageToken = pageToken;
      const result = await youtubePublic.search.list(params);
      pagesChecked += 1;
      for (const item of (result.data.items || [])) {
        const id = item.id?.videoId;
        if (!id || seen.has(id)) continue;
        const snippet = item.snippet || {};
        videos.push({
          id, title: snippet.title || 'Untitled video', channelId: snippet.channelId,
          channel: snippet.channelTitle || 'Unknown channel',
          description: (snippet.description || '').slice(0, 900),
          publishedAt: snippet.publishedAt,
          thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url,
          url: `https://www.youtube.com/watch?v=${id}`
        });
        seen.add(id);
        if (videos.length >= limit) break;
      }
      pageToken = result.data.nextPageToken || undefined;
      if (!pageToken) break;
    }
    // Record every video shown in a discovery batch so future batches exclude it,
    // even if the user does not prepare or publish a comment for it.
    discoveryState = {
      seenIds: Array.from(seen),
      nextPageToken: pageToken || null,
      batches: (discoveryState.batches || 0) + 1
    };
    saveDiscoveryState();
    res.json({
      videos, requested: limit, returned: videos.length,
      totalRemembered: discoveryState.seenIds.length,
      batches: discoveryState.batches,
      exhausted: videos.length < limit,
      note: videos.length < limit ? 'The current YouTube discovery stream had fewer unseen videos available. New uploads may appear on a later discovery.' : null
    });
  } catch (e) {
    console.error('Discovery:', e.message);
    res.status(500).json({ error: 'Could not discover videos. Check the YouTube API key, quota, and server connection.' });
  }
});

app.get('/api/discovery-stats', (req, res) => res.json({
  totalRemembered: discoveryState.seenIds.length,
  batches: discoveryState.batches || 0
}));
app.post('/api/draft', async (req, res) => {
  const { title, channel, description, style } = req.body || {};
  if (!title || !channel) return res.status(400).json({ error: 'Video title and channel are required.' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Add OPENAI_API_KEY to enable AI-generated drafts. You can still write comments manually.' });
  try {
    const prompt = `Write one concise, genuinely useful, positive YouTube comment based only on the supplied video metadata. Do not pretend to have watched the video. Do not make claims about unseen content. Avoid generic praise, promotion, links, calls to action, hashtags, repeated templates, or mentioning AI. If metadata is too thin to support a meaningful observation, ask a thoughtful, relevant question instead. Keep it natural, specific, respectful, and under 65 words. Style: ${style || 'thoughtful, warm, and articulate'}.\nVideo title: ${title}\nChannel: ${channel}\nDescription: ${description || '(none)'}`;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 130 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'AI request failed');
    res.json({ comment: data.choices?.[0]?.message?.content?.trim() || '' });
  } catch (e) { console.error(e.message); res.status(500).json({ error: 'Could not generate a draft. Check the AI key and model access.' }); }
});

app.post('/api/publish', ensureConfigured, ensureAuth, async (req, res) => {
  const { videoId, channelId, comment, userConfirmed } = req.body || {};
  const text = String(comment || '').trim();
  if (userConfirmed !== true) return res.status(400).json({ error: 'Explicit approval is required for every individual comment.' });
  if (!videoId || !channelId || text.length < 3 || text.length > 1000) return res.status(400).json({ error: 'Check the video and comment text (3–1,000 characters).' });
  if (Date.now() - lastPublishAt < 60_000) return res.status(429).json({ error: 'Please wait at least 60 seconds between individual publications.' });
  const key = `${req.session.channel?.id || 'user'}:${videoId}`;
  if (published.has(key)) return res.status(409).json({ error: 'This account has already published a comment to this video in this app session.' });
  try {
    const yt = google.youtube({ version: 'v3', auth: oauth2Client });
    const result = await yt.commentThreads.insert({ part: ['snippet'], requestBody: { snippet: { channelId, videoId, topLevelComment: { snippet: { textOriginal: text } } } } });
    published.set(key, result.data.id);
    lastPublishAt = Date.now();
    res.json({ ok: true, commentId: result.data.id, videoUrl: `https://www.youtube.com/watch?v=${videoId}` });
  } catch (e) {
    console.error('Publish:', e.message);
    res.status(500).json({ error: 'YouTube did not accept this comment. It may be disabled, restricted, or your account may lack permission.' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Positive Voice running on port ${PORT}`));
