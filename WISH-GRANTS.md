# Admin wish currency module

Open Dashboard → hamburger menu → Wish currency. Accounts now manages donation tiers only. The Wish currency module has two tabs:

- **By username / account:** search by username, account ID, account name, or character name and send 1–1,000,000 wish currency to one account.
- **By donation tier:** select the exact tier (0–3), enter an amount per account, preview the recipient count and sample usernames, and send to that tier. A tier is not cumulative: tier 2 does not include tiers 1 or 3. Admin accounts are included if their donation tier matches.

Tier preview is `GET /api/admin/wish-currency/tiers/:tier/preview`. Tier grants use `POST /api/admin/wish-currency/tiers` with `{ tier, amount, recipientsHash }` and a UUIDv4 `Idempotency-Key`. Recipient membership is hashed by the server and checked again under ordered account row locks. Changed membership requires a fresh preview. A grant supports up to 10,000 accounts. If any recipient would overflow its balance, no balances change.

Every batch and each recipient's before/after balance are recorded in PostgreSQL in the same transaction. Retries with the same key and payload return the original result without adding currency again, even if tier membership later changes. A different payload with an already used key is rejected. Single-account and tier grants share request-key locking. All routes remain behind session authentication, a fresh database admin-role check, write-origin validation and admin rate limiting. Database snapshot export/import/verification includes the new batch records.
