# Tadbeerly

A help desk web app: requests, routing, SLAs and self-service.

This repository holds **milestone M0, the foundation**: organizations as
tenants, sign-in with enforced two-factor authentication for Administrators,
agent and role administration, an audit trail, transactional email and an
in-app user guide. The ticket workspace itself arrives in later milestones (see
[Not yet built](#not-yet-built)).

## The model

**Each organization is a tenant and owns its own data.** Nothing is shared
between organizations, and no role can widen what a person sees beyond their
own organization.

| Concept | Rule |
| --- | --- |
| **Organization** | The tenant. Every tenant data table carries `organization_id`; user-keyed credential tables (`sessions`, `password_resets`, `mfa_recovery_codes`, `mfa_challenges`) and `rate_limits` are scoped through their user or are global. Every service query filters on the acting user's organization. |
| **User** | Belongs to one organization, permanently, with an email address that is unique across the whole system (compared case-insensitively). |
| **Agent** | A user of kind `agent`: someone who works requests. Agents hold exactly one role and use the main application. |
| **Requester** | A user of kind `requester`: someone who raises requests. Requesters have no role and are sent to the requester portal, which is a placeholder in M0. |
| **Role** | A named set of permissions, **stored as data per organization**. See [Permissions and roles](#permissions-and-roles). |

Access is decided in two layers:

1. **Organization scope**: is this row in the actor's organization? A row in
   any other organization is **not found** (a 404, never a 403), so its
   existence is not revealed.
2. **Permission**: within the organization, does the actor's role grant the
   permission the action needs?

Services in `src/lib` take an explicit `actor` and hold the logic. Server
actions are thin: session, then Zod validation, then the service, then
revalidation.

## Permissions and roles

M0 defines four permissions, all for administration:

| Permission | Key | Lets a person |
| --- | --- | --- |
| Manage users | `admin.users` | Invite, disable and restore agents, change roles, reset passwords and two-step verification |
| Manage roles | `admin.roles` | Create roles and edit their permissions |
| Manage configuration | `admin.config` | Rename the organization and set its security policy |
| View audit trail | `admin.audit` | Read the audit trail |

When an organization is created it gets its own **copy** of the system role
templates in `src/lib/permissions.ts`: Administrator (locked, always every
permission), Supervisor, Agent and Read-only. Administrators can edit the
others and make new roles from any role, and none of that affects another
organization.

Because roles are data, adding a permission to a template does not reach
existing organizations by itself. After changing `SYSTEM_ROLE_TEMPLATES`, run:

```bash
npm run db:sync-roles
```

It is additive and touches system roles only, so an organization's
customisations survive.

An organization must keep **at least one active Administrator**: disabling,
demoting or withdrawing the last one is refused.

Delegating *Manage users* or *Manage roles* never lets someone become an
Administrator:

- **The Administrator role is protected.** Only someone who holds it can grant
  it (by changing a role or inviting), or change the role of, disable, enable,
  reset the password or two-step verification of, or resend or withdraw the
  invitation of someone who holds it.
- **Role editors can't escalate.** Nobody can change the permissions of their
  own role, and someone who is not an Administrator can't grant a permission
  they don't hold, whether by ticking it or by copying a role that has it.

Both rules are enforced in the services, reading the actor's role from the
database inside the transaction, and the admin pages only offer what is allowed.

## The audit trail

Every mutation calls `recordAudit` (`src/lib/audit.ts`), which appends a row to
`audit_events` with the action, a summary, the actor, the entity and the
caller's IP. Writing an audit event never rolls back the action it describes,
but a failed write is logged loudly. Administrators with *View audit trail* read
it at **Admin, then Audit trail**, filtered by action, person and date range,
100 entries per page. Entries cannot be edited or removed through the app.

The IP comes from the first `x-forwarded-for` entry. **The hosting platform's
proxy must set that header** (Netlify does). Behind a proxy that does not, the
IP column stays blank.

## Two-factor authentication

Authentication is by email and password (scrypt) with 12-hour sessions kept as
hashed, httpOnly cookies. On top of that:

- **Administrators must use two-factor authentication.** Anyone holding the
  locked Administrator role who has not enrolled can reach only the **Security**
  page until they do.
- An organization can also **require it for everyone** (Admin, then Settings).
  An Administrator needs it on their own account before they can switch the
  policy on.
- Codes are TOTP, from any authenticator app. Ten one-use recovery codes are
  issued at enrolment, and an administrator can reset someone's enrolment.
- TOTP secrets are encrypted at rest with `MFA_ENCRYPTION_KEY` (falling back to
  `SESSION_SECRET`).

Sign-in is rate limited: 10 failures per email per 15 minutes, and 5
forgot-password requests per email per hour.

## Email notifications

Notifications are written to a **transactional outbox** (`email_notifications`)
in the same transaction as the action that caused them. That means a
notification is never lost because the mail server was down, and none is sent
for an action that rolled back. The table doubles as the record of what went to
whom.

Delivery is at-least-once. Rows are claimed with `FOR UPDATE SKIP LOCKED` under
a five-minute lease and their attempt counter is incremented before sending.
A failed send waits before its next attempt: 1 minute after the first failure,
then 5, 15 and 60 minutes (`RETRY_BACKOFF_MINUTES` in `src/lib/email/outbox.ts`).
After five failed attempts a row is marked `failed` and left alone. A drain stops
early when a whole batch sends nothing, so an outage does not spend everyone's
attempts at once.

Two things drain the outbox:

1. **Immediately after an action commits** (`dispatchSoon()`), best-effort. It
   only shortens the wait, so its failures are logged and swallowed.
2. **`POST /api/cron/notifications`**, which catches whatever that missed:

   ```bash
   curl -X POST -H "x-cron-secret: $CRON_SECRET" https://host/api/cron/notifications
   ```

   It **fails closed**: with no `CRON_SECRET` set the endpoint is off.

On Netlify nothing needs pointing at it:
`netlify/functions/notifications.ts` is a scheduled function that calls the
endpoint **every five minutes** and reads the same `CRON_SECRET`. Netlify runs
scheduled functions on production deploys only, so a preview never sends
anybody's mail.

> **The second drain is not optional in a deployment.** The first is
> best-effort by design, and on a serverless platform that frequently means the
> function is frozen mid-send. Without `CRON_SECRET`, a message that fails once
> is never retried and sits `pending` forever.

### What gets sent (M0)

| Event (`kind`) | Who is told |
| --- | --- |
| `user_invitation` | The invited person, with a link to choose a password (valid 30 days) |
| `invitation_accepted` | The agent who sent the invitation |
| `password_reset` | The person who asked for a reset (valid 60 minutes) |

Nothing else sends. An administrator-issued reset link (valid 24 hours) is
shown on screen once for the administrator to hand over; it is not emailed.
Everything else that happens, such as role changes and disabling people, is in
the audit trail and sends no mail. This list is the whole of it; later
milestones add ticket events.

### Transports

`EMAIL_TRANSPORT` picks the backend. Which one runs is an environment decision,
not a code decision.

| Value | Behaviour |
| --- | --- |
| `console` (default) | Prints the message instead of sending it, so nothing escapes a development machine by accident |
| `smtp` | Any SMTP server, via nodemailer |
| `resend` | Resend's HTTP API |
| `graph` | Microsoft 365 through Graph, from a real mailbox |

**Do not use `smtp` on a serverless host.** The handshake has to finish inside
the function's lifetime, and Microsoft 365 now refuses basic-auth SMTP
tenant-wide. `resend` needs `RESEND_API_KEY` and an `EMAIL_FROM` on a domain
verified with them. `graph` needs the `Mail.Send` **application** permission on
the Entra app registration, which is tenant-wide unless restricted with an
[Application Access Policy](https://learn.microsoft.com/graph/auth-limit-mailbox-access);
`npm run email:graph-check` reads the grant out of the token and says whether
it is there. Every variable is documented in `.env.example`.

## Storage

File storage sits behind a narrow interface (`src/lib/storage.ts`). M0 stores
no files yet; the backends are in place for later milestones. `STORAGE_BACKEND`
chooses one explicitly:

| Value | Used for |
| --- | --- |
| `local` | Development and self-hosting. Files go under `STORAGE_ROOT` (default `./storage`). |
| `netlify-blobs` | Anything on Netlify, where the filesystem is ephemeral. Chosen automatically there when unset. |
| `sharepoint` | Keeping bytes in an organization's own SharePoint library, via an Entra app with `Sites.Selected`. Never inferred: it must be asked for. |

## Stack

- Next.js 15 (App Router, Server Actions), React 19 and TypeScript
- PostgreSQL 16 and Drizzle ORM
- Tailwind CSS v4, using logical utilities only (`ms-`, `pe-`, `text-start`
  and so on), enforced by a test
- Sessions via hashed httpOnly cookies; passwords via `node:crypto` scrypt
- Vitest against a real Postgres database

## Getting started

### 1. Database

Development uses a Postgres cluster **owned by your own user** on port
**5435**, so nothing needs `sudo` and nothing outside your home directory is
touched. `scripts/pg.sh` manages it:

```bash
bash scripts/pg.sh start     # also: stop, status
```

<details>
<summary>Creating the cluster from scratch</summary>

```bash
PGROOT=~/.local/share/tadbeerly
mkdir -p "$PGROOT" && printf 'tadbeerly_dev' > "$PGROOT/pwfile" && chmod 600 "$PGROOT/pwfile"
/usr/lib/postgresql/16/bin/initdb -D "$PGROOT/pgdata" -U "$USER" \
  --auth-local=trust --auth-host=scram-sha-256 --pwfile="$PGROOT/pwfile" \
  --encoding=UTF8 --locale=C.UTF-8
rm "$PGROOT/pwfile"
# start it (above), then:
psql -w -h 127.0.0.1 -p 5435 -U "$USER" -d postgres \
  -c "CREATE DATABASE tadbeerly;" -c "CREATE DATABASE tadbeerly_test;"
```
</details>

### 2. Environment

```bash
cp .env.example .env.local
```

Make `DATABASE_URL` and `TEST_DATABASE_URL` match your role, and set a real
`SESSION_SECRET` (`openssl rand -hex 32`). Everything else has a safe
development default; `.env.example` explains each variable.

### 3. Install, migrate, seed, run

```bash
npm install
npm run db:migrate
npm run db:seed        # demo data, see below
npm run dev            # http://localhost:3000
```

**`db:seed` empties every table.** It refuses to run unless the host in
`DATABASE_URL` is `localhost` or `127.0.0.1`, and there is no override. (`[::1]`, socket-style and multi-host URLs are refused too, so use `127.0.0.1`.) It
leaves the email outbox empty, so seeding never sends mail.

## Demo accounts

Every active account uses the password **`Password123!`**.

| Organization | Email | Role |
| --- | --- | --- |
| Meridian Group | `alice@meridian.example` | Administrator |
| Meridian Group | `carol@meridian.example` | Supervisor |
| Meridian Group | `dan@meridian.example` | Agent |
| Meridian Group | `erin@meridian.example` | Agent |
| Meridian Group | `frank@meridian.example` | Read-only |
| Meridian Group | `gina@meridian.example` | Agent, **invited** (not yet accepted) |
| Kestrel Services | `bob@kestrel.example` | Administrator |

The seed prints Gina's invitation URL so you can walk through activation.
Seeded Administrators are **not enrolled** in two-factor authentication, so
their first sign-in sends them to Security to set it up.

Signing in as Alice and then Bob shows the tenancy rule at work: each sees only
their own organization's people, roles and audit trail.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run build:check` | Build into `.next-check`, so it can run beside a dev server |
| `npm test` | The Vitest suite (needs the test database) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Reset and fill the dev database with demo data |
| `npm run db:sync-roles` | Grant newly added system permissions to existing organizations |
| `npm run db:studio` | Drizzle Studio |
| `npm run org:create` | Create an organization and its first Administrator (operators only, not reachable over HTTP) |
| `npm run email:verify` | Check SMTP settings |
| `npm run email:graph-check` | Check the Graph `Mail.Send` grant |
| `npm run email:test` | Send a test email through the configured transport |

New organizations are created by operators with `org:create`; there is no
public sign-up.

## Layout

```
src/
  app/
    (auth)/          sign-in, forgot password, reset, MFA verify
    (app)/           the signed-in application behind the MFA gate
      admin/         agents, roles, organization settings, audit trail
      help/          the in-app user guide
      security/      two-factor enrolment and recovery codes
      tickets/       placeholder until the next milestone
    invitations/     accepting an invitation
    portal/          requester portal placeholder
    api/cron/        outbox drain endpoint
  components/        UI primitives and form helpers
  db/                schema, migrate, seed, syncRoles
  lib/               services (agents, roles, organizations, invitations, ...),
                     authz, session, mfa, audit, email/, help/content.ts
  lib/actions/       thin server actions over the services
netlify/functions/   the five-minute scheduled outbox drain
scripts/             pg.sh and operator commands
drizzle/             generated SQL migrations
tests/               unit and integration tests, with shared setup
docs/superpowers/    design spec and plans
```

## Not yet built

The ticket workspace (requests, routing, SLAs), the knowledge base and the
requester portal are planned and not built. The milestone plan is in
[`docs/superpowers/plans/2026-11-07-tadbeerly-project-plan.md`](docs/superpowers/plans/2026-11-07-tadbeerly-project-plan.md).
Passkeys, SMS codes and trusted devices are not available either.

## Deployment

Target: Netlify, with the Netlify DB (Neon) extension. Next.js is auto-detected,
so there is no `netlify.toml`.

Production URL: _to be filled in after the first deploy_

### Database

Enable the Netlify DB extension on the site. It sets `NETLIFY_DATABASE_URL`;
the app falls back to it when `DATABASE_URL` is not set, and `DATABASE_URL` wins
when both are. Deploy previews must use a separate database (a Netlify DB
branch, or a second database set as the deploy-preview context's
`DATABASE_URL`), never production.

Each function instance holds **one** database connection, and a long-running
server holds ten. The app detects a serverless function at runtime (Netlify sets
`NETLIFY` only while building, so it also checks the variables present while a
function runs), and logs the pool size it chose once, on the first query. Set
`DB_POOL_MAX` (a whole number, at least 1) to override the detection.

### Environment variables

| Variable | Value |
| --- | --- |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `MFA_ENCRYPTION_KEY` | `openssl rand -hex 32` (separate from the session secret). Set it **before the first enrolment** and keep it: see below. |
| `CRON_SECRET` | `openssl rand -hex 32`. Production context only: leave it **unset** in deploy previews. |
| `APP_URL` | The site's public URL, used for links in emails |
| `EMAIL_TRANSPORT` | `console` until Graph is configured (emails then appear in the function logs; see below) |
| `EMAIL_FROM`, `EMAIL_FROM_NAME` | Sender address and display name |
| `GRAPH_MAIL_SENDER` | Only if the mailbox Graph sends from differs from `EMAIL_FROM` |
| `STORAGE_BACKEND` | Leave unset: Netlify Blobs is detected on Netlify |
| `DB_POOL_MAX` | Leave unset: one connection per function is detected on Netlify |

> **`EMAIL_TRANSPORT=console` in production is for acceptance testing only.**
> Password-reset and invitation emails never reach anyone, and the function
> logs then contain live reset and invitation links that work for whoever reads
> them. Switch to a real transport before real people use the site.

> **Set `MFA_ENCRYPTION_KEY` once, before anyone enrols, and never rotate it
> casually.** TOTP secrets are encrypted, and recovery codes keyed, with it (or
> with `SESSION_SECRET` while it is unset). Changing it, adding it after starting
> on the `SESSION_SECRET` fallback, or rotating `SESSION_SECRET` while it is
> unset makes every TOTP secret and recovery code unreadable and locks out every
> enrolled user.

### Release steps

1. Migrate production: `DATABASE_URL="<production connection string>" npm run db:migrate`
2. Create the first organization: `DATABASE_URL="<production connection string>" npm run org:create`
3. **Never run `db:seed` in production.** It refuses non-local hosts anyway.

### Platform notes

- The scheduled function `netlify/functions/notifications.ts` (`*/5 * * * *`)
  runs on production deploys only, so previews and branch deploys never send
  mail. It POSTs to `/api/cron/notifications` with an `x-cron-secret` header.
  Without `CRON_SECRET` it logs a warning and returns 200 "CRON_SECRET not set"
  without calling the endpoint.
- Audit IP addresses come from `x-forwarded-for`, which Netlify's proxy sets.
- The build fetches IBM Plex from Google Fonts. A transient failure there is
  cleared by redeploying.
- Moving email off `console`: set `EMAIL_TRANSPORT=graph`, with `EMAIL_FROM` a
  real mailbox (or `GRAPH_MAIL_SENDER` naming the mailbox to send from, when it
  differs), and the `GRAPH_*` credentials (they fall back to the
  `SHAREPOINT_*` ones). The Entra app registration needs the Microsoft Graph
  `Mail.Send` application permission with admin consent, ideally restricted by
  an Application Access Policy. Check it with `npm run email:graph-check`.

### M0 acceptance

Run on the deployed site:

- [ ] Sign in as an Administrator
- [ ] Forced two-step enrolment completes
- [ ] Sign out, then sign back in with an authenticator code
- [ ] Invite an agent (under the console transport the email is in the function logs)
- [ ] Accept the invitation and land on the empty Tickets screen with the full shell
- [ ] The audit trail shows every step above
- [ ] The scheduled function's log shows the endpoint's JSON response with status 200 from `/api/cron/notifications` (not the "CRON_SECRET not set" message)

Outcome: _to be recorded (date, URL, result)_
