# Tadbeerly — Design

| | |
| --- | --- |
| Status | **Approved 2026-11-07** — every open question resolved with its default (§17) |
| Date | 2026-11-07 |
| Owner | Nadeem Zafar |
| Reference product | SolarWinds Web Help Desk (feature inspiration only) |
| Reference codebase | QDM — `\\wsl.localhost\Ubuntu\home\nadcreations\qdm` (architecture and visual design copied from here) |
| Companion | `docs/superpowers/plans/2026-11-07-tadbeerly-project-plan.md` |

> Anything marked **[call]** is a default I chose because the questions were skipped. Each one is listed again in §16 so it can be checked in one pass. Anything marked **[ask]** is open and listed in §17.

---

## 1. What Tadbeerly is

Tadbeerly is a web help desk. People raise requests ("my laptop won't boot", "I need access to the finance share"). A support team triages them, routes them to the right people, works them and resolves them against agreed response times. Supervisors can see how the desk is performing.

The feature set is selected from SolarWinds Web Help Desk (WHD). The engineering foundation and the look are taken from QDM, so Tadbeerly reads as QDM's sibling product: same stack, same design tokens, same UI kit, same security and notification machinery.

## 2. Why — the intent behind it

From the WHD page, the jobs a help desk exists to do:

1. **Nothing falls through the cracks.** Every request becomes a ticket with an owner, a status and a due time, whether it arrived by email, portal, phone, walk-in or monitoring alert.
2. **The right person gets it first time.** Tickets are sorted into team queues by rules, not by whoever happens to read the inbox.
3. **Promises are kept and visible.** SLA clocks run automatically, warn before a breach and pause when the ball is in the requester's court.
4. **History is kept.** Every person and every asset carries its service history, so the fifth ticket about the same printer is recognised as a pattern.
5. **People help themselves.** A knowledge base answers common questions before they become tickets.
6. **Supervisors can see the desk.** Volume, backlog, SLA compliance, technician performance and satisfaction are all on one screen.

**Success looks like:**
- An agent opens Tadbeerly and the sidebar badges tell them what is waiting on them without clicking anything.
- A requester gets an acknowledgement within a minute of emailing support, and every reply after that lands in the same ticket.
- A supervisor answers "are we meeting our SLAs this month?" from one page.

## 3. Goals, non-goals, anti-goals

### Goals
- Multi-channel intake: portal, email, agent-logged (phone or walk-in), and monitoring alert API.
- Team queues, ordered routing rules and optional auto-assignment.
- SLA policies on business-hours calendars with holidays, pause states, warnings and breaches.
- A clear split between **public replies** and **internal notes** that is impossible to get wrong.
- A requester portal: submit, track, reply, reopen, search the knowledge base.
- Knowledge base (public and internal), canned responses and a CSAT survey.
- Problem/incident linking (parent and child tickets) and a lightweight asset register with service history.
- Dashboards and reports with CSV export, plus scheduled report emails.
- QDM-grade security: MFA, an append-only audit trail, checked file downloads, a transactional email outbox.

### Non-goals (v1)
- A full ITIL suite: change, release and service catalog. That is WHD's "Service Desk" upsell tier.
- Automatic asset discovery or a CMDB with relationships.
- Live chat, social-media intake, SMS, telephony integration.
- Billing, invoicing or time-based charging.
- Native mobile apps. The web app must work well on a phone instead.
- Public self-serve signup and subscription billing. Organizations are onboarded by an administrator, as in QDM.
- AI triage and reply drafting. These are worth considering after v1, once there is ticket data to evaluate them on.

### Anti-goals (failure even if it "works")
- **A requester ever sees an internal note.** This is the single worst bug this product can have.
- **One organization sees another's tickets, requesters or assets.**
- **A ticket or notification is silently lost:** an email that never became a ticket, or an SLA warning that never went out.
- **An SLA clock that is wrong:** counting weekends, ignoring holidays or not pausing while waiting on the requester. If the clock can't be trusted, the reports built on it can't be trusted either.
- **Email loops:** an auto-reply ping-ponging with an out-of-office and creating hundreds of tickets.
- **Editable history.** Ticket conversations and the audit trail are records. Corrections are new entries, not edits.

## 4. Inherited from QDM — stack and engineering conventions

Copied as-is unless a row says otherwise.

| Area | Decision (from QDM) |
| --- | --- |
| Framework | Next.js 15 App Router, React 19, TypeScript, **Server Actions for all mutations** |
| Database | PostgreSQL + Drizzle ORM, SQL migrations in `drizzle/`, `db:migrate`, `db:seed` |
| Styling | Tailwind CSS v4 with `@theme` tokens in `globals.css` |
| Validation | Zod on every action input |
| Auth | Own implementation: scrypt passwords (`node:crypto`), hashed httpOnly session cookies (12h), TOTP MFA with encrypted secrets, recovery codes, password reset, invitations. No auth dependency. |
| Access | Two layers: **organization scope** (no role overrides it) and **role permissions** stored as data and cloned from templates, with a `db:sync-roles` script |
| Visibility | One query function per entity decides visibility, and every query goes through it. A record you can't see returns **404, not 403**. |
| Audit | `audit_events` is append-only: actor, organization, entity, IP, timestamp |
| Email | Transactional outbox (`email_notifications`) written in the same DB transaction as the action. Delivered by `dispatchSoon()` plus a cron drain (`FOR UPDATE SKIP LOCKED`, 5 attempts). Transports: `console` / `smtp` / `resend` / `graph`. |
| Files | `storage.ts` interface with three backends (local disk / Netlify Blobs / SharePoint). Server-generated keys and a SHA-256 checksum per file. Downloads go through a route that re-checks access, sends `nosniff` plus a sandbox CSP, and is audited. |
| Hosting | Netlify, with a scheduled function calling the cron endpoint every 5 minutes. `CRON_SECRET` fails closed. |
| Lists | `FilterBar` (plain GET form, URL is the source of truth), `ScopeTabs`, `Pagination` with the page number clamped inside the query (50 per page, 100 for audit) |
| Help | In-app guide at `/help` driven by `lib/help/content.ts` |
| Dev env | Repository on the **WSL Linux filesystem** with a user-owned Postgres cluster, per the QDM README's inotify warning **[ask: location]** |
| Scripts | `typecheck`, `build:check` (into `.next-check`, safe while dev runs), seed with demo accounts |

**Departures from QDM [call]:**
- **Vitest** for unit and integration tests. QDM tests with `tsx scripts/test*.ts`. Tadbeerly has more pure logic (SLA calendar maths, routing, email threading), and that deserves a real runner with assertions and CI output.
- A **date/time zone library** (Luxon or `date-fns-tz`, builder's pick) for business-hours maths. QDM gets by with calendar days. SLAs can't.
- **Logical CSS properties throughout** (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`) instead of left/right, so Arabic/RTL is cheap to add later **[ask: Arabic]**.

## 5. Visual design — copied from QDM

Tadbeerly uses QDM's design language unchanged: the drafting-office palette, IBM Plex, ruled title blocks and stamp badges. The token names are role-based (`brand-*`, `ink-*`), so a Tadbeerly brand colour, if one is chosen, is a one-file change **[ask: brand]**.

### 5.1 Tokens (`src/app/globals.css`, ported verbatim)
- **Brand (gold) scale** `brand-50…900`, with `500 = #c59044`. `brand-600 = #9c6b2b` carries white text at 4.61:1 and is used for the primary button, count pills and filter chips.
- **Warm neutral** `ink-50…900`. `ink-400 #998d7c` is the lightest step that clears 3:1, for placeholders and icons. Body text is `ink-900 #191410`.
- **Paper ground** `#fbf7f0`. White cards lift off it.
- **Shadows** `shadow-card`, `shadow-card-hover`, `shadow-pop`, tinted with warm near-black.
- **Radii** 3/4/6/8px ("drafting-precise, not pill-soft").
- **Type:** IBM Plex Sans (400–700) and IBM Plex Mono (400–600) via `next/font`. 13px base UI text. `field-label` utility for 10px mono uppercase labels. `doc-code` utility for references; in Tadbeerly that means ticket numbers and asset tags.
- **Tables:** `.qdm-table` → renamed `.tb-table`, keeping the striping (`ink-100` on even rows, `brand-50` on hover), frozen columns and tabular numbers.
- **Motion:** `qdm-rise`, `qdm-col`, `qdm-arc` and `qdm-fade` are renamed with a `tb-` prefix. The global `prefers-reduced-motion` rule kills both duration and delay.
- **Focus:** 2px `brand-600` outline on `:focus-visible` everywhere.

### 5.2 UI kit (`src/components/ui.tsx`, `forms.tsx`, ported)
`Button` / `LinkButton` (primary, secondary, danger, ghost), `Card` + `CardHeader` (tinted `brand-50` header), **`TitleBlock`** (page header modelled on a drawing title block: eyebrow, title, ruled field strip), `Field`, `Input`, `Textarea`, `Select`, `FormError`, `FormSuccess`, **`Badge` / `StatusBadge`** (rectangular uppercase mono stamps: success, warning in orange, danger, info in gold, neutral), `Table` / `Th` / `Td`, `EmptyState`, `CopyButton`, `RichTextEditor` and the `richText` sanitizer, `MfaCodeForm`, `RecoveryCodes`, `Pagination`, `FilterBar`, `DashboardCharts` (hand-built SVG, no chart library).

**New components, built in the same idiom:**
- `SlaStamp`: a stamp badge showing `DUE 2H 15M` (neutral), `DUE SOON` (warning), `BREACHED 40M` (danger), `MET` (success) or `PAUSED` (neutral).
- `PriorityStamp`: P1 to P4 stamps, with P1 in danger and P2 in warning.
- `ConversationEntry`: a public reply is a white card. An internal note is an amber-tinted card with an `INTERNAL` stamp and a dashed left rule, so the two can't be mistaken for each other even at a glance.
- `ReplyComposer`: tabs for "Reply to requester" and "Internal note". The internal mode tints the whole composer amber and labels the send button "Add internal note". **[call]** Default tab: Reply.
- `TicketPropertiesPanel`: the right-hand column of the ticket page.

### 5.3 Application shell (copied from QDM `(app)/layout.tsx`)
- **Sticky 88px header.** Drafting-grid ground (`#faf5ef → #f5f0ea`, 16px grid), a `brand-300` hairline and `shadow-card`. Tadbeerly lockup on the left, then a vertical gold rule, then the main nav, then the account menu on the right.
- **Main nav (agents):** Tickets · Knowledge base · Assets · Reports · Admin (permission-gated) · Help.
- **Account menu:** name, organization, email in mono, an **Available / Away** toggle (feeds auto-assignment), Security, Help, Sign out.
- **Left sidebar** (copied from `ProjectSidebar.tsx`): 240px, sticky under the header, groups with `field-label` titles, 16px stroke icons on tinted squares, and **count badges**. Action-tone badges are `brand-600`; others are `ink-200`. Below `lg` it collapses into a `<details>` disclosure, which needs no JavaScript.
- **Content width** `max-w-[105rem]` with `px-4 sm:px-6`.

### 5.4 Requester portal
Same tokens and header style but a lighter shell: no sidebar, a centred column, a big "How can we help?" search box, and cards for "Submit a request", "My requests" and popular articles.

### 5.5 Email templates (copied from QDM's Outlook-safe templates)
Cream outer ground, a white bordered card with a logo row, a heading, a one-paragraph summary, a two-column detail table (label/value), a `brand-700` button, and a footer saying "You are receiving this because…" with a link to notification settings. Table-based layout that renders correctly in Outlook. Ticket emails add:
- a `— Reply above this line —` marker
- the ticket number in the subject: `[#TKT-000123] Printer offline on 3rd floor`

## 6. People, organizations and access

### 6.1 Tenancy **[call]**
**Organization = tenant = owner of all data**, exactly as in QDM. Every table carries `organization_id`, and every query is scoped by it through a single resolver. One deployment can host many organizations. In v1 organizations are created by an admin script (`org:create`, as in QDM), so there's no public signup or billing **[ask: audience]**.

There are no "projects" in Tadbeerly. QDM's project layer collapses, and the organization is the workspace.

### 6.2 User kinds
| Kind | Who | Signs in to |
| --- | --- | --- |
| **Agent** | Support staff: technicians, team leads, admins | Agent workspace `(app)` |
| **Requester** | Anyone who raises requests (employees, or customers) | Requester portal `(portal)` |

`users.kind` is `agent | requester`. A user belongs to exactly one organization and never moves (QDM rule).

**Requesters are created** by CSV import, by admin invitation, by self-registration limited to the organization's allowed email domains, or automatically on first inbound email when the sender's domain is allowed (§8.3).

**Requester sign-in [call]:** email + password (QDM auth) **plus email magic link** as the low-friction default. Requesters raise tickets rarely, and a forgotten password shouldn't stop someone reporting a broken laptop. Microsoft Entra SSO is a likely later addition **[ask: SSO]**.

### 6.3 Agent roles (templates cloned per organization; editable; `db:sync-roles`)
| Role | Summary |
| --- | --- |
| **Administrator** (locked) | Everything, including configuration and audit |
| **Supervisor** | All ticket actions in their teams, reassignment across teams, reports, publishing KB articles, managing canned responses |
| **Agent** | View, create, reply, note, assign within team, edit, resolve; write KB drafts |
| **Read-only** | View all tickets, KB and reports; no changes (auditors, managers) |

**Permission keys (draft):** `ticket.view.team`, `ticket.view.all`, `ticket.create`, `ticket.reply`, `ticket.note`, `ticket.assign`, `ticket.edit`, `ticket.resolve`, `ticket.close`, `ticket.merge`, `ticket.link`, `ticket.export`, `kb.view.internal`, `kb.write`, `kb.publish`, `asset.view`, `asset.manage`, `report.view.team`, `report.view.all`, `admin.users`, `admin.teams`, `admin.roles`, `admin.config`, `admin.email`, `admin.audit`, `admin.apikeys`.

### 6.4 Visibility rules (one function each, all queries go through them)
- **`ticketVisibleToAgent(ctx)`:** same organization **and** (`ticket.view.all` **or** the ticket's team is one of the agent's teams **or** the agent is the assignee **or** the agent is a watcher).
- **`ticketVisibleToRequester(ctx)`:** same organization **and** (requester is the user **or** the user is CC'd on the ticket).
- **`entriesVisibleToRequester()`:** excludes internal notes and internal system events. This is enforced in the query layer, never only in the UI. A dedicated integration test asserts that no requester-facing query, page, email or API response can contain an internal note.
- Assets, KB internal articles and reports are each gated the same way.
- Anything invisible returns 404.

## 7. Ticket model

### 7.1 Fields
Number, subject, description (rich text), requester, CC watchers, **source** (`portal | email | phone | walk_in | alert | api | agent`), category and subcategory, priority, status, team, assignee, location, department, linked assets, tags, `parent_id` (problem link), `is_problem`, SLA fields (§7.4), created, updated, first-responded, resolved and closed timestamps, resolution summary, satisfaction score.

**Numbering [call]:** per-organization sequence with a row-locked allocator (pattern from QDM `documentNumberAllocator.ts`). Format `TKT-000123`, prefix configurable per organization. URLs use the number: `/tickets/TKT-000123`, resolved inside organization scope.

### 7.2 Status lifecycle
```
            ┌──────────── requester replies ────────────┐
            ▼                                           │
 new ──► open ──► pending (awaiting requester; SLA paused)
            │  ▲
            │  └── on_hold (third party / parts / vendor; pause configurable)
            ▼
        resolved ──(requester replies within 7 days)──► open
            │
            └──(auto after 7 days, or agent)──► closed  (terminal)
```
- `new` becomes `open` on assignment or on an agent's first action.
- A reply to a **closed** ticket opens a **new** ticket linked as a follow-up.
- `spam` is a close reason. It hides the ticket from views, and the ticket is never deleted. **Tickets are never deleted.**
- Status labels are fixed in v1 **[call]**. Configurable status sets add complexity to SLA and reports for little gain.

### 7.3 Conversation entries (immutable)
`ticket_entries.kind`:
- `requester_message`
- `public_reply` (agent to requester, emailed)
- `internal_note`
- `system_event`: status, assignment, priority or SLA changes, rule applied, link, merge, alert update. Each event carries `visibility: public | internal`.

Entries are never edited or deleted (QDM's mail rule). A correction is a new entry. Attachments hang off entries.

### 7.4 SLA
- **Business calendar:** time zone, working hours per weekday, and holidays (date + name). A 24×7 calendar is also available. Seed default **[call]**: Asia/Dubai, Monday–Friday 08:00–17:00 **[ask: working week]**.
- **SLA policy:** match conditions (priority, optional category or VIP requester), **first-response target**, **resolution target**, calendar, pause statuses (`pending` by default, `on_hold` optional) and warning threshold (75% by default).
- **Seed targets [call]:** P1 1h / 4h (24×7), P2 2h / 8h, P3 4h / 3 business days, P4 8h / 5 business days.
- **The clock** is pure functions: `addBusinessMinutes(start, minutes, calendar)` and `businessMinutesBetween(a, b, calendar)`. The ticket stores `businessMinutesConsumed`. On pause the clock freezes; on resume `due = addBusinessMinutes(now, target − consumed)`. Changing priority re-targets but keeps the consumed time.
- **First response is met** by the first *public reply* from an agent. Internal notes and auto-acknowledgements don't count.
- **States:** `on_track → warning → breached`, or `met`, or `paused`. Shown by `SlaStamp`.
- **Sweep:** the cron (every 5 min) raises warning and breach notifications, deduplicated so there's **one per ticket, per target, per kind**.

### 7.5 Routing and assignment
- **Teams** (WHD calls these "buckets"): members, leads, an optional inbound mailbox alias, an auto-assign mode (`none | round_robin | least_open`), and an "alert if unassigned for N minutes" setting.
- **Routing rules:** an ordered list where **the first match wins** **[call]**. Conditions are combined with AND: source, category, keywords in subject or body, requester department or location, inbound mailbox, requester VIP. Actions: set team, priority, category or assignee; add watchers; add tags. The rule that fired is written to the timeline as an internal system event, so agents can see why a ticket landed where it did.
- **Auto-assignment** skips agents marked Away.
- **Unassigned alert:** team leads are notified once per ticket when the threshold passes.
- **Escalation [call]:** on SLA breach, the assignee and team leads are notified. There's no automatic reassignment in v1.

### 7.6 Problems and incidents (parent and child)
- Any ticket can be flagged as a **problem**, and incidents are linked to it as children.
- Resolving the problem lets the agent resolve all open children in one step. A public reply template is posted to each child, and each requester is notified.
- **Merge [call, M5]:** merges a duplicate into the surviving ticket. The duplicate closes with a `merged into` event, and its entries stay readable via a link.

## 8. Modules

The release tags map to the project plan's milestones.

### 8.1 Agent workspace — M1
- **Ticket views** in the sidebar, each with a count badge: My open tickets *(action)*, Unassigned *(action)*, My teams, Due today, Overdue *(action)*, Awaiting requester, On hold, Recently resolved, All tickets (with `ticket.view.all`).
- **List page:** `FilterBar` with search across number, subject and requester, plus filters for status, priority, team, assignee, category, source, location, SLA state and date range. Paged at 50. The URL holds all state. Bulk actions: assign, change status, change priority **[call: M3]**.
- **New ticket:** an agent logs a phone call or walk-in. They pick or create the requester and choose the source.
- **Ticket page:**
  - `TitleBlock` with eyebrow `TKT-000123`, the subject as title, and fields for Status, Priority, Requester, Team / Assignee and SLA.
  - Left column: the conversation timeline and the `ReplyComposer`.
  - Right column: `TicketPropertiesPanel` (all editable fields), a requester card (contact details and their other open tickets), linked assets, linked tickets, watchers and SLA detail.

### 8.2 Requester portal — M2
Submit a request (category-driven form with KB suggestions as they type the subject), My requests (open and closed), the request page (public conversation only, reply, attach, reopen within 7 days), and KB browse and search.

### 8.3 Email-to-ticket — M2
- **Inbound transport [call]:** `INBOUND_EMAIL=graph | postmark | off`. The `graph` option reads the support mailbox with a delta query every minute through a scheduled function. It uses the same Entra app registration QDM uses for sending, so it needs the `Mail.ReadWrite` permission in addition to `Mail.Send`. Development uses a "simulate inbound email" admin screen plus fixture `.eml` files **[ask: mail provider]**.
- **Idempotent:** every raw message is stored in `inbound_emails`, which has a unique `Message-ID`. Reprocessing never duplicates a ticket.
- **Threading order:**
  1. `In-Reply-To` / `References` match an outbound `Message-ID` we recorded.
  2. Otherwise, a `[#TKT-000123]` subject tag where the sender is a participant on that ticket.
  3. Otherwise, a new ticket.
- **Quote stripping:** cut at our reply marker, then at common client patterns. The raw message is always kept.
- **Loop guard:** ignore `Auto-Submitted: auto-*`, `Precedence: bulk|list|auto_reply`, `X-Autoreply` and mail from our own sending addresses. Each sender is rate-limited (default 20/hour, after which messages go to quarantine for admin review). No acknowledgement is ever sent in reply to an automated message.
- **Unknown senders:** a per-organization policy of create requester / allowed domains only / reject with a notice.
- **Attachments:** go through the storage interface, ≤10MB each. Inline images are kept as attachments.

### 8.4 Notifications — M1, extended each milestone
These use QDM's outbox and transports unchanged. Each event has a per-user preference, except account emails.

| Event | Who is told |
| --- | --- |
| Ticket created (any channel) | Requester: acknowledgement with number and portal link |
| Ticket assigned or reassigned | New assignee (and team, if unassigned) |
| Public reply added | Requester and CC watchers |
| Requester replied | Assignee, or team leads if unassigned |
| Internal note mentions `@agent` | That agent |
| Resolved | Requester, with CSAT links (M4) |
| SLA warning, SLA breach | Assignee and team leads, once per target |
| Unassigned past threshold | Team leads, once |
| Problem resolved | Every child ticket's requester |
| Scheduled report (M6) | Its subscribers |
| Invitations, password reset, magic link | The person (always sent) |

**Nothing else sends.**

### 8.5 Knowledge base — M4
Categories and articles (rich text, `public | internal`, `draft | published`, tags, revision history), Postgres full-text search via a `tsvector` column (English first), "Was this helpful?" counters, links to articles from replies, "Create article from this ticket", and deflection suggestions in the portal.

### 8.6 Canned responses — M4
Personal, team or global responses, with placeholders such as `{{requester.first_name}}`, `{{ticket.number}}` and `{{agent.name}}`. Inserted from the composer.

### 8.7 CSAT — M4
The resolution email carries 1–5 rating links. These use a signed token, need no login and allow one response per resolution, with an optional comment. The score shows on the ticket and in reports.

### 8.8 Assets — M5
Asset types and assets: a tag (unique per organization), name, type, serial, model, manufacturer, purchase date, warranty end, status (`in_use | in_stock | in_repair | retired`), location, assigned user and notes. CSV import. A ticket can link to many assets. **The asset page shows the full service history** (its tickets) and its audit trail. There's no discovery and no CMDB relationships.

### 8.9 Dashboards and reports — M6
- **Agent dashboard:** my open tickets, due today, overdue, and my CSAT.
- **Supervisor dashboard:** QDM's `DashboardCharts` style. Tiles for Open, Unassigned, Overdue and Due today; charts for created vs resolved over 14 days, SLA compliance over 30 days, backlog by age, CSAT trend, and a by-team / by-agent table.
- **Reports:** ticket volume, backlog ageing, SLA compliance (response and resolution), first-response and resolution times, agent performance, CSAT, by category, by location, and incident frequency per asset. All filter by date range, team, agent, category and location. CSV export on every report.
- **Scheduled reports:** weekly or monthly email via outbox and cron.

### 8.10 Monitoring alert intake — M7
- `POST /api/v1/alerts` with an organization API key (stored hashed, scoped and revocable).
- **Payload:** `source`, `external_id`, `severity`, `title`, `details`, optional `asset_tag`.
- **Deduplication:** keyed on `(source, external_id)`. If an open ticket exists, the alert appends an internal system event; otherwise it creates a ticket.
- A "recovered" alert adds a note and can auto-resolve the ticket (configurable).
- Any monitoring tool that can send a webhook can feed this endpoint.

### 8.11 Administration — spread across M0 to M3
Organization settings (name, ticket prefix, time zone, allowed domains, unknown-sender policy, auto-close days, MFA requirement), agents, requesters (with CSV import), teams, roles, categories, priorities, SLA policies, business calendars and holidays, routing rules, email channels, canned responses, API keys and the audit trail.

## 9. Data model (tables)

**Ported from QDM:** `organizations`, `users`, `sessions`, `password_resets`, `mfa_recovery_codes`, `mfa_challenges`, `invitations`, `audit_events`, `email_notifications`.

**Organization configuration:** `roles`, `teams`, `team_members` (with `is_lead`), `departments`, `locations`, `categories` (self-parent), `priorities`, `business_calendars`, `calendar_hours`, `holidays`, `sla_policies`, `routing_rules`, `canned_responses`, `api_keys`, `email_channels`, `notification_preferences`.

**Tickets:** `tickets`, `ticket_number_sequences`, `ticket_entries`, `ticket_attachments`, `ticket_watchers`, `ticket_tags`, `ticket_links` (parent, related, merged, follow-up), `ticket_sla_events`, `inbound_emails`, `outbound_message_ids`, `csat_responses`, `alert_sources`.

**Knowledge base:** `kb_categories`, `kb_articles`, `kb_article_revisions`, `kb_feedback`.

**Assets:** `asset_types`, `assets`, `ticket_assets`.

Every table has `organization_id`, a UUID primary key and `created_at`. Hot-path indexes cover `(organization_id, status)`, `(organization_id, team_id, status)`, `(organization_id, assignee_id, status)`, `(organization_id, resolution_due_at)` and `(organization_id, number)` (unique).

## 10. Screens and routes

```
(auth)    /login  /login/verify  /login/magic/[token]  /reset/[token]  /invitations/[token]
(app)     /dashboard
          /tickets?view=mine|unassigned|teams|due-today|overdue|pending|on-hold|resolved|all
          /tickets/new   /tickets/[number]
          /kb   /kb/new   /kb/[slug]   /kb/[slug]/edit
          /assets   /assets/new   /assets/[tag]
          /reports   /reports/[report]
          /admin/{organization,agents,requesters,teams,roles,categories,priorities,
                  sla,calendars,routing,email,canned,api-keys,audit}
          /security   /help   /help/[slug]
(portal)  /portal   /portal/new   /portal/requests   /portal/requests/[number]
          /portal/kb   /portal/kb/[slug]
public    /csat/[token]
api       POST /api/cron/notifications   (outbox drain, SLA sweep, unassigned alerts, auto-close, scheduled reports)
          POST /api/cron/inbound         (mailbox poll)
          POST /api/v1/alerts            (monitoring intake)
```
Attachment downloads use checked routes under `/tickets/[number]/attachments/[id]` and `/portal/requests/[number]/attachments/[id]`.

## 11. Security and audit
- Everything in QDM's MFA section applies unchanged (no replay, encrypted secrets, server-side challenges, an organization-level "require MFA" gate in the layout via the middleware pathname header). **[call]** MFA is required for Administrators by default.
- Every mutation writes an `audit_events` row. So do attachment downloads and API-key use.
- Files are never served statically, and every download re-checks visibility.
- Rich text is sanitized server-side (QDM's `richText.ts`).
- Magic links and CSAT tokens are single-purpose, expiring and hashed at rest.
- Rate limits apply to login, magic-link requests, the portal submit form, inbound email per sender and the alert API per key.

## 12. Testing strategy **[call]**
- **Unit (Vitest):** the business calendar and SLA maths (weekends, holidays, time zones, pause and resume, priority change), the routing matcher, numbering, email threading, quote stripping and the loop guard, placeholder rendering, and permission resolution.
- **Integration (Vitest + a disposable Postgres database):** the visibility rules, especially **requesters never receive internal notes** and **organizations never see each other's data**. Also outbox transactionality, inbound idempotency and SLA sweep deduplication.
- **Build gates:** `npm run typecheck`, `npm run build:check`, and the test suite on every milestone.
- **Acceptance:** each milestone ends with a scripted demo on seed data (see the project plan).

## 13. Environments
| Env | Database | Files | Email out | Email in | Cron |
| --- | --- | --- | --- | --- | --- |
| Dev (WSL) | User-owned Postgres cluster (new port, DB `tadbeerly`) | Local disk | `console` | Simulator plus fixtures | Manual `curl` |
| Preview (Netlify deploy previews) | Separate preview DB | Netlify Blobs | `console` | off | Off (Netlify runs scheduled functions on production only) |
| Production (Netlify) | Managed Postgres **[ask: hosting]** | Netlify Blobs or SharePoint | `graph` or `resend` | `graph` | Every 5 min (outbox) and every 1 min (inbound) |

## 14. Seed and demo data
A demo organization with:
- three teams: IT Service Desk, Network & Infrastructure, Facilities
- an admin, a supervisor, three agents and six requesters
- about 40 tickets across every status, including overdue, awaiting requester, a problem with three linked incidents, an email-originated thread and an alert-originated ticket
- KB articles and assets

Demo accounts share one password, as in QDM.

## 15. Left to the builder
Exact Drizzle column types and index names; quote-stripping heuristics beyond the reply marker; the choice of time zone library; icon artwork for the new sidebar items (same 16px stroke style); chart details within the QDM `DashboardCharts` idiom; copy for the help topics; and the exact wording of email templates within the QDM template structure.

## 16. Calls I made — please check these while reading
1. Multi-tenant data model; organizations onboarded by script; no public signup or billing in v1.
2. Requesters sign in with password **or** magic link.
3. Fixed status set (`new, open, pending, on_hold, resolved, closed`); auto-close after 7 days; a reply to a closed ticket opens a linked follow-up.
4. Routing rules: first match wins.
5. Ticket numbers `TKT-000123`, per organization, prefix configurable.
6. Seed SLA targets and an Asia/Dubai Monday–Friday 08:00–17:00 calendar.
7. Default composer tab is "Reply to requester", with the internal mode strongly tinted.
8. Vitest added; a time zone library added; logical CSS properties for future RTL support.
9. Gold QDM palette kept until Tadbeerly has its own brand colour.
10. MFA required for Administrators by default.
11. Inbound email through Microsoft Graph polling, with Postmark as the alternative transport.

## 17. Open questions — resolved 2026-11-07 (defaults accepted)
Every **[ask]** marker above now resolves to its default:

1. **Audience:** multi-tenant data model, organizations onboarded by script, no public signup or billing in v1.
2. **Departments:** generic teams, IT-flavoured seed data.
3. **Mail provider:** Microsoft 365 through Graph (send and inbound).
4. **Arabic:** English at launch, built RTL-ready with logical CSS properties.
5. **Requester sign-in:** password plus magic link. SSO later.
6. **Code location:** WSL `~/tadbeerly`. These docs live in that repository.
7. **Brand:** QDM gold palette with a text wordmark placeholder until a Tadbeerly logo exists.
8. **Hosting:** Netlify plus managed Postgres, as QDM.
9. **Feature cut:** v1.0 = M0–M3, as planned.
