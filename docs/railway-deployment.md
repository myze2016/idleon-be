# Deploy IdleOn backend to Railway

The repository includes a Node 22 Dockerfile. It builds Prisma Client and TypeScript, listens on Railway's injected `PORT` on `0.0.0.0`, runs as the non-root node user, and excludes local `.env` files and exported database data from the build. Keep this backend and PostgreSQL in the same Railway project and region.

## Railway dashboard

1. Create a project and add **PostgreSQL**. Name the database service `Postgres`, or adjust the reference below to its actual service name.
2. Add **GitHub Repo** and choose `myze2016/idleon-be`. The latest deployment files must be committed and pushed before Railway can build them. This is a standalone backend repository: its root directory is `/`, not `/idleon-be`.
3. Railway should detect the root `Dockerfile`. Select the Dockerfile builder if needed. Leave the custom build and start commands empty; the Dockerfile supplies them.
4. Set the backend service's **Pre-deploy Command** to `npm run db:deploy`. This applies the committed PostgreSQL migrations before the new version starts. Set a 300-second pre-deploy timeout.
5. Set **Healthcheck Path** to `/api/health`. Generate a public domain under Networking after the service is deployed. Do not hardcode `PORT=8000`; let Railway inject it.
6. Copy the variable names from `railway.env.example` into Railway Variables and replace every placeholder. `DATABASE_URL=${{Postgres.DATABASE_URL}}` is a Railway reference to the private database connection string. Do not use your local `127.0.0.1` database URL.

Required variables:

```env
NODE_ENV=production
TRUST_PROXY_HOPS=1
DATABASE_URL=${{Postgres.DATABASE_URL}}
CORS_ORIGIN=https://YOUR-FRONTEND.vercel.app
SESSION_SECRET=YOUR_NEW_RANDOM_SECRET
```

Generate a new secret locally without putting it in source code:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Paste the output only into Railway Variables. Keep it stable across deployments so sessions survive restarts. `TRUST_PROXY_HOPS=1` trusts the nearest Railway proxy, allowing secure HTTPS cookies. Do not set unrestricted `trust proxy=true`. If you later change the proxy topology, verify the trusted hops and client IP behavior before changing this value.

## Vercel frontend

You can deploy the backend and database before Vercel. Until the frontend URL exists, keep a placeholder frontend origin in Railway and use `/api/health` to check the backend. Set the final `CORS_ORIGIN` and Google callback before testing production login.

Set these Vercel project environment variables and redeploy the frontend:

```env
NEXT_PUBLIC_API_URL=/api
BACKEND_URL=https://YOUR-BACKEND.up.railway.app
```

`BACKEND_URL` has no `/api` suffix. Browser requests must use the frontend `/api` rewrite so login cookies stay on the frontend domain. Do not put database credentials, the session secret, Google client secret, or Resend key in Vercel public variables. Use the same exact frontend domain in backend `CORS_ORIGIN`, without a trailing slash; preview domains are not automatically allowed.

## Realtime multiplayer

Gathering movement, chat, PvP rooms and lobby changes use authenticated WebSockets
at `/realtime` on the Railway backend. HTTP login remains on the Vercel `/api`
proxy. The frontend requests a short-lived ticket through that proxy, then opens
the socket directly to Railway; no cross-site login cookie is needed.

Railway's `RAILWAY_PUBLIC_DOMAIN` automatically supplies the socket address. If
you use a custom domain, set the backend variable
`REALTIME_PUBLIC_URL=wss://YOUR-PUBLIC-BACKEND-DOMAIN/realtime`. Keep `CORS_ORIGIN`
equal to the exact frontend origin and keep `SESSION_SECRET` identical across
backend replicas. No new public frontend variable is required.

Small events are relayed between replicas with PostgreSQL `LISTEN/NOTIFY` using
one dedicated connection per backend instance. Use the direct Railway PostgreSQL
`DATABASE_URL`, not a transaction-mode pooler URL. Existing HTTP requests remain
the authority for chat, teams, invitations and battles. Socket movement validates
the current room lease before saving or broadcasting it. Disconnected clients
reconnect with a fresh ticket and fall back to polling in the meantime.

After redeploying both apps, browser Network > WS should show `/realtime` on your
Railway domain with status 101, followed by `ready` and `subscribed` messages.
Check movement and chat with two accounts, then interrupt the connection to verify
polling fallback and reconnect. Socket tickets are sent in the first frame, not
in the URL. This change requires no database migration or Redis service.

## Google and email registration

Set backend `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and:

```env
GOOGLE_REDIRECT_URI=https://YOUR-FRONTEND.vercel.app/api/auth/google/callback
```

Add that exact callback URL to your Google OAuth web client. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` to your verified sender to enable email-code registration.

## First admin and existing data

A new cloud database starts empty. Migrations create tables but do not copy your local accounts, progress, admin, or donation QR. Use the repository's export/import tools separately if you want to transfer local data; do not upload `.env` or database exports to GitHub.

Do not run `db:seed` on production: it is intentionally development-only and grants test resources. To create a fresh production admin, set a strong `SEED_ADMIN_PASSWORD` in Railway Variables, open a shell in the running service, and run:

```sh
npm run admin:provision
```

This creates only the `admin` account, with no test characters, currencies, or map unlocks. It never overwrites an existing account. For an existing admin, `npm run admin:password` changes its password and revokes its sessions. Remove `SEED_ADMIN_PASSWORD` from Railway Variables afterward if you do not need further password maintenance.

## Verify

Check `https://YOUR-BACKEND.up.railway.app/api/health` and `https://YOUR-FRONTEND.vercel.app/api/health`, then test login, registration and Google sign-in through the frontend. Production cookies must have HttpOnly, Secure and SameSite=Lax. Keep optional Railway Serverless sleeping disabled if you need an always-running multiplayer API. Start with one backend replica and measure actual usage before scaling.

Railway setup references: https://docs.railway.com/guides/express and https://docs.railway.com/deployments/pre-deploy-command
