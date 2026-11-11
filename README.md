# IdleOn API

## Development login

Start this API and the frontend with `npm.cmd run dev` in separate terminals.
Open http://localhost:3000/login and sign in with `admin` / `Admin123!`.
The built-in account is disabled when `NODE_ENV=production`.

Authentication endpoints: `POST /api/auth/login`, `GET /api/auth/me`, and
`POST /api/auth/logout`. POST requests must include the configured frontend Origin.
Sessions use HTTP-only cookies, expire after eight hours, and are stored in memory;
restarting the backend signs everyone out. Before production, replace the test user
with persisted users, use a persistent session store, set a strong `SESSION_SECRET`,
and configure HTTPS. Apply `requireAuth` to any future private API routes.

Express 5 with TypeScript. Requires Node.js 22 or later.

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run dev
```

The API runs at http://localhost:4000. Check `GET /api/health`.
The frontend origin defaults to http://localhost:3000; configure it with `CORS_ORIGIN`.
Environment variables are validated at startup. Never commit `.env`.

## Commands

- `npm run dev`: restart automatically during development.
- `npm run typecheck`: check TypeScript without emitting files.
- `npm test`: test health, missing routes, and malformed JSON.
- `npm run build`: compile to `dist/`.
- `npm start`: run the compiled API (build first).

## Structure

```text
src/
  config/         Environment and application configuration
  controllers/    HTTP request and response handling
  middlewares/    Shared request handling and error responses
  models/         Future data models and schemas
  repositories/   Future database queries and persistence
  routes/         Endpoint definitions
  services/       Business logic
  utils/          Shared utilities
  app.ts          Express setup, without opening a port
  server.ts       Startup and graceful shutdown
tests/            API integration tests
```

Keep controllers thin, put business rules in services, and keep database access in
repositories. Models and repositories are placeholders until a database is chosen.
The app includes Helmet headers, an explicit CORS origin, bounded JSON bodies,
JSON 404 responses, and centralized errors that hide unexpected error details.
Use Express 5 async handlers directly; rejected promises reach the error handler.
