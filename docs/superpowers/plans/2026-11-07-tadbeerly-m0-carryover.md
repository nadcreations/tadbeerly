# Tadbeerly M0 — decisions and carry-over

Written at the end of M0 (2026-11-07). It records the decisions taken during the build that depart from, or add to, the M0 plan, and the backlog M1 should pick up first.

## Decisions that differ from the plan

| Area | Decision | Why |
| --- | --- | --- |
| MFA gate | Enforced in `requireAgent()` and `requirePermission()` (unconditionally for actions), not only in the `(app)` layout | Next.js does not re-render a shared layout on client navigation, so a layout-only gate is one click from bypassed |
| MFA hardening | Per-user `mfa:<userId>` limiter (10 failures / 15 min); atomic attempt reservation; compare-and-set replay protection; HMAC-keyed recovery codes; disabling MFA needs password + code; Administrators cannot disable MFA | The plan's per-challenge cap allowed unlimited guesses across fresh challenges |
| Enrolment codes | Recovery codes stay on screen until "I have saved these codes" | QDM's revalidate discarded them |
| Login / forgot password | Failed-login audit and the forgot-password work run inside `after()`; a dummy scrypt hash for unknown emails | Response timing must not reveal which emails have accounts |
| Outbox | Lease-based dispatcher (`claimed_until`, migration 0001), per-row fenced writes, retry backoff 1/5/15/60 min, one 20 s drain deadline | QDM's claim double-sent under concurrency; a one-transaction fix rolled back whole batches |
| Email HTML | Exempt from the logical-CSS guard | Outlook ignores logical properties |
| Privilege escalation | Only Administrators can grant the Administrator role or act on Administrators; role editors cannot edit their own role or grant permissions they lack | Delegating `admin.users` / `admin.roles` must not make someone an Administrator |
| Invitation tokens | Stored as SHA-256 (migration 0002 hashes old rows) | A database read must not yield working activation links |
| Pool size | `isServerlessRuntime()` + `DB_POOL_MAX`; `NETLIFY` alone is a build-time flag | QDM's `NETLIFY`-keyed pool size never applied at runtime |
| Credential tables | `password_resets`, `mfa_recovery_codes`, `mfa_challenges` are scoped through `users`, no `organization_id` | User-keyed and read only by token hash or the session's own user |
| Seed / truncate | Refuse any database whose host is not exactly `localhost` / `127.0.0.1` | Both wipe every table |
| Security headers | `X-Frame-Options: DENY`, `frame-ancestors 'none'` (except `/download` and `/preview` routes, whose own sandbox CSP must survive), `Referrer-Policy`, `nosniff` | Admin row actions are one-click forms |
| Rate limiting | Login counts failures only (10 / 15 min per email), cleared on success; forgot-password 5 / hour per email | Plan values, with "clear on success" added |

## Parked (known, deliberately not fixed in M0)

- **Escalation by role assignment.** A non-Administrator holding `admin.users` can assign an *existing* non-Administrator role whose permissions exceed their own. Only possible after an Administrator has created such a custom role; the default templates expose nobody. **Fix in M1:** non-Administrators may only assign roles whose permissions are a subset of their own.

## M1 backlog (do first)

1. The parked escalation fix above.
2. Consolidate duplicated helpers: `hashToken` (session, mfa, passwordReset), Postgres unique-violation detectors (three different semantics), the UUID regex (three copies), `x-forwarded-for` parsing (only `audit.ts` validates), the `APP_URL` base (templates, tokens), and the repeated gate check in `(app)/layout.tsx`.
3. Housekeeping in the cron route: purge expired sessions, `mfa_challenges` and old `rate_limits` rows.
4. `ALL_PERMISSIONS` readonly; tests that the Administrator template equals `ALL_PERMISSIONS` and `isLocked`; `syncRoles` tests (non-system roles untouched, second run returns 0) — before M1 adds ticket permission keys.
5. Operator `mfa:reset` script (today, a last Administrator who loses their factor needs SQL).
6. `.gitattributes` with `* text=auto eol=lf` and a renormalise (some files are CRLF).
7. Role select: confirm before promoting to or demoting from Administrator.
8. `Content-Disposition` with `filename*=UTF-8''…` when the first stored-file route lands; probe the CSP exemption (case-insensitive match, encoded paths) at the same time.
9. Prefer `x-nf-client-connection-ip` on Netlify for the audit IP; add a forged `X-Forwarded-For` check to acceptance.

## Smaller follow-ups

- Outbox: guard the give-back write; check affected rows on fenced writes; the drain deadline is checked only before each send.
- Rate limits are fixed-window (about 2x at a boundary); the peek-then-hit pattern is soft under parallel bursts.
- Password resets: concurrent issues can leave two live links (partial unique index); "superseded" and "used" share `used_at`; consume doesn't check organization status.
- `setOrganizationMfaPolicy` is read-then-update (concurrent toggles can audit twice).
- `actorRole` reads the actor's role without a lock (tiny demotion race).
- `org:create`: the argument parser accepts a flag as a value; `--password` lands in shell history.
- Storage: tests for absolute and multi-level `folder`; `serveStoredFile` `inline: true`; `STORE_NAME` read at import; the 410 catch-all hides non-ENOENT errors.
- Tests: bare `toThrow()` in the schema role-key test; `globalSetup` guard uses `includes`; `audit.test` `rowsOf` has no `orderBy`; the outbox write-failure test should `drop constraint if exists` first; middleware untested; RoleSelect revert untested.
- Self-host IBM Plex (the build fetches Google Fonts).
- `src/db/migrate.ts` prints a Postgres NOTICE (no `onnotice`).
- Cosmetic: QDM comments in `.env.example` and `globals.css`; the `seed.ts` header comment; withdraw-guard message ordering.
- Time zones: audit day filters are UTC until organizations get a time zone (M3).
