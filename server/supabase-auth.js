'use strict';

// Validates Supabase access tokens by asking Supabase Auth for the user.
// This avoids trusting decoded JWT claims without signature verification.
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';

function supabaseAuthConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

async function requireSupabaseUser(req, res, next) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Sign in to your SUHAIS account to continue.' });
  }
  if (!supabaseAuthConfigured()) {
    return res.status(503).json({ error: 'Account authentication is not configured on the server.' });
  }
  try {
    const response = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + match[1]
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      return res.status(401).json({ error: 'Your SUHAIS session is invalid or expired. Please sign in again.' });
    }
    const user = await response.json();
    if (!user || typeof user.id !== 'string' || !user.id) {
      return res.status(401).json({ error: 'Supabase did not return a valid signed-in user.' });
    }
    req.suhuisUser = Object.freeze({ id: user.id, email: user.email || null });
    req.supabaseAccessToken = match[1];
    return next();
  } catch (error) {
    return res.status(503).json({ error: 'Could not verify your SUHAIS session. Please try again.' });
  }
}

module.exports = { requireSupabaseUser, supabaseAuthConfigured };
