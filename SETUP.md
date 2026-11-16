# Positive Voice — deployment and YouTube setup

This is a deployable starter application, not a hosted website. It needs a Node.js 20+ server and credentials owned by the operator.

## What it does
- Mobile-friendly web interface and installable PWA manifest.
- Discovers batches of up to 100 public YouTube videos without requiring a topic. The discovery feed uses YouTube date ordering and persists previously shown video IDs in `data/discovery-state.json`, excluding them from subsequent batches. It is not a complete index of every video on YouTube.
- Connects a user's YouTube account with server-side Google OAuth.
- Optionally drafts a comment from the video's public title/description using an OpenAI API key.
- Requires a separate, explicit confirmation for every comment submission.
- Publishes approved comments sequentially with a five-second pause between submissions. YouTube quota and spam enforcement still apply.
- Blocks an exact duplicate comment on the same video when that publication is already recorded.

It does not bulk-post, run in the background, or claim to have watched a video. Metadata-based drafts must be checked by the user for accuracy.

## 1. Create Google credentials
1. Open https://console.cloud.google.com/ and create a project.
2. Enable **YouTube Data API v3** in APIs & Services → Library.
3. Configure the OAuth consent screen. Add your account as a test user while the app is in testing.
4. Create an OAuth client ID of type **Web application**.
5. Add the deployed app's callback URL as an Authorized redirect URI: `https://YOUR-DOMAIN/oauth2callback`.
6. Create an API key for public video search. Restrict it to YouTube Data API v3 and, where practical, your server's IP address.

**This implementation does not require a client secret, redirect URI, or session secret.** It uses Google's browser token model. Access tokens are held in the current browser tab's session storage and expire; reconnect YouTube when prompted. Do not paste credentials into chat or commit them to GitHub.

OAuth scope requested for account features: `youtube.readonly` and `youtube.force-ssl`. The latter is required to publish comments. Google may require verification before an app can be used broadly. Do not ask users for their Google password.

## 2. Deploy the app
Use a Node.js hosting provider that supports a persistent server and HTTPS (for example, Render, Railway, Fly.io, or a VPS). Upload this folder or connect its Git repository. Set the start command to `npm start` and Node version to 20 or newer.

Set these environment variables in the hosting provider (do not commit secrets):
- `BASE_URL=https://YOUR-DOMAIN`
- `SESSION_SECRET=` a long random secret
- `GOOGLE_CLIENT_ID=` OAuth client ID
- `GOOGLE_REDIRECT_URI=https://YOUR-DOMAIN/oauth2callback`
- `YOUTUBE_API_KEY=` restricted YouTube Data API key
- `OPENAI_API_KEY=` optional key for AI drafts
- `OPENAI_MODEL=gpt-4.1-mini` optional model override

Then install dependencies with `npm install` and start with `npm start`.

For production, configure HTTPS, secure secret storage, monitoring, and a privacy policy. OAuth access and refresh tokens are stored in an AES-256-GCM encrypted, HttpOnly, Secure, SameSite cookie. The encryption key is derived from `SESSION_SECRET`; this allows the login to survive page reloads and server restarts without relying on Render's ephemeral filesystem. The video discovery database is still stored on disk, so attach a persistent disk/volume and preserve the `data/` directory or discovery history can be lost after a restart or redeploy. Review Google OAuth verification requirements and YouTube API Services policies before public release.

## 3. Open on an iPhone
Once deployed, open your HTTPS domain in Safari → Share → Add to Home Screen. The app will then launch like an app. You can also use the website directly.

## Important YouTube limits and responsible use
YouTube's API does not permit indiscriminate or repetitive spam commenting. Do not use this app to post irrelevant, deceptive, repetitive, or unsolicited promotional comments. It is designed for individual user-reviewed contributions. YouTube may reject comments, disable comments on videos, or restrict accounts. API quota and OAuth verification also apply.

## Run locally
1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and fill in credentials.
3. Run `npm install`.
4. Run `npm start` and open `http://localhost:3000`.

For local OAuth, add `http://localhost:3000/oauth2callback` to the OAuth client's authorized redirect URIs.
