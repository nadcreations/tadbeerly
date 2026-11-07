# Tadbeerly M0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An empty but real Tadbeerly. An administrator can sign in with MFA, invite agents, manage roles and organization settings, read the audit trail, and the app deploys to Netlify. No ticket features yet.

**Architecture:** A Next.js 15 App Router app ported from QDM, with QDM's project layer removed. The organization is the tenant. Agents hold one organization-level role whose permissions are stored as data, cloned from templates. Server Actions are thin wrappers: session → Zod → a service function in `src/lib` that takes an explicit `actor` → revalidate. The service functions hold the logic and are what the tests exercise.

**Tech Stack:** Next.js 15, React 19, TypeScript, PostgreSQL 16 + Drizzle ORM, Tailwind CSS v4, Zod, nodemailer / Resend / Microsoft Graph, Netlify (+ Netlify DB, Netlify Blobs), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-07-tadbeerly-design.md`. Milestone scope comes from `docs/superpowers/plans/2026-11-07-tadbeerly-project-plan.md` §M0.

**QDM source (port from here):** `~/qdm` in WSL (`\\wsl.localhost\Ubuntu\home\nadcreations\qdm`). "Port X" means: copy the QDM file, apply the listed changes, and drop anything that refers to projects, documents, transmittals, mail or workflows.

**Where commands run:** inside WSL, from `~/tadbeerly`, using the nvm Node 24 interactive shell (`wsl -d Ubuntu`, then `cd ~/tadbeerly`).

**Change from the project plan:** `RichTextEditor` and `richText.ts` move to M1, where their first consumer (ticket replies) is. M0 has no rich text.

## Global Constraints

- The repository lives at WSL `~/tadbeerly`. Never run the dev server from `/mnt/*`.
- Dependency ranges are the same as QDM's `package.json`: `next ^15.1.3`, `react ^19.0.0`, `drizzle-orm ^0.36.4`, `drizzle-kit ^0.28.1`, `postgres ^3.4.5`, `zod ^3.24.1`, `tailwindcss ^4.0.0`, `@tailwindcss/postcss ^4.0.0`, `nodemailer ^9.0.3`, `@netlify/blobs ^10.7.12`, `qrcode ^1.5.4`, `tsx ^4.19.2`, `typescript ^5.7.2`. Add `vitest` as a devDependency.
- Every table except `sessions` and `rate_limits` carries `organization_id`. Every service query filters on `actor.organizationId`. An ID from another organization raises `NotFoundError` (rendered as a 404, never a 403).
- Emails are normalised with `normaliseEmail(s) = s.trim().toLowerCase()` on every write **and** every lookup.
- Every mutation calls `recordAudit`.
- Tailwind logical utilities only: `ms- me- ps- pe- start- end- text-start text-end border-s border-e rounded-s rounded-e`. Never `ml- mr- pl- pr- left- right- text-left text-right border-l border-r rounded-l rounded-r`.
- Design tokens are copied verbatim from QDM `src/app/globals.css`. Class and keyframe prefixes `qdm-` become `tb-`.
- Product copy: name "Tadbeerly". Metadata title `Tadbeerly — Help Desk`. Description `Help desk ticketing: requests, routing, SLAs and self-service.` Text wordmark "Tadbeerly" until a logo exists.
- Names: session cookie `tb_session` (12h TTL), MFA challenge cookie `tb_mfa`, pathname header `x-tb-pathname`, SQL debug env var `TB_SQL_DEBUG=1`, globals `__tbClient` / `__tbDb`.
- TTLs: invitation 30 days; admin-issued password reset 24 hours; self-service password reset 60 minutes; MFA challenge as in QDM.
- Rate limits: login 10 failures per email per 15 minutes; forgot-password 5 requests per email per hour.
- Page sizes: lists 50, audit 100, with the page number clamped inside the query (QDM rule).
- Dev database: a user-owned cluster at `~/.local/share/tadbeerly/pgdata`, port **5435**, databases `tadbeerly` and `tadbeerly_test`.

## Review Focus

1. **Last active Administrator.** Disabling, demoting or withdrawing the organization's only active Administrator is refused with "An organization must keep at least one active Administrator." Test in Task 12.
2. **Foreign IDs in actions.** A `userId` or `roleId` from another organization raises `NotFoundError` and changes nothing. Tests in Tasks 12 and 13.
3. **Email variants.** `" Alice@Meridian.example "` matches `alice@meridian.example` for login, the invite duplicate check and forgot-password. Tests in Tasks 9, 11 and 12.
4. **Live sessions after disable or suspension.** Disabling a user or suspending their organization ends access on the very next request, and disabling also deletes their sessions. Tests in Tasks 5 and 12.
5. **HTML injection in email.** A first name of `<img src=x onerror=alert(1)>` arrives escaped in `bodyHtml`. Test in Task 7.

---

### Task 1: Repository, toolchain and dev database

**Files:**
- Create: `package.json`, `tsconfig.json` (copy QDM), `next.config.ts`, `postcss.config.mjs` (copy QDM), `.gitignore` (copy QDM, plus `storage/`), `.env.example`, `.env.local` (git-ignored), `drizzle.config.ts` (copy QDM), `vitest.config.ts`, `scripts/pg.sh`, `src/lib/env.ts` (port), `README.md` (stub: title, one-paragraph description, Getting started), `tests/setup/env.ts`
- Test: `tests/unit/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(): void`, `requireEnv(name: string): string` (throws an Error whose message contains `name`). Also npm scripts `dev`, `build`, `build:check` (`NEXT_DIST_DIR=.next-check next build`), `start`, `typecheck`, `test` (`vitest run`), `db:generate`, `db:migrate`, `db:seed`, `db:sync-roles`, `db:studio`, `org:create`, `email:verify`, `email:graph-check`, `email:test`.

- [ ] **Step 1: Initialise the repository.** Run `git init`, add the docs already in `docs/`, and write `package.json` with the Global Constraints ranges plus `vitest`. Run `npm install`. Expected: `added N packages`, no errors.
- [ ] **Step 2: Copy configs.** `next.config.ts` is QDM's without `serverExternalPackages`. `drizzle.config.ts` and `tsconfig.json` are copied verbatim.
- [ ] **Step 3: Write `scripts/pg.sh`.** Port QDM's script with `PGROOT="$HOME/.local/share/tadbeerly"` and port `5435`. Create the cluster once using QDM README's "Recreating the cluster" block (adjusted for the new root and port), then create both databases:
  ```bash
  psql -h 127.0.0.1 -p 5435 -d postgres -c "CREATE DATABASE tadbeerly;" -c "CREATE DATABASE tadbeerly_test;"
  ```
  Expected: `CREATE DATABASE` twice. `bash scripts/pg.sh status` reports the server running.
- [ ] **Step 4: Write `.env.example` and `.env.local`.** Use QDM's `.env.example` structure with `DATABASE_URL=postgresql://nadcreations:tadbeerly_dev@127.0.0.1:5435/tadbeerly`, add `TEST_DATABASE_URL=…/tadbeerly_test`, and set `EMAIL_FROM_NAME="Tadbeerly"`. Keep the SESSION_SECRET, MFA_ENCRYPTION_KEY, APP_URL, storage, email and CRON_SECRET sections and their comments.
- [ ] **Step 5: Write `vitest.config.ts`.** Alias `@` → `./src`, `environment: "node"`, `setupFiles: ["tests/setup/env.ts"]`, `fileParallelism: false` (the suite shares one test database). `tests/setup/env.ts` calls `loadEnv()` and sets `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL`.
- [ ] **Step 6: Write the failing test.**
  ```ts
  test("requireEnv names the missing variable", () => {
    delete process.env.TB_NOT_SET;
    expect(() => requireEnv("TB_NOT_SET")).toThrow(/TB_NOT_SET/);
  });
  ```
- [ ] **Step 7: Run `npm test`.** Expected: FAIL, cannot resolve `@/lib/env`.
- [ ] **Step 8: Port `src/lib/env.ts`.** Copy it unchanged.
- [ ] **Step 9: Verify.** Run `npm test && npm run typecheck`. Expected: 1 passed, and tsc exits 0.
- [ ] **Step 10: Commit.** `git add -A && git commit -m "chore: scaffold Tadbeerly repository, dev database and test runner"`

---

### Task 2: Design tokens, fonts and UI kit

**Files:**
- Create: `src/app/globals.css` (port), `src/app/layout.tsx` (port), `src/components/ui.tsx`, `src/components/forms.tsx`, `src/components/CopyButton.tsx`, `src/components/Pagination.tsx`, `src/components/FilterBar.tsx` (all ports)
- Test: `tests/unit/logical-properties.test.ts`

**Interfaces:**
- Produces, as in QDM:
  - from `ui.tsx`: `Button`, `LinkButton`, `Card`, `CardHeader`, `TitleBlock`, `TitleBlockField`, `DocCode`, `Field`, `Input`, `Textarea`, `Select`, `FormError`, `FormSuccess`, `Badge`, `StatusBadge`, `Table`, `Th`, `Td`, `tableHeadClass`, `EmptyState`
  - from `forms.tsx`: `ActionForm`, `FieldError`, `SubmitButton`, `ActionButton`
  - also `CopyButton`, `Pagination`, `parsePage(raw?: string): number`, `FilterBar`, `FilterDefinition`, `ScopeTabs`
  - utilities `field-label`, `doc-code`, `tb-table`, `tb-freeze`, `tb-freeze-edge`, `tb-tight`, `tb-rise`, `tb-col`, `tb-arc`, `tb-fade`, `tb-prose`

- [ ] **Step 1: Write the test.** It scans every `src/**/*.{ts,tsx,css}` file for physical-direction utilities.
  ```ts
  const PHYSICAL = /(?<![\w-])(?:-?(?:ml|mr|pl|pr)-|(?:left|right)-|text-(?:left|right)\b|border-(?:l|r)\b|border-(?:l|r)-|rounded-(?:l|r|tl|tr|bl|br)\b|rounded-(?:l|r|tl|tr|bl|br)-)/;
  test("UI uses logical direction utilities only", () => {
    const offenders = files("src").filter((f) => PHYSICAL.test(read(f)));
    expect(offenders).toEqual([]);
  });
  ```
  The `files` and `read` helpers live in the test file and use `node:fs`. Inline `style={{ left: … }}` objects are not matched; avoid them anyway.
- [ ] **Step 2: Port the files verbatim.** Copy QDM's `globals.css`, `layout.tsx`, `ui.tsx`, `forms.tsx`, `CopyButton.tsx`, `Pagination.tsx` and `FilterBar.tsx` unchanged.
- [ ] **Step 3: Run `npm test`.** Expected: FAIL, listing the ported files that still use physical utilities.
- [ ] **Step 4: Adapt `globals.css`.** Rename `.qdm-table` → `.tb-table`, `.qdm-freeze*` → `.tb-freeze*`, `.qdm-tight` → `.tb-tight`, `qdm-rise|col|arc|fade` → `tb-*` (keyframes and classes), and `.qdm-prose` → `.tb-prose`. Delete `--color-qantara*`, the `--sheet-*` variables, `.theme-sheet-dark` and `.paper-grain`. These belong to QDM's landing art and Qantara's identity. Convert `padding-left` in `.tb-prose ul/ol` and `border-left` in `blockquote` to `padding-inline-start` and `border-inline-start`.
- [ ] **Step 5: Adapt `layout.tsx` and the components.** `layout.tsx` keeps IBM Plex Sans and Mono exactly as in QDM, uses the Global Constraints metadata, and sets `<html lang="en" dir="ltr">`. In `ui.tsx` and `Table`, replace `qdm-table` with `tb-table`. Convert every physical utility to its logical twin (for example `sm:border-l` → `sm:border-s`, `ml-auto` → `ms-auto`, `text-left` → `text-start`, `right-0` → `end-0`).
- [ ] **Step 6: Run `npm test && npm run typecheck`.** Expected: PASS, tsc 0.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat: port QDM design tokens and UI kit with logical properties"`

---

### Task 3: Schema, database client and test database

**Files:**
- Create: `src/db/schema.ts`, `src/db/index.ts` (port), `src/db/migrate.ts` (port), `drizzle/0000_*.sql` (generated), `tests/setup/globalSetup.ts`, `tests/setup/db.ts`, `tests/setup/factories.ts`
- Modify: `vitest.config.ts` (add `globalSetup`)
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces:
  - `db` and `type Executor = Pick<typeof db, "insert" | "select" | "update" | "delete" | "execute">` from `@/db`
  - tables `organizations`, `roles`, `users`, `invitations`, `sessions`, `passwordResets`, `mfaRecoveryCodes`, `mfaChallenges`, `auditEvents`, `emailNotifications`, `rateLimits`
  - enums `organizationStatus(active, suspended)`, `userStatus(invited, active, disabled)`, `userKind(agent, requester)`, `invitationStatus(pending, accepted, revoked, expired)`, `notificationKind(user_invitation, invitation_accepted, password_reset)`, `notificationStatus(pending, sent, failed, skipped)`
  - test helpers in `tests/setup/factories.ts`: `resetDb(): Promise<void>` (truncates every table, `RESTART IDENTITY CASCADE`), `makeOrg(name?)`, `orgByName(name)`, `userById(id)`, `count(table)`. Task 4 Step 4 adds `makeAgent(orgId, roleKey, overrides?)`, `makeRequester(orgId, overrides?)` and `roleOf(orgId, key)`, which need the role templates. Task 12 adds `adminFixture()`, `actorOf(user)` and `notifications()`.

Column decisions (everything not listed is the same as QDM's table of the same name):
- `organizations`: QDM's columns **minus** the address, registration, trading-name, phone and website fields. Keep `id, name, status, requireMfa, createdAt, updatedAt` and the unique index on `lower(name)`.
- `roles` (replaces `project_roles`): `organizationId` not null, `key`, `name`, `description`, `permissions jsonb string[]`, `isSystem`, `isLocked boolean default false`, `createdAt`. Unique on `(organizationId, key)`.
- `users`: QDM's columns **minus** `isOrgAdmin` and the four `emailOn*` columns, **plus** `kind userKind not null` and `roleId uuid → roles.id`. Check constraint `users_agent_has_role`: `kind <> 'agent' OR role_id IS NOT NULL`.
- `invitations`: `organizationId` not null, `userId → users.id` not null, `email`, `roleId`, `token` (unique), `status`, `expiresAt`, `createdByUserId`, `createdAt`, `respondedAt`. No project, organization-invite or participant columns.
- `audit_events`: QDM's columns with `projectId` removed, and `actorOrganizationId` replaced by `organizationId uuid not null`. Index on `(organizationId, occurredAt)`.
- `email_notifications`: QDM's columns with `projectId` removed, and `recipientOrganizationId` replaced by `organizationId uuid not null`.
- `rate_limits`: `key text primary key`, `windowStart timestamptz not null`, `count integer not null`.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  beforeEach(resetDb);
  test("an agent must have a role", async () => {
    const org = await makeOrg();
    await expect(db.insert(users).values({ organizationId: org.id, email: "a@x.example", firstName: "A", lastName: "B", kind: "agent" }))
      .rejects.toThrow(/users_agent_has_role/);
  });
  test("emails are unique regardless of case", async () => {
    const org = await makeOrg();
    await db.insert(users).values({ organizationId: org.id, email: "r@x.example", firstName: "R", lastName: "S", kind: "requester" });
    await expect(db.insert(users).values({ organizationId: org.id, email: "R@X.example", firstName: "R", lastName: "S", kind: "requester" }))
      .rejects.toThrow(/users_email_lower_idx/);
  });
  test("role keys are unique per organization, not globally", async () => {
    const [a, b] = [await makeOrg("A"), await makeOrg("B")];
    // "custom_x" rather than a template key: once Task 4 makes makeOrg clone the templates, "agent" already exists.
    await db.insert(roles).values([{ organizationId: a.id, key: "custom_x", name: "X" }, { organizationId: b.id, key: "custom_x", name: "X" }]);
    await expect(db.insert(roles).values({ organizationId: a.id, key: "custom_x", name: "Again" })).rejects.toThrow();
  });
  ```
- [ ] **Step 2: Run `npm test`.** Expected: FAIL, `@/db` does not resolve.
- [ ] **Step 3: Write the schema and client.** Write `schema.ts` per the column decisions, keeping QDM's doc comments where the table survives. Port `db/index.ts` with the renamed globals and `TB_SQL_DEBUG`, keeping the `NETLIFY_DATABASE_URL` fallback. Export `Executor`. Port `migrate.ts` unchanged.
- [ ] **Step 4: Generate and apply migrations.** Run `npm run db:generate` (expected: `drizzle/0000_*.sql` created), then `npm run db:migrate` against the dev database.
- [ ] **Step 5: Write the test setup.** `tests/setup/globalSetup.ts` runs Drizzle's `migrate()` against `TEST_DATABASE_URL` once per run. Add it to `vitest.config.ts`. Write `resetDb` and `makeOrg`.
- [ ] **Step 6: Run `npm test`.** Expected: 3 new tests pass.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat: organization-scoped schema, db client and test database"`

---

### Task 4: Permissions, roles and organization creation

**Files:**
- Create: `src/lib/permissions.ts`, `src/lib/organizations.ts`, `src/lib/format.ts` (port), `src/lib/password.ts` (port), `src/lib/tokens.ts` (port), `src/lib/errors.ts`, `src/db/syncRoles.ts`, `scripts/createOrganization.ts`
- Modify: `tests/setup/factories.ts` (add `makeAgent` and `makeRequester`)
- Test: `tests/integration/organizations.test.ts`, `tests/unit/password.test.ts`

**Interfaces:**
- Produces:
  - `PERMISSIONS = { ADMIN_USERS: "admin.users", ADMIN_ROLES: "admin.roles", ADMIN_CONFIG: "admin.config", ADMIN_AUDIT: "admin.audit" } as const`, `type Permission`, `ALL_PERMISSIONS`, `PERMISSION_GROUPS: { label: string; permissions: { key: Permission; label: string; description: string }[] }[]`, `hasPermission(granted, p)`
  - `SYSTEM_ROLE_TEMPLATES`: `administrator` (name "Administrator", `isLocked: true`, all permissions), `supervisor` ([]), `agent` ([]), `read_only` ("Read-only", []). M1 adds ticket keys and runs `db:sync-roles`.
  - `hashPassword(plain): Promise<string>`, `verifyPassword(plain, hash): Promise<boolean>` (QDM scrypt)
  - `normaliseEmail(s: string): string`, plus QDM's `formatDate`, `formatDateTime`, `fullName` and `initials` (all in `format.ts`)
  - `class NotFoundError`, `class AuthorizationError`, `class ConflictError` (each `extends Error` with a user-facing message) in `errors.ts`
  - `createOrganizationWithAdmin(input: { name: string; admin: { email: string; firstName: string; lastName: string; password?: string } }): Promise<{ organizationId: string; adminUserId: string; invitationUrl: string | null }>`. Creates the organization, clones every template as that organization's roles (`isSystem: true`), and creates the admin with the `administrator` role. The admin is `active` with a password, or `invited` with an invitation when no password is given. All in one transaction.
  - `generateInvitationToken()`, `invitationExpiry()` and `invitationUrl(token)` (QDM `tokens.ts`; the URL path is `/invitations/[token]`)

- [ ] **Step 1: Write the failing tests.**
  ```ts
  test("scrypt round-trip", async () => {
    const h = await hashPassword("Password123!");
    expect(await verifyPassword("Password123!", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  test("each organization gets its own copy of every template", async () => {
    const a = await createOrganizationWithAdmin({ name: "Meridian", admin: { email: " Alice@Meridian.example ", firstName: "Alice", lastName: "Ng", password: "Password123!" } });
    const b = await createOrganizationWithAdmin({ name: "Kestrel", admin: { email: "bob@kestrel.example", firstName: "Bob", lastName: "Li", password: "Password123!" } });
    expect((await rolesOf(a.organizationId)).map((r) => r.key).sort()).toEqual(["administrator", "agent", "read_only", "supervisor"]);
    await db.update(roles).set({ permissions: [] }).where(and(eq(roles.organizationId, a.organizationId), eq(roles.key, "administrator")));
    expect((await roleOf(b.organizationId, "administrator")).permissions).toEqual([...ALL_PERMISSIONS]);
    expect((await userById(a.adminUserId)).email).toBe("alice@meridian.example");
  });
  test("admin without password is invited", async () => {
    const r = await createOrganizationWithAdmin({ name: "Northbank", admin: { email: "n@nb.example", firstName: "N", lastName: "B" } });
    expect(r.invitationUrl).toMatch(/\/invitations\//);
    expect((await userById(r.adminUserId)).status).toBe("invited");
  });
  test("syncRoles grants missing keys and keeps custom ones", async () => { /* strip a key from an administrator role, add "custom.x", run syncRoles(), expect the stripped key restored and "custom.x" still present */ });
  ```
  `rolesOf` is a local helper in this test file. `roleOf` and `userById` come from `tests/setup/factories.ts`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL on the missing modules.
- [ ] **Step 3: Implement.** Write `permissions.ts`, port `password.ts`, `tokens.ts` and `format.ts` (adding `normaliseEmail`), write `errors.ts`, and write `organizations.ts` (adapted from QDM `createOrganization.ts`). `syncRoles.ts` exports `syncRoles(): Promise<{ updated: number }>` and runs it when executed directly, mirroring QDM's additive behaviour across organizations instead of projects. `scripts/createOrganization.ts` takes `--name --email --first --last [--password]` and prints the invitation URL when one is created.
- [ ] **Step 4: Add the factories.** In `tests/setup/factories.ts`:
  - `makeOrg` now clones the role templates.
  - `makeAgent(orgId, roleKey = "agent", overrides?)` creates an active agent with that organization's role and the password `Password123!`.
  - `makeRequester` creates a requester.
  - `roleOf(orgId, key)` returns the role row.
- [ ] **Step 5: Run `npm test`.** Expected: all pass.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat: permission templates, organization creation and role sync"`

---

### Task 5: Sessions and authorization

**Files:**
- Create: `src/lib/session.ts` (port), `src/lib/authz.ts`, `src/middleware.ts` (port), `tests/setup/nextMocks.ts`
- Test: `tests/integration/session.test.ts`, `tests/integration/authz.test.ts`

**Interfaces:**
- Consumes: `hasPermission` and `Permission` (Task 4), `db` (Task 3)
- Produces:
  - `SESSION_COOKIE = "tb_session"`, `createSession(userId)`, `destroySession()`, `getCurrentUser(): Promise<SessionUser | null>` (React `cache`), `revokeUserSessions(userId)`, `purgeExpiredSessions()`
  - `type SessionUser = { id: string; email: string; firstName: string; lastName: string; jobTitle: string | null; kind: "agent" | "requester"; organizationId: string; organizationName: string; role: { id: string; key: string; name: string; isLocked: boolean } | null; permissions: Permission[]; mfaEnabled: boolean; organizationRequiresMfa: boolean }`
  - `type Actor = Pick<SessionUser, "id" | "organizationId" | "permissions">`
  - `requireUser()` (redirects to `/login`), `requireAgent()` (a requester is redirected to `/portal`), `requirePermission(p: Permission): Promise<SessionUser>` (throws `AuthorizationError`), `can(user: Pick<SessionUser, "permissions">, p): boolean`, `assertCan(actor: Actor, p): void` (throws `AuthorizationError`; used by services), `homeFor(user): "/tickets" | "/portal"`
  - `tests/setup/nextMocks.ts`: `vi.mock("next/headers")` backed by an in-memory cookie jar, with `setCookie(name, value)` and `clearCookies()`. Redirects are asserted with `await expect(p).rejects.toThrow(/NEXT_REDIRECT/)`.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  test("session resolves the agent with role permissions", async () => {
    const org = await makeOrg(); const u = await makeAgent(org.id, "administrator");
    await createSession(u.id);
    const me = await getCurrentUser();
    expect(me?.kind).toBe("agent");
    expect(me?.permissions).toContain("admin.users");
  });
  test.each(["disabled user", "suspended organization", "expired session"])("no session for %s", async (c) => {
    /* create session, then: set users.status='disabled' | organizations.status='suspended' | sessions.expiresAt=past */
    expect(await getCurrentUser()).toBeNull();
  });
  test("requireAgent sends requesters to the portal", async () => {
    const org = await makeOrg(); const r = await makeRequester(org.id); await createSession(r.id);
    await expect(requireAgent()).rejects.toThrow(/NEXT_REDIRECT;.*\/portal/);
  });
  test("requirePermission refuses an agent without the key", async () => {
    const org = await makeOrg(); const u = await makeAgent(org.id, "agent"); await createSession(u.id);
    await expect(requirePermission("admin.users")).rejects.toBeInstanceOf(AuthorizationError);
  });
  ```
  React `cache` memoises per request. `session.ts` therefore exports an uncached `loadCurrentUser()`, and `getCurrentUser = cache(loadCurrentUser)`. Tests call `loadCurrentUser`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Port `session.ts`. The `getCurrentUser` query left-joins `roles` and returns `role` plus `permissions` (an empty array when `role` is null). Write `authz.ts` per Interfaces. Port `middleware.ts` with the header `x-tb-pathname`, excluding `_next/static`, `_next/image`, `favicon.ico` and `api/cron`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: hashed cookie sessions and organization-scoped authorization"`

---

### Task 6: Audit trail

**Files:**
- Create: `src/lib/audit.ts` (port), `src/lib/auditQueries.ts`
- Test: `tests/integration/audit.test.ts`

**Interfaces:**
- Produces:
  - `type AuditAction = "auth.login" | "auth.login_failed" | "auth.logout" | "auth.mfa_enrolled" | "auth.mfa_disabled" | "auth.mfa_reset" | "auth.recovery_codes_regenerated" | "auth.password_reset_issued" | "auth.password_reset_requested" | "auth.password_reset_completed" | "organization.created" | "organization.updated" | "organization.mfa_policy_changed" | "agent.invited" | "agent.invitation_resent" | "agent.invitation_withdrawn" | "agent.activated" | "agent.role_changed" | "agent.disabled" | "agent.enabled" | "role.created" | "role.permissions_updated"`
  - `recordAudit(input: { action: AuditAction; summary: string; organizationId: string; actorUserId?: string | null; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }): Promise<void>`. Keeps QDM's never-throws behaviour and its IP capture.
  - `listAuditEvents(organizationId: string, filters: { action?: string; actorUserId?: string; from?: Date; to?: Date }, page: number): Promise<{ rows: AuditRow[]; total: number; page: number; pageSize: 100 }>`. Clamps `page` to `[1, lastPage]`.
  - `auditActionLabel(action: string): string`

- [ ] **Step 1: Write the failing tests.**
  ```ts
  test("audit is scoped to the organization", async () => {
    const [a, b] = [await makeOrg("A"), await makeOrg("B")];
    await recordAudit({ action: "organization.updated", summary: "A", organizationId: a.id });
    await recordAudit({ action: "organization.updated", summary: "B", organizationId: b.id });
    const res = await listAuditEvents(a.id, {}, 1);
    expect(res.rows.map((r) => r.summary)).toEqual(["A"]);
  });
  test("page is clamped to the last page", async () => {
    const a = await makeOrg(); for (let i = 0; i < 145; i++) await recordAudit({ action: "organization.updated", summary: `e${i}`, organizationId: a.id });
    const res = await listAuditEvents(a.id, {}, 99);
    expect(res.page).toBe(2); expect(res.total).toBe(145); expect(res.rows).toHaveLength(45);
  });
  test("audit write failure does not throw", async () => {
    await expect(recordAudit({ action: "organization.updated", summary: "x", organizationId: "00000000-0000-0000-0000-000000000000" })).resolves.toBeUndefined();
  });
  ```
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement** per Interfaces. Newest events first.
- [ ] **Step 4: Run, and expect PASS.**
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: append-only, organization-scoped audit trail"`

---

### Task 7: Email outbox, transports, templates and cron

**Files:**
- Create (ports): `src/lib/email/templates.ts`, `src/lib/email/transport.ts`, `src/lib/email/outbox.ts`, `src/lib/graphToken.ts`, `src/app/api/cron/notifications/route.ts`, `netlify/functions/notifications.ts`, `scripts/verifySmtp.mjs`, `scripts/checkGraphMail.ts`, `scripts/sendTestEmail.ts`
- Test: `tests/integration/outbox.test.ts`, `tests/unit/templates.test.ts`, `tests/integration/cron.test.ts`

**Interfaces:**
- Produces:
  - `EmailContent = { subject; text; html }` and `compose(input: Composition): EmailContent` (QDM's `Composition`: heading, intro, facts, quote, action `{ label, path }`, reason). The header row shows the text wordmark "Tadbeerly" instead of QDM's icon. Footer link `/security` labelled "Manage your account". Outlook-safe table structure copied from QDM.
  - `userInvitationEmail({ inviterName, organizationName, firstName, url })`, `invitationAcceptedEmail({ name, organizationName })`, `passwordResetEmail({ firstName, url, expiresInLabel })`
  - `getTransport(): EmailTransport` (`console | smtp | resend | graph`, as in QDM)
  - `enqueue(exec: Executor, rows: EnqueueInput[])` with `EnqueueInput = { kind: NotificationKind; content: EmailContent; toEmail: string; toName?: string | null; organizationId: string; recipientUserId?: string | null; entityType?: string; entityId?: string }`
  - `dispatchPending(limit = 50, budgetMs = 20_000): Promise<{ sent: number; failed: number; deferred: number }>`, `dispatchSoon(): Promise<void>`
  - `recipientsByUserIds(organizationId, userIds)`. Ignores IDs outside `organizationId`.
  - `POST /api/cron/notifications`: 401 when `CRON_SECRET` is unset or doesn't match (timing-safe), otherwise `{ dispatched: { sent, failed, deferred } }` from up to 10 batches of 50. QDM's reminders call is removed; M3 adds the SLA sweep here.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  test("names are escaped in HTML", () => {
    const c = userInvitationEmail({ inviterName: "Alice", organizationName: "Meridian", firstName: "<img src=x onerror=alert(1)>", url: "http://localhost:3000/invitations/t" });
    expect(c.html).not.toContain("<img src=x");
    expect(c.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  test("a rolled-back action leaves no notification", async () => {
    const org = await makeOrg();
    await expect(db.transaction(async (tx) => { await enqueue(tx, [row(org.id)]); throw new Error("rollback"); })).rejects.toThrow("rollback");
    expect(await count(emailNotifications)).toBe(0);
  });
  test("console transport marks rows sent", async () => { /* enqueue 2; dispatchPending(); expect { sent: 2 }; both status 'sent' with sentAt */ });
  test("five failures mark a row failed", async () => { /* vi.spyOn transport.send to reject; call dispatchPending 5 times; expect status 'failed', attempts 5 */ });
  test("two dispatchers never send the same row twice", async () => {
    /* enqueue 20; counting fake transport; await Promise.all([dispatchPending(50), dispatchPending(50)]); expect total sends === 20 */
  });
  ```
  `cron.test.ts` calls the route's `POST` with a `Request`: no secret → 401, wrong secret → 401, correct secret → 200 with a `dispatched` key.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Port** templates (drop every QDM-specific email builder), transport, graphToken, outbox (drop `recipientsForOrganizations` and `organizationName`), the route, the Netlify function and the three scripts. `getTransport` must allow a test override: export `setTransportForTests(t: EmailTransport | null)`.
- [ ] **Step 4: Run, and expect PASS.**
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: transactional email outbox, transports and scheduled drain"`

---

### Task 8: File storage

**Files:**
- Create (ports): `src/lib/storage.ts`, `src/lib/sharepoint.ts`, `src/lib/fileResponse.ts`
- Test: `tests/integration/storage.test.ts`

**Interfaces:**
- Produces: `storageBackend(): "sharepoint" | "netlify-blobs" | "local"`, `putFile(data: Buffer, options: PutOptions): Promise<StoredFile>`, `getFile(key)`, `deleteFile(key)`, `fileExists(key)`, `MAX_FILE_BYTES` (10 MB), `formatBytes`, `dispositionFor`, `serveStoredFile(…)` (QDM signature: `nosniff` plus sandbox CSP). Remove `createProjectFolder`, `renameStoredFile` and `directDownloadUrl` (no M0 consumer). `PutOptions.folder` is supplied by callers; M1 uses `${organizationId}/tickets/${ticketId}`.

- [ ] **Step 1: Write the failing tests.** With `STORAGE_BACKEND=local` and `STORAGE_ROOT` set to a temp directory:
  ```ts
  test("local round trip with checksum", async () => {
    const f = await putFile(Buffer.from("hello"), { folder: "org-1/tickets/t-1", fileName: "note.txt" });
    expect(f.checksum).toBe(createHash("sha256").update("hello").digest("hex"));
    expect((await getFile(f.storageKey)).toString()).toBe("hello");
    await deleteFile(f.storageKey); expect(await fileExists(f.storageKey)).toBe(false);
  });
  test("a hostile file name cannot escape the root", async () => {
    const f = await putFile(Buffer.from("x"), { folder: "org-1/tickets/t-1", fileName: "../../../etc/passwd" });
    expect(resolve(root, f.storageKey).startsWith(root)).toBe(true);
  });
  test("explicit STORAGE_BACKEND wins", () => { process.env.STORAGE_BACKEND = "local"; process.env.NETLIFY_BLOBS_CONTEXT = "x"; expect(storageBackend()).toBe("local"); });
  ```
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Port** the three files with the removals listed under Interfaces.
- [ ] **Step 4: Run, and expect PASS.**
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: storage interface with local, Netlify Blobs and SharePoint backends"`

---

### Task 9: Sign-in, rate limiting and the application shell

**Files:**
- Create: `src/lib/rateLimit.ts`, `src/lib/auth.ts`, `src/lib/actions/types.ts` (port), `src/lib/actions/auth.ts` (port), `src/app/(auth)/layout.tsx` (port), `src/app/(auth)/login/page.tsx` (port), `src/app/(app)/layout.tsx` (port), `src/app/(app)/tickets/page.tsx`, `src/app/portal/page.tsx`, `src/app/page.tsx`, `src/components/AppNav.tsx` (port), `src/components/Sidebar.tsx` (generalised from QDM `ProjectSidebar.tsx`)
- Test: `tests/integration/auth.test.ts`, `tests/integration/rateLimit.test.ts`

**Interfaces:**
- Consumes: `createSession` and `homeFor` (Task 5), `recordAudit` (Task 6), `normaliseEmail` and `verifyPassword` (Task 4)
- Produces:
  - `hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number }>`. An atomic upsert on `rate_limits` that resets the count when the window has passed.
  - `authenticate(email: string, password: string): Promise<{ status: "ok"; user: { id; organizationId; mfaEnabled } } | { status: "invalid" } | { status: "locked" }>`. An unknown email and a wrong password both return `invalid` (same message, and the hash comparison still runs against a dummy hash). A disabled, invited or suspended-organization account returns `invalid`. The 11th failure for an email inside 15 minutes returns `locked` without checking the password.
  - Actions `login(prev, formData)` (with MFA enabled it hands off to Task 10's challenge; otherwise it creates the session, audits `auth.login` and redirects to `homeFor`) and `logout()`
  - `Sidebar({ groups: SidebarGroup[]; header?: ReactNode })` with `SidebarGroup = { label: string | null; items: SidebarItem[] }` and `SidebarItem = { href; label; icon; badge?; badgeTone? }`. QDM's `ICON_TONES` and the icon set are copied, and the project switcher is removed.
  - Shell: QDM's header (88px, drafting grid, `brand-300` hairline). The text wordmark is "Tadbeerly" at `text-[22px] font-semibold tracking-tight text-brand-800`. `AppNav` links: Tickets (`/tickets`), Admin (`/admin`, shown only with any `admin.*` permission), Help (`/help`). `/tickets` renders a `TitleBlock` titled "Tickets" and an `EmptyState` ("No tickets yet", "Ticket intake arrives in the next milestone."). `/portal` renders a minimal placeholder under the same tokens. `/` redirects to `homeFor(user)`, or to `/login` when signed out.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  test("login matches email case- and space-insensitively", async () => {
    const org = await makeOrg(); await makeAgent(org.id, "agent", { email: "alice@meridian.example" });
    expect((await authenticate(" Alice@Meridian.example ", "Password123!")).status).toBe("ok");
  });
  test("unknown email and wrong password look identical", async () => {
    const org = await makeOrg(); await makeAgent(org.id, "agent", { email: "a@m.example" });
    expect(await authenticate("nobody@m.example", "x")).toEqual({ status: "invalid" });
    expect(await authenticate("a@m.example", "x")).toEqual({ status: "invalid" });
  });
  test("disabled accounts cannot sign in", async () => { /* status 'disabled' → invalid */ });
  test("eleventh failure inside 15 minutes is locked", async () => { /* 10× wrong → invalid; 11th with the right password → locked */ });
  test("rate limit window resets", async () => { /* hitRateLimit("k", 1, 1) allowed; immediate second → not allowed; after the window → allowed (move windowStart back in the DB rather than sleeping) */ });
  ```
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.** Write `rateLimit.ts` and `auth.ts`. Port the `login` and `logout` actions onto `authenticate`. Port the `(auth)` layout and login page with QDM's sign-in panel: drafting grid, QDM tokens, wordmark text, and no Qantara artwork. Port `(app)/layout.tsx` with `requireAgent()` replacing `requireUser()` and the MFA gate left as a `// Task 10` placeholder call to `mfaGateRedirect`. Write `Sidebar.tsx` and the placeholder pages.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Manual check.** Run `npm run dev`, create an organization with `npm run org:create -- --name Meridian --email alice@meridian.example --first Alice --last Ng --password 'Password123!'`, and sign in at http://localhost:3000. Expected: you land on `/tickets` with the header, the Admin link and the empty state, and the visual style matches QDM.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat: sign-in with rate limiting and the agent application shell"`

---

### Task 10: Multi-factor authentication

**Files:**
- Create (ports): `src/lib/totp.ts`, `src/lib/mfa.ts`, `src/lib/actions/mfa.ts`, `src/app/(auth)/login/verify/page.tsx`, `src/app/(app)/security/page.tsx`, `src/components/MfaCodeForm.tsx`, `src/components/RecoveryCodes.tsx`
- Modify: `src/lib/actions/auth.ts` (create a challenge when `mfaEnabled`), `src/app/(app)/layout.tsx` (call the gate)
- Test: `tests/unit/totp.test.ts`, `tests/integration/mfa.test.ts`

**Interfaces:**
- Produces:
  - QDM's `totp.ts` exports, unchanged
  - `MFA_COOKIE = "tb_mfa"`, `MAX_ATTEMPTS = 5`, `createChallenge`, `getChallenge`, `recordFailedAttempt`, `clearChallenge`
  - Actions: `beginMfaEnrolment`, `confirmMfaEnrolment`, `disableMfa`, `regenerateRecoveryCodes`, `verifyMfaChallenge` (redirects to `homeFor` instead of `/projects`), `cancelMfaChallenge`
  - `setOrganizationMfaPolicy` and `resetUserMfa` move to Tasks 13 and 12 respectively, as service functions
  - `verifyMfaCode(userId: string, code: string): Promise<"ok" | "invalid" | "replayed">` (extracted from QDM's action so it can be tested)
  - `mfaGateRedirect(user: Pick<SessionUser, "organizationRequiresMfa" | "mfaEnabled" | "role">, pathname: string): "/security" | null`. Enrolment is required when the organization requires MFA **or** the user holds the locked Administrator role (design §11: "MFA required for Administrators by default"). `/security` and `/login*` are always let through.
  - `codeForStep(secret: string, step: number): string` is now exported from `totp.ts` for testing.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  test("RFC 6238 SHA-1 vector", () => {
    // ASCII "12345678901234567890" in base32; T=59s → step 1 → 6-digit 287082
    expect(codeForStep("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1)).toBe("287082");
  });
  test("a code cannot be used twice", async () => { /* enrol user; code for current step → "ok"; same code again → "replayed" */ });
  test("five wrong codes burn the challenge", async () => { /* createChallenge; 5× recordFailedAttempt; getChallenge → null */ });
  const agent = { id: "r", key: "agent", name: "Agent", isLocked: false };
  const admin = { id: "a", key: "administrator", name: "Administrator", isLocked: true };
  test.each([
    [{ organizationRequiresMfa: true, mfaEnabled: false, role: agent }, "/tickets", "/security"],
    [{ organizationRequiresMfa: true, mfaEnabled: false, role: agent }, "/security", null],
    [{ organizationRequiresMfa: true, mfaEnabled: true, role: agent }, "/tickets", null],
    [{ organizationRequiresMfa: false, mfaEnabled: false, role: agent }, "/admin", null],
    [{ organizationRequiresMfa: false, mfaEnabled: false, role: admin }, "/admin", "/security"],
    [{ organizationRequiresMfa: false, mfaEnabled: true, role: admin }, "/admin", null],
  ])("gate %o at %s → %s", (u, path, expected) => expect(mfaGateRedirect(u, path)).toBe(expected));
  ```
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Port and adapt** per Interfaces, and audit each MFA action with the `auth.mfa_*` keys. The security page is QDM's minus any project references.
- [ ] **Step 4: Run, and expect PASS.**
- [ ] **Step 5: Manual check.** Sign in as Alice. As an Administrator she is sent to `/security` until she enrols. Enrol with an authenticator app, sign out, and sign back in through `/login/verify`. Recovery codes appear exactly once.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat: TOTP multi-factor authentication and organization MFA gate"`

---

### Task 11: Password reset (admin-issued and self-service)

**Files:**
- Create: `src/lib/passwordReset.ts` (port and extend), `src/lib/actions/passwordReset.ts` (port and extend), `src/app/(auth)/forgot/page.tsx`, `src/app/(auth)/reset/[token]/page.tsx` (port)
- Modify: `src/app/(auth)/login/page.tsx` (add a "Forgot password?" link)
- Test: `tests/integration/passwordReset.test.ts`

**Interfaces:**
- Produces:
  - `issuePasswordReset(userId: string, issuedByUserId: string | null, ttlMinutes: number): Promise<{ url: string; expiresAt: Date }>`. Supersedes any earlier live reset for that user.
  - `requestPasswordReset(email: string): Promise<void>`. Always resolves the same way. For an active user it issues a 60-minute reset and enqueues `password_reset` in one transaction. For unknown, invited or disabled accounts it does nothing. Limited to 5 requests per email per hour. Audits `auth.password_reset_requested` only for real users.
  - `consumePasswordReset(token: string, newPassword: string): Promise<{ userId: string }>`. Single use, refuses expired tokens, sets the password, revokes all sessions, audits `auth.password_reset_completed`.
  - Constants: `ADMIN_RESET_TTL_MINUTES = 1440`, `SELF_RESET_TTL_MINUTES = 60`
  - Pages: `/forgot` always shows "If an account exists for that address, we've emailed a reset link." `/reset/[token]` is QDM's page.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  test("unknown email enqueues nothing", async () => {
    await requestPasswordReset("ghost@nowhere.example");
    expect(await count(emailNotifications)).toBe(0);
  });
  test("known email (any case) enqueues one reset email", async () => {
    const org = await makeOrg(); await makeAgent(org.id, "agent", { email: "a@m.example" });
    await requestPasswordReset(" A@M.example ");
    const [n] = await db.select().from(emailNotifications);
    expect(n.kind).toBe("password_reset"); expect(n.toEmail).toBe("a@m.example");
  });
  test("a reset works once and revokes sessions", async () => { /* issue; createSession; consume → ok; sessions count 0; consume again → throws */ });
  test("an expired reset is refused", async () => { /* issue with ttl 60; move expiresAt into the past; consume → throws */ });
  ```
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run, and expect PASS.**
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: self-service and administrator password reset"`

---

### Task 12: Agent administration and invitation acceptance

**Files:**
- Create: `src/lib/agents.ts`, `src/lib/invitations.ts` (adapted from QDM `invitationAcceptance.ts`, `userInvitationWithdrawal.ts` and `actions/invitations.ts#activateUserInvitation`), `src/lib/actions/agents.ts`, `src/lib/actions/invitations.ts`, `src/app/(app)/admin/layout.tsx`, `src/app/(app)/admin/page.tsx`, `src/app/(app)/admin/agents/page.tsx`, `src/app/invitations/[token]/page.tsx` (port, user path only), `src/components/RoleSelect.tsx` (port)
- Test: `tests/integration/agents.test.ts`, `tests/integration/invitations.test.ts`

**Interfaces:**
- Consumes: `Actor` and `assertCan` (Task 5), `enqueue` and the templates (Task 7), `issuePasswordReset` (Task 11), `revokeUserSessions` (Task 5)
- Produces (all require `admin.users` unless noted, and all audit):
  - `inviteAgent(actor: Actor, input: { email: string; firstName: string; lastName: string; jobTitle?: string; roleId: string }): Promise<{ userId: string; invitationUrl: string }>`. In one transaction it creates the user (`invited`), the invitation and a `user_invitation` email. A duplicate email in any organization raises `ConflictError("Someone with that email already has an account.")`.
  - `resendInvitation(actor, userId)`. Revokes the old token, issues a new one and re-enqueues the email.
  - `withdrawInvitation(actor, userId)`. Only for users who were never activated. Deletes the user and revokes the invitation.
  - `changeAgentRole(actor, userId, roleId)`, `setAgentStatus(actor, userId, status: "active" | "disabled")` (disabling also calls `revokeUserSessions`), `issueAdminPasswordReset(actor, userId): Promise<{ url: string }>`, `resetAgentMfa(actor, userId)` (clears the secret and recovery codes, and revokes sessions)
  - `listAgents(organizationId, filters: { q?: string; roleId?: string; status?: string }, page): Promise<{ rows; total; page; pageSize: 50 }>`
  - `loadInvitation(token): Promise<LoadedInvitation | null>` and `acceptInvitation(token: string, password: string): Promise<{ userId: string }>`. Refuses expired, revoked, accepted or withdrawn invitations. Sets the password, activates the user and enqueues `invitation_accepted` to the inviter. On success the action creates the session and redirects to `homeFor`.
  - Guard used by `changeAgentRole`, `setAgentStatus` and `withdrawInvitation`: `assertKeepsAnAdministrator(exec, organizationId, change)`. Throws `ConflictError("An organization must keep at least one active Administrator.")` when the change would leave zero active users holding the locked `administrator` role.
  - Admin area: `admin/layout.tsx` renders `Sidebar` with the groups **Organization** (Settings `/admin/organization`, Agents `/admin/agents`, Roles `/admin/roles`) and **Security** (Audit trail `/admin/audit`), each item gated by its permission. `/admin` redirects to the first visible item. The Agents page: a `TitleBlock` ("Agents"), a `FilterBar` (search, role, status), a `Table` (#, Person, Role via `RoleSelect`, Status stamp, Last sign-in, Actions), `Pagination`, and an "Invite an agent" card.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  test("invite writes user, invitation and email together", async () => {
    const { org, admin } = await adminFixture(); const role = await roleOf(org.id, "agent");
    const r = await inviteAgent(actorOf(admin), { email: " Dan@Meridian.example ", firstName: "Dan", lastName: "K", roleId: role.id });
    expect((await userById(r.userId)).status).toBe("invited");
    expect((await notifications()).map((n) => [n.kind, n.toEmail])).toEqual([["user_invitation", "dan@meridian.example"]]);
  });
  test("duplicate email in any case is refused", async () => { /* invite dan@…; invite DAN@… → ConflictError */ });
  test("role from another organization is not found", async () => {
    const { org, admin } = await adminFixture(); const other = await makeOrg("Kestrel"); const foreignRole = await roleOf(other.id, "agent");
    const dan = await makeAgent(org.id, "agent");
    await expect(changeAgentRole(actorOf(admin), dan.id, foreignRole.id)).rejects.toBeInstanceOf(NotFoundError);
  });
  test("user from another organization is not found", async () => { /* setAgentStatus on a Kestrel user → NotFoundError, status unchanged */ });
  test("the last active Administrator cannot be disabled or demoted", async () => {
    const { org, admin } = await adminFixture();
    await expect(setAgentStatus(actorOf(admin), admin.id, "disabled")).rejects.toThrow(/at least one active Administrator/);
    await expect(changeAgentRole(actorOf(admin), admin.id, (await roleOf(org.id, "agent")).id)).rejects.toThrow(/at least one active Administrator/);
  });
  test("disabling revokes sessions", async () => { /* second admin disables dan with a live session → sessions for dan = 0 */ });
  test("an agent without admin.users cannot invite", async () => { /* actor with role agent → AuthorizationError */ });
  test("accept activates once and tells the inviter", async () => { /* invite; acceptInvitation(token,"Password123!") → active; second accept → throws; notifications include invitation_accepted to the admin */ });
  test("expired and withdrawn invitations are refused", async () => { /* move expiresAt into the past → throws; withdraw → token refused */ });
  ```
  `adminFixture`, `actorOf` and `notifications` are helpers in `tests/setup/factories.ts`.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement** the services, the thin actions (each: `requirePermission` → Zod → service → `revalidatePath("/admin/agents")`, with `ConflictError`, `AuthorizationError` and `NotFoundError` mapped to `ActionState` messages), and the pages. Show the issued password-reset URL with `CopyButton`, as QDM does.
- [ ] **Step 4: Run, and expect PASS.**
- [ ] **Step 5: Manual check.** As Alice, invite `dan@meridian.example` and copy the accept link from the `npm run dev` console output. Accept it in a private window. Expected: Dan lands on `/tickets` without the Admin link, and Alice's audit trail shows the invite and the activation.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat: agent administration and invitation acceptance"`

---

### Task 13: Roles, organization settings and the audit page

**Files:**
- Create: `src/lib/rolesAdmin.ts`, `src/lib/organizationSettings.ts`, `src/lib/actions/roles.ts`, `src/lib/actions/organization.ts`, `src/app/(app)/admin/roles/page.tsx`, `src/app/(app)/admin/roles/[roleId]/page.tsx`, `src/app/(app)/admin/organization/page.tsx`, `src/app/(app)/admin/audit/page.tsx`
- Test: `tests/integration/rolesAdmin.test.ts`, `tests/integration/organizationSettings.test.ts`

**Interfaces:**
- Produces:
  - `listRoles(organizationId): Promise<(Role & { memberCount: number })[]>` and `getRole(organizationId, roleId)` (throws `NotFoundError` outside the organization)
  - `createRole(actor, { name: string; description?: string; copyFromRoleId: string }): Promise<{ roleId: string }>`. Key is `custom_${slug(name)}`, `isSystem: false`. Requires `admin.roles`.
  - `updateRolePermissions(actor, roleId, permissions: string[])`. Requires `admin.roles`. Refuses a locked role with `ConflictError("The Administrator role always has every permission.")`. Drops keys not in `ALL_PERMISSIONS` and de-duplicates.
  - `updateOrganization(actor, { name: string })` (requires `admin.config`; name trimmed, 2–120 characters, unique case-insensitive) and `setOrganizationMfaPolicy(actor, require: boolean)` (refuses enabling while the actor is unenrolled, QDM rule)
  - Pages:
    - Roles list: a table of name, description, member count and a "System" stamp.
    - Role detail: a permission matrix grouped by `PERMISSION_GROUPS`, with checkboxes that are read-only for a locked role or without `admin.roles`, plus a "Create role from this one" form.
    - Organization: name and the "Require two-factor authentication for everyone" toggle.
    - Audit: a `FilterBar` (action select from `AuditAction`, actor select, from and to dates) over `listAuditEvents`, with `Pagination`. Columns: When (mono), Who, Action label, Summary, IP (mono).

- [ ] **Step 1: Write the failing tests.**
  ```ts
  test("locked Administrator role cannot be edited", async () => {
    const { org, admin } = await adminFixture(); const adminRole = await roleOf(org.id, "administrator");
    await expect(updateRolePermissions(actorOf(admin), adminRole.id, [])).rejects.toThrow(/always has every permission/);
  });
  test("unknown permission keys are dropped", async () => {
    const { org, admin } = await adminFixture(); const sup = await roleOf(org.id, "supervisor");
    await updateRolePermissions(actorOf(admin), sup.id, ["admin.audit", "made.up", "admin.audit"]);
    expect((await roleOf(org.id, "supervisor")).permissions).toEqual(["admin.audit"]);
  });
  test("roles from another organization are not found", async () => { /* getRole(org.id, kestrelRole.id) → NotFoundError; updateRolePermissions on it → NotFoundError */ });
  test("custom role copies permissions", async () => { /* createRole copyFrom supervisor → same permissions, isSystem false, key custom_… */ });
  test("MFA policy refused while the admin is unenrolled", async () => { /* setOrganizationMfaPolicy(actor, true) → ConflictError; after enrolment → ok */ });
  test("organization rename is audited", async () => { /* updateOrganization → audit row organization.updated with metadata { from, to } */ });
  ```
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement** the services, thin actions and pages.
- [ ] **Step 4: Run, and expect PASS.**
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: role editor, organization settings and audit trail page"`

---

### Task 14: Help guide, seed data and README

**Files:**
- Create: `src/lib/help/content.ts` (QDM structure, new content), `src/components/HelpBlocks.tsx` (port), `src/app/(app)/help/page.tsx`, `src/app/(app)/help/[slug]/page.tsx` (ports), `src/db/seed.ts`
- Modify: `README.md`
- Test: `tests/unit/help.test.ts`, `tests/integration/seed.test.ts`

**Interfaces:**
- Produces:
  - `HELP_SECTIONS = ["Getting started", "Administration", "Security"]`
  - `HELP_TOPICS` (each a `HelpTopic` with `audience` set): `signing-in`, `two-factor-authentication`, `resetting-your-password`, `inviting-agents`, `roles-and-permissions`, `organization-settings`, `the-audit-trail`, `email-delivery`
  - `getTopic`, `topicsBySection`, `orderedTopics`
  - `seed(): Promise<void>`, which truncates every table and creates:
    - **Meridian Group** with `alice@meridian.example` (Administrator), `carol@meridian.example` (Supervisor), `dan@meridian.example` and `erin@meridian.example` (Agent), `frank@meridian.example` (Read-only), plus `gina@meridian.example` as a pending invitation (Agent)
    - **Kestrel Services** with `bob@kestrel.example` (Administrator)
    - every active account with password `Password123!`
    - about 20 audit events

    It prints the accounts and Gina's invitation URL.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  test("help topics are well formed", () => {
    const slugs = HELP_TOPICS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const t of HELP_TOPICS) expect(HELP_SECTIONS).toContain(t.section);
  });
  test("seed is repeatable and keeps tenants apart", async () => {
    await seed(); await seed();
    expect(await count(organizations)).toBe(2);
    const kestrel = await orgByName("Kestrel Services");
    expect((await listAgents(kestrel.id, {}, 1)).rows.map((r) => r.email)).toEqual(["bob@kestrel.example"]);
  });
  ```
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.** Write the help content so every topic names the on-screen labels exactly (QDM rule). Port `HelpBlocks` and the pages. Write `seed.ts` and the `db:seed` script. Rewrite `README.md` along QDM's outline: what Tadbeerly is, the tenancy and access model, email notifications (the M0 events table), the stack, getting started (cluster, env, migrate, seed, dev), demo accounts, scripts, layout, permissions and `db:sync-roles`, the audit trail, MFA, and "Not yet built" (pointing to the project plan).
- [ ] **Step 4: Run, and expect PASS.**
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: in-app help, demo seed and README"`

---

### Task 15: Netlify deployment and M0 acceptance

**Files:**
- Create: `netlify.toml` (only if the Netlify Next runtime needs settings beyond auto-detection, for example `[build] command = "npm run build"`)
- Modify: `README.md` (Deployment section)

- [ ] **Step 1: Run the full local gate.** `npm run typecheck && npm test && npm run build:check`. Expected: tsc 0, every test passes, and the build succeeds into `.next-check`.
- [ ] **Step 2 (needs Nadeem): create the remote.** Create a private GitHub repo (or another remote), push, and create the Netlify site from it with the Netlify DB extension enabled. Set the environment variables:
  - `SESSION_SECRET`, `MFA_ENCRYPTION_KEY` and `CRON_SECRET`, each from `openssl rand -hex 32`
  - `APP_URL`
  - `EMAIL_TRANSPORT=console` until M2 configures Graph
  - `STORAGE_BACKEND` left unset, so Netlify Blobs is detected

  Deploy previews must use a separate database (a Netlify DB branch, or a second database set as the deploy-preview context's `DATABASE_URL`). They must never point at production. `CRON_SECRET` stays unset in the preview context.
- [ ] **Step 3: Migrate production.** Run `npm run db:migrate` with `DATABASE_URL` pointed at the Netlify DB connection string, then `npm run org:create` for the real first organization. **Do not run the seed in production.**
- [ ] **Step 4: Run the project plan's M0 exit demo on the deployed site.**
  1. Sign in as the seeded admin (or the real one), enrol MFA, sign out, and sign in with a code.
  2. Invite an agent, find the email in the Netlify function logs (console transport), accept it, and land on the empty Tickets screen with the full shell.
  3. The audit trail shows every step.
  4. Check the scheduled function's log shows a 200 from `/api/cron/notifications`.
- [ ] **Step 5: Record the outcome.** Write the deploy URL and demo results into `README.md` → Deployment. Commit: `git commit -am "docs: deployment notes and M0 acceptance"`.
