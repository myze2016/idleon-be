# Google login

The login and registration screen includes Continue with Google. Google users receive the same private, database-backed session as password users, then return to `/dashboard`. First-time users get a player account and create their starter character normally. Returning accounts are identified by Google's stable subject ID, even if their Google email later changes. Password accounts are never automatically linked by email: if that email already belongs to a password account, the user must use their existing login.

## Setup

1. In Google Cloud Console, configure the OAuth consent screen for your project. While in testing, add your Google account as a test user.
2. Create an OAuth client with application type **Web application**.
3. Add the authorized redirect URI exactly:

   ```text
   http://localhost:3020/api/auth/google/callback
   ```

   This frontend `/api` path is forwarded to the backend by the Next.js rewrite, keeping the browser session cookie on the frontend host. If `NEXT_PUBLIC_API_URL` points directly to a different backend host, use the backend's public callback URL instead and configure that exact URI in Google and `.env`.

   Set frontend `.env.local` `BACKEND_URL` to the running backend origin, for example `BACKEND_URL=http://localhost:8000` when backend `PORT=8000`. `NEXT_PUBLIC_API_URL` configures browser requests separately; it does not configure the `/api` rewrite. Restart the frontend after changing proxy settings. A plain `Internal Server Error` at the frontend callback, together with a failing frontend `/api/health`, can indicate that this proxy points to the wrong port.

4. Set backend `.env`:

   ```env
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:3020/api/auth/google/callback
   ```

   Keep the secret backend-only. The configured `CORS_ORIGIN` is the trusted frontend origin used after login; never include a path or trailing slash.

5. Apply migrations with `npm.cmd run db:deploy`, regenerate with `npm.cmd run db:generate`, restart the backend, and click Continue with Google.

For deployment, replace the local callback with the public HTTPS URL in both Google and `.env`. Production cookie settings require HTTPS.

The backend uses Google's official OAuth library, authorization-code exchange with PKCE, session-bound single-use state (10-minute expiry), a nonce, and verified ID tokens. Access and refresh tokens are not stored or sent to the browser. Existing accounts keep their teams and progress. New Google accounts receive a random unusable password hash; use Google to sign in.

Official setup guide: https://developers.google.com/identity/protocols/oauth2/web-server
