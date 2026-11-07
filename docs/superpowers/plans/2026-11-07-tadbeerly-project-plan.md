# Tadbeerly — Project Plan

| | |
| --- | --- |
| Status | **Approved 2026-11-07** — all §9 questions answered "use the default" |
| Date | 2026-11-07 |
| Design | `docs/superpowers/specs/2026-11-07-tadbeerly-design.md` |
| Method | One milestone at a time. Each gets its own detailed implementation plan (task by task, test first) before any of its code is written. |

---

## 1. Feature selection from Web Help Desk

These are the WHD capabilities from the reference page, and where each one lands.

| WHD capability | Tadbeerly | Milestone |
| --- | --- | --- |
| Email requests become tickets automatically | ✅ Email-to-ticket with threading and loop guard | M2 |
| Tickets from phone, walk-in, portal | ✅ Agent-logged tickets plus requester portal | M1 / M2 |
| Tickets from social media | ❌ Non-goal | — |
| Tickets from RMM / network / server alerts | ✅ Generic alert intake API with deduplication | M7 |
| Capture source, phone, device details to cut manual entry | ✅ Source field, requester card, asset link, alert payload mapping | M1 / M5 / M7 |
| Rule-based routing into "buckets" (team, priority, source, user) | ✅ Teams plus ordered routing rules | M3 |
| Coordinate tasks across departments | ✅ Reassign across teams; watchers; internal notes with @mentions | M1 / M3 |
| Ownership, time-in-status, lifecycle (new, awaiting user, blocked, closed) | ✅ Fixed lifecycle, time-in-status, on-hold state | M1 |
| SLA calculation, breach warnings, date reminders | ✅ Business-hours SLA engine, warnings, breaches, due-today view | M3 |
| Email/SMS alerts for unassigned or unattended tickets | ✅ Email alerts; ❌ SMS (later) | M3 |
| Alerts only to the people who need them | ✅ Targeted events plus per-user preferences | M1+ |
| Technician notes that generate responses to end users | ✅ Public reply vs internal note, canned responses | M1 / M4 |
| Parent problem / child incidents; closing the parent closes the children | ✅ Problem linking, bulk resolve with notification | M5 |
| Link tickets to assets; asset service history | ✅ Lightweight asset register with history | M5 |
| User service history | ✅ Requester card plus requester page with all tickets | M1 |
| Knowledge base: self-service plus internal notes | ✅ Public and internal articles, portal deflection | M4 |
| Supervisor reports (tech performance, CSAT) | ✅ Supervisor dashboard plus reports | M6 |
| Technician reports (status, alerts, resolutions) | ✅ Agent dashboard | M6 |
| Custom and scheduled emailed reports | ✅ Filterable reports, CSV, scheduled email (no report builder) | M6 |
| Location-based support, billing, incident frequency reports | ✅ Location and incident-frequency reports; ❌ billing | M6 |
| Customer satisfaction | ✅ CSAT survey on resolution | M4 |
| Integration with own monitoring suite | ✅ Generic webhook intake instead of vendor-specific | M7 |
| ITIL suite, CMDB discovery, service catalog (Service Desk tier) | ❌ Non-goal for v1 | — |

## 2. Releases

| Release | Milestones | What a customer gets |
| --- | --- | --- |
| **v1.0 — usable help desk** | M0, M1, M2, M3 | Agents work tickets from portal, email and phone. Routing, SLAs, alerts and notifications all work. |
| **v1.1 — self-service and depth** | M4, M5 | Knowledge base, canned responses, CSAT, problems and incidents, asset history |
| **v1.2 — insight and integration** | M6, M7 | Dashboards, reports, scheduled reports, monitoring-alert intake, launch hardening |

## 3. Milestones

Size estimates assume one developer working with Claude, using QDM as the source for everything in M0. They are planning figures, not commitments, and get re-estimated at the start of each milestone.

---

### M0 — Foundation (port from QDM) · ~1 week
**Goal:** an empty but real Tadbeerly. You can sign in, invite people and deploy, with nothing ticket-specific yet.

**Scope**
- Create the repository and the dev Postgres cluster (WSL, per QDM README). Next 15, TypeScript, Tailwind v4, Drizzle, Zod. Add Vitest.
- Port the design system: `globals.css` tokens (renamed `tb-*` where prefixed), IBM Plex, `ui.tsx`, `forms.tsx`, `FilterBar`, `Pagination`, `CopyButton`, `RichTextEditor` + `richText.ts`, the `AppNav` / `Wordmark` shell and the sidebar component (generalized from `ProjectSidebar`).
- Port auth: login, sessions, logout, password reset, MFA (TOTP, recovery codes, challenges, organization-required gate), invitations, and `middleware.ts`.
- Organizations, users (`kind: agent | requester`), roles plus permission templates plus `db:sync-roles`, `authz.ts` reworked for organization scope (no project layer).
- Port the audit trail (`audit.ts`, `audit_events`) and an admin audit page.
- Port the email outbox, transports (`console`, `smtp`, `resend`, `graph`), templates restyled for Tadbeerly, the cron endpoint and the Netlify scheduled function.
- Port the storage interface (local, Netlify Blobs, SharePoint) and the checked file-response helper.
- Help system skeleton, the `org:create` script, and a seed with demo accounts.
- Netlify site with production and preview environments.

**Exit criteria (demo)**
1. Sign in as the seeded admin, enrol MFA, sign out and back in with a code.
2. Invite an agent. The invitation email shows up in the console. Accept it and land in an empty Tickets screen with the full shell (header, sidebar, title block).
3. The audit trail shows every step above.
4. `typecheck`, `build:check` and `test` all pass. A Netlify preview deploy renders the login page.

---

### M1 — Ticket core and agent workspace · ~2 weeks
**Goal:** agents can log, assign, discuss and resolve tickets, and requesters are told by email.

**Scope**
- Schema: tickets, entries, attachments, watchers, tags, number sequences, categories, priorities, teams and members, departments, locations.
- Admin screens: categories, priorities, teams, departments, locations, agents, requesters (plus CSV import).
- Ticket number allocator (`TKT-000123`).
- `ticketVisibleToAgent()` and `entriesVisibleToRequester()`, with integration tests first.
- Ticket views with sidebar badges, the list page (FilterBar, pagination, search), and the new-ticket form (phone or walk-in, pick or create requester).
- Ticket page: TitleBlock, timeline, ReplyComposer (public reply vs internal note), properties panel, requester card, watchers, status lifecycle, time-in-status, attachments through checked routes.
- Notifications: created acknowledgement, assigned, public reply, requester reply (in M2, via the portal and email), resolved, and @mention in a note. Per-user preferences.
- Auto-close of resolved tickets after N days (cron).

**Exit criteria (demo)**
1. An agent logs a phone ticket for a requester and the requester gets an acknowledgement email.
2. The agent assigns it to a colleague in another team. The colleague is emailed and sees it under "My open tickets" with a badge.
3. An internal note and a public reply are both added. **Only the public reply is emailed.** An integration test proves requester queries never return the note.
4. Resolve, wait for auto-close (simulated clock), and the audit trail shows the whole history.

---

### M2 — Requester portal and email-to-ticket · ~2 weeks
**Goal:** requesters raise and follow tickets themselves, by portal or plain email.

**Scope**
- `(portal)` shell. Magic-link and password sign-in for requesters. Self-registration limited to allowed domains.
- Portal pages: home, submit (category-driven), my requests, request detail (public timeline, reply, attach, reopen within 7 days).
- Inbound email: the transport interface, a `graph` implementation (delta polling every minute through a scheduled function), and a `postmark` webhook alternative. `inbound_emails` with a unique Message-ID.
- Threading (In-Reply-To/References, then subject tag plus participant check, then new ticket), quote stripping, the loop guard (headers, own addresses, per-sender rate limit with quarantine), the unknown-sender policy, and attachment capture.
- Outbound: reply marker, subject tag, recorded Message-IDs.
- An admin "simulate inbound email" screen and an `.eml` fixture test suite.

**Exit criteria (demo)**
1. Email support with an attachment. A ticket is created, the requester gets an acknowledgement, and the attachment is on the ticket.
2. Reply to the acknowledgement from a mail client and the reply threads into the same ticket. The quoted text is stripped.
3. An out-of-office auto-reply produces **no** ticket and **no** response. Fifty messages in a minute from one sender go to quarantine.
4. The requester signs into the portal by magic link, sees the request and the public replies only, and reopens it after resolution.
5. Re-running the inbound poll creates no duplicates.

---

### M3 — Routing, SLA and alerts · ~2 weeks · **completes v1.0**
**Goal:** tickets land with the right team automatically, every ticket has a trustworthy due time, and people are warned before a breach.

**Scope**
- Business calendars (time zone, weekly hours, holidays) and SLA policies (match on priority, category or VIP; response and resolution targets; pause statuses; warning %).
- The SLA engine as pure functions, **written test-first** (weekends, holidays, pause and resume, priority change, crossing midnight and time zones).
- SLA fields on tickets, `SlaStamp` everywhere, and Due today / Overdue views with badges.
- Routing rules (ordered, first match wins), an admin editor with "test this rule against a sample ticket", and "rule applied" timeline events.
- Auto-assignment (round robin or least open) respecting the Available/Away toggle.
- Cron sweep: SLA warnings and breaches (deduplicated), unassigned-threshold alerts to team leads, escalation notifications.
- Bulk actions on the list (assign, status, priority).

**Exit criteria (demo)**
1. An email with "VPN" in the subject routes to Network & Infrastructure as P2 and is auto-assigned to an available agent. The timeline shows the rule.
2. A P3 ticket created Thursday 16:30 Asia/Dubai shows the correct due time across the weekend and a seeded holiday.
3. Moving it to *Awaiting requester* shows PAUSED. The requester's reply resumes the clock with the paused time excluded.
4. The warning and breach emails each arrive **once**. The unassigned alert reaches team leads once.
5. The SLA unit suite covers every calendar edge case listed above.

---

### M4 — Knowledge base, canned responses, CSAT · ~1.5 weeks
**Scope:** KB categories and articles (public or internal, draft or published, revisions), full-text search, the portal KB with deflection suggestions on the submit form, "Was this helpful?", insert-article-link and create-article-from-ticket in the agent workspace, canned responses with placeholders, and the CSAT survey (signed token, one per resolution) shown on the ticket.

**Exit criteria:**
1. Typing "printer" on the portal submit form suggests the matching public article.
2. Internal articles never appear in the portal (integration test).
3. An agent inserts a canned response with the requester's name filled in.
4. Resolving sends CSAT links. One click records the score, and a second click doesn't overwrite it.

---

### M5 — Problems, incidents, assets, merge · ~1.5 weeks
**Scope:**
- Mark a ticket as a problem, link incidents to it, and bulk-resolve the children with a templated public reply and notifications.
- Merge duplicates.
- Asset types and assets, CSV import, ticket ↔ asset links, an asset page with service history, and assets shown in the requester card.

**Exit criteria:**
1. Five "email down" tickets are linked to one problem. Resolving the problem resolves all five, and each requester gets the update.
2. A laptop's asset page lists every ticket ever raised against it.
3. A merged duplicate shows "merged into TKT-…", and its history is still readable.

---

### M6 — Dashboards and reports · ~1.5 weeks
**Scope:** the agent dashboard, the supervisor dashboard (QDM `DashboardCharts` style with the `tb-col`, `tb-arc` and `tb-fade` animations), the reports listed in design §8.9 with filters and CSV export, and scheduled weekly/monthly report emails.

**Exit criteria:**
1. Supervisor dashboard figures match direct SQL counts on seed data (tested).
2. The SLA compliance report agrees with the ticket-level SLA stamps.
3. A scheduled weekly report arrives with a CSV link.

---

### M7 — Alert intake and launch hardening · ~1.5 weeks · **completes v1.2**
**Scope:**
- API keys (hashed, revocable, audited).
- `POST /api/v1/alerts` with deduplication, auto-update and optional auto-resolve on recovery.
- An index and performance pass on 100k seeded tickets.
- An accessibility pass (keyboard, contrast and focus, matching QDM's standard).
- A security review of the whole codebase.
- The complete `/help` guide.
- The production launch checklist (§7).

**Exit criteria:**
1. A repeated alert updates one ticket rather than creating many, and the recovery alert resolves it.
2. Ticket list and dashboard p95 stay under 500 ms on 100k tickets.
3. Security review findings are fixed.
4. The launch checklist is fully ticked.

---

**Total: about 13 weeks.** v1.0 lands after about 7 weeks.

## 4. How each milestone runs
1. **Implementation plan:** a detailed, task-by-task plan for the milestone is written and reviewed with you.
2. **Build test-first:** failing test, then code, then passing test, for every pure module and every visibility rule.
3. **Review:** a code review of the milestone's changes, with findings fixed.
4. **Verify:** `typecheck`, `build:check` and the full test suite, run and shown, not assumed.
5. **Demo:** the exit-criteria script, walked through on seed data, followed by your sign-off.
6. **Deploy:** to Netlify preview, and to production from v1.0 onwards.

## 5. Definition of done (every milestone)
- Exit criteria demonstrated on seed data.
- Typecheck, build check and tests are green.
- Every mutation writes an audit event, and every list is paged.
- New permission keys are added to the templates, and `db:sync-roles` has been run.
- Help topics are updated in the same change as any renamed control (QDM rule).
- No UI string or query exposes internal notes to requesters (integration test stays green).

## 6. Risks and mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Inbound email edge cases (threading, loops, odd clients) | Duplicate or lost tickets, mail storms | Transport interface; a unique Message-ID makes every poll idempotent; loop guard plus quarantine; a fixture suite of real `.eml` samples; a simulator for development |
| SLA maths wrong around weekends, holidays, time zones and pauses | Untrustworthy reports and pointless escalations | Pure functions, written test-first, exhaustive edge-case suite, one source of truth for due times |
| Internal-note or cross-tenant leak | Severe trust and privacy failure | Single visibility functions, 404-not-403, dedicated integration tests that run on every milestone |
| Serverless freezes best-effort sends (known from QDM) | Notifications delayed or stuck | Outbox plus scheduled drain as the real delivery path; `CRON_SECRET` mandatory in production |
| Graph permissions not consented (`Mail.ReadWrite`, `Mail.Send`) | Inbound or outbound mail blocked late | Port QDM's `email:graph-check` and extend it to read permissions, then run it in M2 week 1 |
| Scope creep toward a full ITSM product | Delayed v1.0 | Fixed milestone scope; anything new goes to a backlog after v1.2 |
| Working on a Windows drive under WSL (QDM lesson) | Stale dev server and slow installs | Keep the repository on the Linux filesystem **[ask Q6]** |
| Arabic/RTL added late | Expensive rework | Logical CSS properties from M0 even if English ships first |

## 7. Production launch checklist (filled in during M7)
Production database with backups and point-in-time restore · `SESSION_SECRET`, `MFA_ENCRYPTION_KEY` and `CRON_SECRET` set · sending domain verified (SPF, DKIM, DMARC) · support mailbox connected and `graph-check` green · storage backend chosen and tested · MFA required for admins · seed data **not** loaded · first organization created with `org:create` · help guide reviewed · error monitoring and log retention configured.

## 8. What I need from you (by milestone)
| When | Item |
| --- | --- |
| Before M0 | Answers to §9; Tadbeerly logo files (if any); decision on repository location |
| During M0 | Netlify account access (or a new site); a production Postgres provider |
| Before M2 | The support mailbox address, plus an Entra app registration with `Mail.ReadWrite` and `Mail.Send` (or a Postmark account) |
| Before M3 | Your real working week, hours, holidays and target SLA times (seeds are placeholders) |
| Before M5 | A sample asset list (CSV), if you want the import shaped around it |

## 9. Questions before any code is written — resolved 2026-11-07
**Answer: every default accepted.** The resolutions are recorded in design §17. The original questions are kept below for the record.

1. **Who is Tadbeerly for?** One organization's internal IT team (like WHD), or a product many companies sign up to (SaaS)? *Default: a multi-tenant data model with organizations onboarded by script, and no public signup or billing in v1.*
2. **Which teams will use it?** Only IT, or also HR, Facilities and other departments? This changes the seed categories, the portal wording and whether "Assets" is central or optional. *Default: generic teams, IT-flavoured seed.*
3. **Which email system will support@ run on?** Microsoft 365 (as QDM already sends via Graph), Google Workspace or something else? *Default: Microsoft 365 through Graph.*
4. **Is Arabic (right-to-left) needed at launch, or later?** *Default: English at launch, built RTL-ready.*
5. **How should requesters sign in?** Password, magic link, Microsoft single sign-on, or a mix? *Default: password plus magic link; SSO later.*
6. **Where should the code live?** QDM's README warns against working from a Windows drive under WSL. Should Tadbeerly live at `~/tadbeerly` in WSL (recommended), or in `D:\Tadbeerly`? *Default: WSL `~/tadbeerly`, with these docs moved into it.*
7. **Brand:** do you have a Tadbeerly logo and colour, or should it keep QDM's gold until one exists? *Default: QDM gold with a text wordmark placeholder.*
8. **Hosting:** Netlify plus managed Postgres, the same as QDM? *Default: yes.*
9. **Is the feature cut right?** v1.0 = M0–M3 (tickets, portal, email, routing, SLA). Should anything move earlier, such as reports or assets? *Default: as planned.*
