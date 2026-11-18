# Gold and account-level grants

Dashboard sidebar has separate **Gold** and **Account levels** modules. Each supports username/account search and exact donation-tier grants, using the same preview and idempotent retry behavior as wish grants. All endpoints are mounted behind admin authentication, a fresh database role check, allowed-origin validation and rate limiting.

Routes under `/api/admin/account-grants`:

- `GET /:kind/tiers/:tier/preview`
- `POST /:kind/accounts/:id` with `{ amount }`
- `POST /:kind/tiers` with `{ tier, amount, recipientsHash }`

`kind` is `gold` or `levels`. Writes require a UUIDv4 `Idempotency-Key`. Keys are checked across gold, levels and wish grants. Gold grants allow 1–1,000,000 per account. Level grants add 1–27 levels and cannot take any account above level 28, the current maximum supported by the existing 32-bit XP column and doubling XP curve. They preserve raw XP progress within the current level and award normal level-up wish currency (100 per level). Level rewards do not bypass quest or boss requirements or change combat balance definitions.

Tier grants target accounts in the exact selected tier, including matching admin accounts. Membership is checked against the preview hash under ordered user row locks. Up to 10,000 recipients are supported. Gold, XP and wish limits are validated for every recipient before any changes are committed. If one recipient fails, the whole grant is rejected. Grants and per-account before/after snapshots are stored atomically. Duplicate submissions return the recorded result. Database export/import/verification includes both new audit tables.
