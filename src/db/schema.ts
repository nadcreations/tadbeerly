import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  check,
  bigserial,
  bigint,
  integer,
  inet,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ---------------------------------------------------------------------------
 * Enums
 * ------------------------------------------------------------------------ */

export const organizationStatus = pgEnum("organization_status", [
  "active",
  "suspended",
]);

export const userStatus = pgEnum("user_status", [
  "invited",
  "active",
  "disabled",
]);

/** Agents work tickets; requesters raise them. */
export const userKind = pgEnum("user_kind", ["agent", "requester"]);

export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

export const notificationKind = pgEnum("notification_kind", [
  "user_invitation",
  "invitation_accepted",
  "password_reset",
]);

export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
  "skipped",
]);

/* ---------------------------------------------------------------------------
 * Organizations
 *
 * The tenant boundary. Every row of business data carries an owning
 * organization, and nothing is ever read across that boundary.
 * ------------------------------------------------------------------------ */

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    status: organizationStatus("status").notNull().default("active"),
    /**
     * When set, every member must complete MFA enrolment before they can use
     * the platform. Security policy is the organization's call.
     */
    requireMfa: boolean("require_mfa").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("organizations_name_lower_idx").on(sql`lower(${t.name})`)],
);

/* ---------------------------------------------------------------------------
 * Roles
 *
 * Per-organization. New organizations get a copy of each role template, so an
 * organization can later edit its own roles without affecting anyone else.
 * ------------------------------------------------------------------------ */

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Array of permission keys — see src/lib/permissions.ts */
    permissions: jsonb("permissions")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** System roles cannot be deleted, only copied. */
    isSystem: boolean("is_system").notNull().default(false),
    /** Locked roles cannot be edited, so an organization cannot lock itself out. */
    isLocked: boolean("is_locked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("roles_organization_key_idx").on(t.organizationId, t.key)],
);

/* ---------------------------------------------------------------------------
 * Users
 *
 * A user account belongs to exactly one organization. Users are never moved
 * between organizations; they are disabled and re-created, so the audit trail
 * always attributes an action to the right one.
 * ------------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    jobTitle: text("job_title"),
    phone: text("phone"),
    timezone: text("timezone").notNull().default("UTC"),
    status: userStatus("status").notNull().default("active"),
    kind: userKind("kind").notNull(),
    /** Required for agents; requesters have no role. */
    roleId: uuid("role_id").references(() => roles.id, {
      onDelete: "restrict",
    }),

    /* --- Multi-factor authentication --- */
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    /** TOTP secret, AES-256-GCM encrypted — see src/lib/totp.ts. */
    mfaSecret: text("mfa_secret"),
    mfaEnrolledAt: timestamp("mfa_enrolled_at", { withTimezone: true }),
    /**
     * Highest TOTP time step already accepted. A code stays valid for its whole
     * 30 second window, so without this one could be replayed seconds later.
     */
    mfaLastUsedStep: bigint("mfa_last_used_step", { mode: "number" }),

    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    index("users_organization_idx").on(t.organizationId),
    check(
      "users_agent_has_role",
      sql`${t.kind} <> 'agent' OR ${t.roleId} IS NOT NULL`,
    ),
  ],
);

/* ---------------------------------------------------------------------------
 * Invitations
 *
 * An administrator invites a person into their own organization. The user row
 * exists from the moment of the invitation (status "invited"); accepting sets
 * a password and activates it. Withdrawing deletes the never-activated user,
 * which cascades here.
 * ------------------------------------------------------------------------ */

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** The role the person will receive. */
    roleId: uuid("role_id").references(() => roles.id, {
      onDelete: "set null",
    }),
    /**
     * SHA-256 of the invitation token (hashInvitationToken); the raw token is
     * only ever in the link. The column keeps its original name, `token`,
     * rather than being renamed by a migration.
     */
    tokenHash: text("token").notNull(),
    status: invitationStatus("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("invitations_token_idx").on(t.tokenHash),
    index("invitations_email_idx").on(sql`lower(${t.email})`),
    index("invitations_organization_idx").on(t.organizationId),
  ],
);

/* ---------------------------------------------------------------------------
 * Sessions
 * ------------------------------------------------------------------------ */

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the cookie token; the raw token is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/**
 * Administrator-issued password resets.
 *
 * Deliberately not modelled as an invitation. An invitation creates access and
 * lives for 30 days; a reset changes an existing account and is dangerous for
 * exactly as long as it exists, so it is single-use and short-lived.
 *
 * The token is stored hashed, like a session's and an invitation's: a copy of
 * the database must not hold working links.
 */
// Scoped through users, so no organization_id: reached only by token hash or an already-resolved user id.
export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the token handed to the administrator. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set the moment it is redeemed; a reset never works twice. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    issuedByUserId: uuid("issued_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("password_resets_token_idx").on(t.tokenHash),
    index("password_resets_user_idx").on(t.userId),
  ],
);

/* ---------------------------------------------------------------------------
 * Multi-factor authentication
 * ------------------------------------------------------------------------ */

/**
 * Single-use recovery codes.
 *
 * These exist so a lost phone is an inconvenience rather than a lockout. Only
 * the SHA-256 hash is stored — the plaintext is shown once, at generation, and
 * cannot be recovered afterwards.
 */
// Scoped through users, so no organization_id: reached only by code hash or an already-resolved user id.
export const mfaRecoveryCodes = pgTable(
  "mfa_recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    /** Set on use; the row is kept so the audit trail shows it was spent. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mfa_recovery_codes_user_idx").on(t.userId),
    uniqueIndex("mfa_recovery_codes_hash_idx").on(t.codeHash),
  ],
);

/**
 * The half-authenticated state between password and second factor.
 *
 * Kept server-side rather than in a signed cookie so it can be revoked, and so
 * attempts can be counted — five wrong codes burns the challenge and sends the
 * user back to the password screen.
 */
// Scoped through users, so no organization_id: reached only by token hash or an already-resolved user id.
export const mfaChallenges = pgTable(
  "mfa_challenges",
  {
    /** SHA-256 of the cookie token; the raw token is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("mfa_challenges_user_idx").on(t.userId)],
);

/* ---------------------------------------------------------------------------
 * Audit events — append only
 *
 * The audit trail is evidence. Nothing here is ever updated or deleted, and
 * every row records who acted and in which organization. The organization
 * reference restricts deletion: an organization with a history cannot vanish.
 * ------------------------------------------------------------------------ */

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Dotted action key, e.g. "user.invited". */
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    /** Human-readable one-line summary, rendered directly in the audit view. */
    summary: text("summary").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ipAddress: inet("ip_address"),
  },
  (t) => [
    index("audit_events_org_idx").on(t.organizationId, t.occurredAt),
    index("audit_events_actor_idx").on(t.actorUserId),
  ],
);

/* ---------------------------------------------------------------------------
 * Email notifications
 *
 * Transactional outbox.
 *
 * Rows are written in the same transaction as the business action that caused
 * them, so a notification can never be lost because the mail server was down —
 * and, just as importantly, one can never be sent for an action that rolled
 * back. A separate dispatcher drains this table.
 *
 * It doubles as the record of what was sent to whom, and as the dedupe key for
 * recurring reminders.
 * ------------------------------------------------------------------------ */

export const emailNotifications = pgTable(
  "email_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: notificationKind("kind").notNull(),
    status: notificationStatus("status").notNull().default("pending"),

    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    toEmail: text("to_email").notNull(),
    toName: text("to_name"),

    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html").notNull(),

    /** What the notification is about, used for reminder dedupe. */
    entityType: text("entity_type"),
    entityId: text("entity_id"),

    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Lease held by the dispatcher that claimed this row; null when unclaimed. */
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
  },
  (t) => [
    index("email_notifications_status_idx").on(t.status, t.createdAt),
    index("email_notifications_recipient_idx").on(t.recipientUserId),
    index("email_notifications_dedupe_idx").on(t.kind, t.entityId, t.createdAt),
  ],
);

/* ---------------------------------------------------------------------------
 * Rate limits — fixed-window counters keyed by an arbitrary string
 * ------------------------------------------------------------------------ */

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});
