# IdleOn API

## Development login

Start this API and the frontend with `npm.cmd run dev` in separate terminals.
Open http://localhost:3000/login and sign in with `admin` / `Admin123!`.
Run `npm run db:seed` once to create this database account. The seed is disabled
in production and does not reset an existing account's password.

Authentication endpoints: `POST /api/auth/login`, `GET /api/auth/me`, and
`POST /api/auth/logout`. POST requests must include the configured frontend Origin.
Sessions use HTTP-only cookies, expire after eight hours, and are stored in MariaDB.
Keep `SESSION_SECRET` stable in `.env` so sessions survive backend restarts. Use a
long random value, configure HTTPS for production, and change the development
account password before deploying. Apply `requireAuth` to future private routes.

Express 5 with TypeScript, Prisma 7, and MySQL/MariaDB. Requires Node.js 22.12+.
Start MySQL in XAMPP and create `idleon-db` before running migrations.

```powershell
Copy-Item .env.example .env
# Set DATABASE_URL and a random SESSION_SECRET in .env before continuing.
npm install
npm run db:deploy
npm run db:seed
npm run dev
```

The API runs at http://localhost:8000. Check `GET /api/health`.
The frontend origin defaults to http://localhost:3000; configure it with `CORS_ORIGIN`.
Environment variables are validated at startup. Never commit `.env`.

## Database

`prisma/schema.prisma` defines the schema; migrations are in `prisma/migrations/`.
The local `.env` uses `mysql://root:@127.0.0.1:3306/idleon-db` for XAMPP. Change
the connection string if your database credentials differ. Keep it on the backend.

| Table | Purpose |
| --- | --- |
| `users` | Unique username, password hash, role, starter claim, wish currency |
| `characters` | Owned roster with starter flag, name, weapon enum, timestamps |
| `sessions` | Server-side cookie session data and indexed expiration |
| `encounters` | Owned enemy encounters, team snapshot, saved battle result |

Each user can own multiple characters. The foreign key cascades on user deletion.
`_prisma_migrations` records applied migrations.

The free starter is created once per signed-in account using `GET /api/character` and
`POST /api/character` (`name`, `weapon`). Names must be 2–24 characters. The API
validates weapon choices and rejects duplicate creation. Characters are stored
in MariaDB. The development seed imports an existing admin character from
`data/characters.json` if present, without overwriting a saved database character.
The legacy file is preserved and is no longer used by API requests.

`DELETE /api/character` removes the signed-in user's character and returns 204.
It requires the configured frontend Origin and preserves the login account and
session so the player can create a new starter character.

`GET /api/character` returns `character` (starter), `characters` (full owned roster),
and `wishCurrency`. Starter creation grants 1 currency in the same transaction.
`POST /api/character/wish` spends 1 currency and awards a random one of the 11
weapon types not already owned, with equal chances among the remaining types.
The starter counts as owned. User row locking prevents concurrent wishes from
awarding the same type. Once all 11 are owned, wishes return 409 without spending
currency. Existing characters are preserved; no migration or deduplication is needed.
It returns the updated state plus `reward`. The backend chooses the result using
`crypto.randomInt`; an atomic conditional debit prevents overspending. The wish
route requires authentication and the configured frontend Origin. Character reset
deletes the whole roster and clears the balance; creating a new starter grants 1.
The wish migration preserves existing starters and grants their first currency.

Base stats for all 11 weapon types are defined in `src/models/character-stats.ts`.
Roster entries and wish rewards include these server-controlled `stats`. Stats are
derived from weapon type for both existing and new characters; no migration is
needed when adjusting the base catalog. Client-submitted stats are ignored.

Enemies are defined in `src/models/enemy.ts`: Forest contains Coco Klan Warrior
and Slinger; Meadow contains Boar, Slime, and Plant. Regular monsters use the configured base
stats and award 10 gold when defeated. `POST /api/encounters` accepts `location`
("forest" or "meadow") and 1–6 owned `teamIds`, and returns a random enemy from
that location's pool. Each call creates another pending monster. Changing team or
location discards incompatible pending monsters without rewards. `newExpedition:
true` discards all pending monsters when starting a fresh run. At most 32 monsters
may be pending; defeat them before requesting more.
`POST /api/encounters/:id/resolve` resolves one monster. `POST /api/encounters/resolve`
accepts `encounterIds` for a group from the same team/location. Combat uses database-owned characters
and server stats, then returns the attack timeline and updated gold. User row
locks and a conditional result write ensure duplicate requests cannot award twice.
Both routes require authentication and the configured Origin. `GET /api/character`
includes the saved `gold` balance. Character reset clears gold and encounters.

Automatic battles use a timestamped attack schedule (team first on ties), attack the
first surviving team member, and deal the greater of physical or magic damage
after the corresponding defense, with a minimum of 1. HP and MP are saved between encounters throughout an expedition. Starting a new expedition restores the team to full HP and MP.

Every defeated monster awards 1 account EXP in the same transaction as gold.
EXP is stored on `users.experience`, not on characters. Level starts at 1 and
requires 10 EXP for the first level-up, then doubles the requirement each level:
10, 20, 40, 80, etc. `src/models/account-progress.ts` defines this rule.
Character state and battle responses include `progression` with level, total EXP,
current-level EXP, and the next-level requirement. Each level gained grants 20 wish
currency in the reward transaction, including multiple levels gained in one battle.
Duplicate reward requests cannot award EXP or level wishes twice. Existing total
EXP is retained and interpreted using the new curve; prior levels are not retroactively
paid. Wishes and team changes preserve progression; Delete account
resets it along with gold and the roster. EXP begins at 0 when this migration runs.

`POST /api/character/:id/skill-2/unlock` unlocks Skill 2 for an owned character for
10,000 account gold. Ownership, balance, payment, and the saved per-character flag
are checked in a transaction. Repeated requests for an unlocked skill do not charge
again. Roster entries and wish rewards expose `skill2Unlocked` and the skill catalog.
Skill 1 is available by default; Skill 2 effects only apply after unlocking. Basic attack type comes from the
character's base `range` stat, including the configured melee Bow/Wand types.

Speed scales attack intervals and spell cast times by `baseSeconds / (1 + speed / 100)`.
Basic attacks default to a 1-second interval. All spells default to a 1-second base
cast time; Speed 10 gives approximately 0.91 seconds and Speed 100 gives 0.5 seconds.
`src/models/action-timing.ts` defines the timing helpers. Server battle steps include
`at` (seconds since combat began), so faster units can attack more often rather
than merely moving earlier in each round. Roster entries expose `timing`, including
the default and adjusted spell cast time.

The real skill definitions live in `src/models/skills.ts`, with automatic combat
in `src/services/skill-battle.service.ts`. Active skills use a 1-second base cast
and a 5-second cooldown after completion. The AI prefers available Skill 2, then
Skill 1, then basic attacks, provided resources and a useful living target exist.
MP and HP costs are paid on cast start. Healing caps at max HP and does not revive.
Berserker Blow requires more than its 30 HP cost. Buffs and cooldowns are battle-local.

Confirmed defaults: Counterattack and Rifle skill-critical chance are 30%, with
2x critical damage. Fireball deals 20 damage for 10 MP. Book's attack/speed buffs
last 7 seconds and do not stack with the same buff on one target. Poison ticks
for 5 HP once per second for 5 seconds, bypasses defense, and refreshes without
stacking. Hero lasts 7 seconds; Burst Fire lasts 3 seconds. Speed buffs rescale
remaining attack and cast progress and revert on expiration. Inferno hits every
living enemy in the battle. Each enemy has independent HP, poison, stun, and attack
timing. Snapshots include `enemyIndex` and `enemyHps` for multi-monster playback, plus
MP, cast progress, event labels, healing, targets, and critical flags for playback.

Meadow boss progress is stored on `users.meadow_defeats` and `meadow_boss_at`. A
random target of 25–30 regular Meadow defeats makes the next Meadow spawn a Mutant
Boar (300 HP, 30 ATK, 5 DEF, melee, other stats 0). Only one pending boss is spawned
at a time. Defeating it awards 40 gold and 1 EXP, resets the
counter, and rolls a new target. Losing or leaving preserves progress. Forest kills
do not advance it. Group rewards count each defeated monster, even on a team loss,
and are paid once per battle. Character/account reset clears boss progress.

Forest has an independent saved 25–30-kill cycle in `forest_defeats` and
`forest_boss_at`. Its boss is Coco Klan Chief: 500 HP, 40 ATK, 10 DEF, ranged,
all other stats 0. Defeating the Chief awards 10 gold and 1 EXP,
then resets only the Forest cycle. Only one pending Chief may spawn at a time.
Spawn and battle responses include `forestProgress` alongside `meadowProgress`.
Bosses grant no direct wish currency. Their EXP can still trigger the normal
20-wish level-up reward. Battle responses include `levelsGained` and `wishEarned`.

## Commands

- `npm run dev`: restart automatically during development.
- `npm run typecheck`: check TypeScript without emitting files.
- `npm test`: run API, authentication, character, password, and session tests in a
  temporary database that is removed afterward. Requires CREATE/DROP DATABASE
  privileges. Optionally set `TEST_DATABASE_URL` for separate test credentials.
- `npm run db:generate`: regenerate Prisma Client (also runs on install/build).
- `npm run db:migrate -- --name your_change`: create/apply a development migration.
- `npm run db:deploy`: apply committed migrations without resetting data.
- `npm run db:seed`: create the development admin and import its legacy character.
- `npm run db:studio`: inspect database records.
- `npm run build`: compile to `dist/`.
- `npm start`: run the compiled API (build first).

## Structure

```text
src/
  config/         Environment and application configuration
  controllers/    HTTP request and response handling
  middlewares/    Shared request handling and error responses
  models/         API-facing types
  lib/            Prisma client and database connection
  repositories/   Prisma database queries and session store
  routes/         Endpoint definitions
  services/       Business logic
  utils/          Shared utilities
  app.ts          Express setup, without opening a port
  server.ts       Startup and graceful shutdown
tests/            API integration tests
```

Keep controllers thin, put business rules in services, and keep database access in
repositories. Prisma Client is generated in `src/generated/prisma/` and ignored by Git.
The app includes Helmet headers, an explicit CORS origin, bounded JSON bodies,
JSON 404 responses, and centralized errors that hide unexpected error details.
Use Express 5 async handlers directly; rejected promises reach the error handler.
