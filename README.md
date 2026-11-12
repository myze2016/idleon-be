# IdleOn API

## Development login

Start this API and the frontend with `npm.cmd run dev` in separate terminals.
Open http://localhost:3020/login and sign in with `admin` / `Admin123!`.
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

The API runs at http://localhost:8020. Check `GET /api/health`.
The frontend origin defaults to http://localhost:3020; configure it with `CORS_ORIGIN`.
Environment variables are validated at startup. Never commit `.env`.

## Database

Fish Emperor Lord (the Royal Palace boss, internal ID `fishpeople-lord`) has a
10% chance per defeat to drop a Deep Sea Artifact. This drop-only equipment grants
+5 Magic and +5 Defense in the character's normal artifact slot. Additional copies
can drop on later victories. Enhancement costs 1,000 gold and adds +2 Magic and
+2 Defense per level. Loot is saved with battle rewards, so
replaying a battle never creates another artifact. Battle responses include
`artifactsEarned` for drop notices, and the enemy wiki lists the drop.

The Wish screen has independent Normal (100 currency) and Special (200 currency)
pools. `POST /api/character/wish/special` selects equally among unowned Kent
(`glaive`), Juan (`ice-staff`), and Jeffrey (`dual-axe`). A starter is required.
Costs and awards are atomic, duplicate characters are excluded, and a completed
pool refuses further spending. Specials cannot be chosen as starter weapons or
awarded by normal wishes. Their base stats are in `models/character-stats.ts`.

Kent's basic attacks hit up to two enemies. Bouncing Glaive costs 20 MP, deals
20 + ATK before defense, and can bounce four times after its first hit, stopping
when no different living target remains; cooldown is 3 seconds. Juan's Freeze
costs 20 MP and has a 1-second cooldown; Freeze All costs 40 MP with a 5-second
cooldown. Both deal 20 + Magic before special defense and stun for two seconds.
Jeffrey adds a bleed stack on each unblocked basic hit, dealing 5 HP per second
per stack until the target dies or battle ends. Axe Frenzy costs 50 MP and grants
40 Speed for three seconds, with a 5-second cooldown. Active skills use the normal
one-second cast time modified by Speed. Skill 2 unlocks cost 1,000 gold per
character. Upgrades cost 1,000 gold: Kent/Jeffrey gain 5 ATK and Juan gains 5 Magic.

The Wiki button in the room and expeditions opens the enemy bestiary. Signed-in
players can read `GET /api/wiki/enemies` for every enemy's current stats, locations,
gold/EXP rewards, basic attack timing, and skill damage, mana, cooldowns, durations,
and effects. The catalog is generated from the same definitions as combat, including
Harbor day/night variants and DeepSea Moot bosses. Search and location/boss filters
are available in the wiki. Opening it during an expedition pauses battle playback.

During battle, each living player character regenerates 5 MP every second, capped
at effective maximum MP. Regeneration continues while casting, respects normal
skill cooldowns, and does not apply to enemies or fallen allies. Battle snapshots
include regeneration ticks so MP bars and saved expedition vitals stay in sync.

Artifacts can be enhanced repeatedly from the Artifacts panel for 1,000 gold per
level. Each level adds +2 to that artifact's main stat, starting from the base +5
bonus (levels 1/2 give +7/+9). `POST /api/character/artifacts/:id/enhance` checks
ownership and deducts gold atomically. Enhancements persist when unequipped,
follow the artifact when equipped elsewhere, and affect stats and battle timing.

Owning the Deepsea Moth Map permanently unlocks DeepSea Moot
on the world map, connected to Harbor by a sea route. `GET /api/character`
derives `deepSeaMothUnlocked` from the saved quest item, including existing owners.

DeepSea Moot has three playable floors: `deepsea`, `deepsea-2f`, and
`deepsea-palace`. Each has its own 30–40-defeat boss cycle and spawns 1–2 enemies
per wave. Defeat Fishpeople Guardian to unlock 2F, then Fishpeople Researcher to
unlock the Royal Palace. Floor unlocks survive room returns and roster resets;
returning clears only expedition defeat counters. All floors require the map.
The floor selector is reached through the DeepSea Moot marker; select a floor,
then press Start in the room. Waves use the normal 1–15 second spawn timing.

| Floor | Regular enemies / gold | Boss / gold |
| --- | --- | --- |
| DeepSea Moot | Guard, Archer, Rider / 100 each | Guardian / 400 |
| 2F | Rider / 100, Baracudon and Cleric / 150 each | Researcher / 600 |
| Royal Palace | Knight, Rifler, Baron / 250 each | Lord / 1,000 |

Each defeat grants 1 EXP. These use the explicitly specified new rewards.
Guard Mode adds 10 DEF for two seconds. Guardian's shield heals 5 HP per direct
hit for five seconds, without reviving a slain enemy. Clerics heal injured
fishpeople allies by up to 50 HP, without healing Baracudon. Water Snipe hits the
last living team member for 50 magic damage before special defense. Other shots
use physical defense. Lord summons a Knight for 25 MP every 10 seconds while
affordable; summoned Knights join the saved battle and grant normal Knight rewards
once. Enemy mana does not regenerate. Skills replace that action's basic attack
and use a one-second action interval when no cooldown was specified.

Defeating Demon Prince permanently unlocks Garnaland and stops the yellow spectator
from appearing for that account. The unlock survives room returns, relogins, and
roster resets. `GET /api/character` includes `garnalandUnlocked`; the world map
opens Garnaland as a coming-soon placeholder with no encounters. Existing saved
Demon Prince victories are honored by the unlock migration.

Tourney stands contain spectators that scroll together as the team walks. Each new
set of spectators rolls a server-side 10% chance for the yellow spectator. Ordinary
monster waves keep that result; `POST /api/encounters/spectators/next` advances the
crowd group once and preserves its roll on retries. Clicking the yellow person
requires owning Zugwangs Evidence. They blend into the ordinary crowd with only
a bright yellow head; the evidence unlocks a matching invisible interaction target.
The server checks ownership too, and summoning does not consume the evidence. This
calls `POST /api/encounters/spectator` and summons Demon Prince once for the current
team. A pending boss prevents summoning. Leaving, changing teams, or resetting the
roster clears the spectator. Demon Prince has 1,000 HP and 100 MP, awards 1 EXP and
200 gold, and does not advance or reset Zugwang's boss cycle. Burn All costs 40 MP
and deals 20 magic damage before special defense to each living ally, replacing
basic attacks while affordable at his normal one-second interval.

Defeating Fishpeople Guide rolls a 50% chance to obtain the Deepsea Moth Map.
Defeating Zugwang independently rolls a 50% chance for Zugwangs Evidence, also
limited to one per account. Inspect it in Quest Items to open its paper drawing.
Quest items appear in Inventory → Quest Items and have a maximum quantity of one
per account. The `quest_items` table enforces unique account/item pairs. Obtained
items persist through room returns, login changes, and roster resets; a previously
obtained map never rolls again. Loot is saved atomically with battle rewards and
replayed battles cannot award another copy. `GET /api/character` includes
`questItems`, and battle results include `questItemsEarned` for drop notifications.

Zugwangs Battle Tourney spawns 1–2 Gladiators, Spearmen, or Assassins every
1–15 seconds. Each awards 1 EXP and 30 gold. Its independent boss counter
summons Zugwang after 50–70 regular defeats. Zugwang awards 1 EXP and 200 gold.
Slash All replaces his basic attack while he can afford 40 mana, hitting each
living ally for 20 physical damage before defense. It uses his normal attack
interval (one second at zero Speed); with 100 MP he can use it twice.
Returning to the room or resetting the roster clears Tourney boss progress.

Harbor uses Asia/Manila server time: day is 00:00–11:59 and night is
12:00–23:59. Each spawn creates 1–3 monsters; the expedition requests waves
every 1–15 seconds. Day monsters are Crab, Hermit, and Starfish; night monsters
are Crab, Fishpeople Spearman, Hunter, and Magos. Each defeat awards 1 EXP.
The Fishpeople Guide boss appears after 38–45 regular defeats, with its own
progress counter, and awards 200 gold. Returning to the room resets progress.
Hermit blocks 30% of direct attacks. Bubble Beam deals its listed damage minus
special defense (minimum 1), costs mana, and has a one-second cooldown; monsters
resume basic attacks when they cannot afford it. Apply `npm run db:deploy`
and regenerate Prisma with `npm run db:generate` after updating.

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
and `wishCurrency`. Starter creation grants 100 currency in the same transaction.
`POST /api/character/wish` spends 100 currency and awards a random one of the 11
weapon types not already owned, with equal chances among the remaining types.
The starter counts as owned. User row locking prevents concurrent wishes from
awarding the same type. Once all 11 are owned, wishes return 409 without spending
currency. Existing characters are preserved; no migration or deduplication is needed.
It returns the updated state plus `reward`. The backend chooses the result using
`crypto.randomInt`; an atomic conditional debit prevents overspending. The wish
route requires authentication and the configured frontend Origin. Character reset
deletes the whole roster and clears the balance; creating a new starter grants 100.
The wish migration preserves existing starters and grants their first currency.

Base stats for all 11 weapon types are defined in `src/models/character-stats.ts`.
Roster entries and wish rewards include these server-controlled `stats`. Stats are
derived from weapon type for both existing and new characters; no migration is
needed when adjusting the base catalog. Client-submitted stats are ignored.

Enemies are defined in `src/models/enemy.ts`: Forest contains Coco Klan Warrior
and Slinger; Meadow contains Boar, Slime, and Plant. Regular monsters use the configured base
stats and award 20 gold when defeated. `POST /api/encounters` accepts `location`
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
current-level EXP, and the next-level requirement. Each level gained grants 100 wish
currency in the reward transaction, including multiple levels gained in one battle.
Duplicate reward requests cannot award EXP or level wishes twice. Existing total
EXP is retained and interpreted using the new curve; prior levels are not retroactively
paid. Wishes and team changes preserve progression; Delete account
resets it along with gold and the roster. EXP begins at 0 when this migration runs.

`POST /api/character/:id/skill-2/unlock` unlocks Skill 2 for an owned character for
1,000 account gold. Ownership, balance, payment, and the saved per-character flag
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
random target of 38–45 regular Meadow defeats makes the next Meadow spawn a Mutant
Boar (300 HP, 30 ATK, 5 DEF, melee, other stats 0). Only one pending boss is spawned
at a time. Defeating it awards 80 gold and 1 EXP, resets the
counter, and rolls a new target. Returning to the room, including after defeat, resets both location counters and boss targets through POST /api/encounters/return and clears old encounters. Forest kills
do not advance it. Group rewards count each defeated monster, even on a team loss,
and are paid once per battle. Character/account reset clears boss progress.

Forest has an independent saved 38–45-kill cycle in `forest_defeats` and
`forest_boss_at`. Its boss is Coco Klan Chief: 500 HP, 40 ATK, 10 DEF, ranged,
all other stats 0. Defeating the Chief awards 20 gold and 1 EXP,
then resets only the Forest cycle. Only one pending Chief may spawn at a time.
Spawn and battle responses include `forestProgress` alongside `meadowProgress`.
Bosses grant no direct wish currency. Their EXP can still trigger the normal
100-wish level-up reward. Battle responses include `levelsGained` and `wishEarned`.

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

Encounter creation accepts wave: true to spawn exactly 1 regular monster in Meadow or 1–2 with equal probability in Forest in one transaction; additionalEnemies contains the remaining wave members. A due boss always spawns alone. Boss targets now range from 38–45 kills; the latest migration halves existing 75–90 targets, rounding up.

Team formation is saved in users.team_slots as six ordered character IDs or nulls. POST /api/character/team accepts slot (0–5) and characterId, validates ownership, and atomically moves the character from its previous slot. GET /api/character includes teamSlots. New starters begin in Front 1. Logout and room return preserve the formation; roster deletion clears it.

Artifacts: seven shop types each give +5 to one numeric stat (HP, MP, ATK, DEF, Magic, Magic DEF, Speed) for 500 gold. POST /api/character/artifacts/buy accepts stat; POST /api/character/:id/artifact accepts artifactId or null to unequip. Each purchased copy belongs to one account and can occupy one character's single artifact slot. Purchases and equipment use account row locks. GET /api/character returns artifacts, equipped artifactId, baseStats, effective stats, and adjusted action timing. Combat and fresh-expedition vitals use effective stats. Equipping mid-expedition does not restore HP or MP; combat bonuses apply to newly resolved battles. Roster reset deletes artifacts.

Character upgrades: POST /api/character/:id/upgrade spends 1,000 gold for each permanent, repeatable upgrade. Rifle/Great Sword/Axe/Spear gain +5 ATK, Book gains +10 MP, Staff gains +5 Magic, and Dual Gun/Bow/Dual Knife (Assassin) gain +5 Speed per level. Sword and Shield gains +10 HP per level. Wand upgrades are unavailable until its bonus is defined. Character state includes upgradeLevel and upgrade metadata. Effective combat stats and action timing include upgrades plus artifact bonuses. Transactions validate ownership and serialize gold spending.

Active damaging skills add 100% of the caster's current relevant stat: Long Shot, Slash, Throw Spear, Charge, Heavy Blow, and Berserker Blow add ATK; Fireball and Inferno add Magic. Calculation uses upgrades, equipped artifacts, and active buffs when the cast finishes, subtracts the target's corresponding defense, then applies critical damage. Skill definitions expose base damage and scaling stat and describe the formula. Passives, poison, healing, stuns, and buffs have no additional scaling. Book, Bow, and Dual Gun currently have no active damaging skill to scale.
