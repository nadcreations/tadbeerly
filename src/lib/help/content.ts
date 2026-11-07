/**
 * The in-app user guide.
 *
 * Content is structured data rather than prose so that one renderer produces
 * every topic consistently, and so a step list can never drift out of the
 * shape the UI expects. Keep the wording matched to the actual on-screen
 * labels: a guide that names a button that no longer exists is worse than no
 * guide at all.
 *
 * Only what exists today is described. The ticket workspace arrives in the
 * next milestone and gets its own topics then.
 */

export type HelpBlock =
  | { kind: "para"; text: string }
  | { kind: "subheading"; text: string }
  | { kind: "steps"; title?: string; items: string[] }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone: "info" | "warning" | "tip"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "code"; text: string };

export type Audience = "everyone" | "org-admin" | "system-admin";

export const AUDIENCE_LABELS: Record<Audience, string> = {
  everyone: "Everyone",
  "org-admin": "Organization administrators",
  "system-admin": "System administrators",
};

export type HelpTopic = {
  slug: string;
  title: string;
  summary: string;
  section: string;
  audience: Audience;
  blocks: HelpBlock[];
};

export const HELP_SECTIONS = ["Getting started", "Administration", "Security"] as const;

export const HELP_TOPICS: HelpTopic[] = [
  /* ------------------------------ Getting started ----------------------- */
  {
    slug: "signing-in",
    title: "Signing in",
    summary: "Activate an invitation, sign in, and sign out.",
    section: "Getting started",
    audience: "everyone",
    blocks: [
      {
        kind: "para",
        text: "Tadbeerly accounts are issued by your organization's administrators. There is no public sign-up: you are invited by email, and the invitation link is how you choose your first password.",
      },
      {
        kind: "steps",
        title: "Activate your account",
        items: [
          "Open the link in your invitation email. The page is titled Join followed by your organization's name.",
          "Type a password into Password. It must be at least 10 characters.",
          "Type it again into Confirm password.",
          "Select Activate account and sign in. You are signed in straight away.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "An invitation link works for 30 days and once only. If it has expired the page says Invitation not usable: ask an administrator to use Resend invitation for you.",
      },
      {
        kind: "steps",
        title: "Sign in",
        items: [
          "Open the Sign in page.",
          "Type your address into Email address and your password into Password.",
          "Select Sign in.",
          "If two-step verification is on for your account you are taken to a page titled Two-step verification. Type the 6-digit code from your authenticator app into Verification code and select Verify and sign in.",
        ],
      },
      {
        kind: "list",
        items: [
          "Lost your phone? Enter one of your recovery codes into Verification code instead. They look like ABCDE-FGHIJ.",
          "Select Cancel and sign in as someone else to abandon a code prompt and start again.",
          "Too many wrong passwords for one address in a short time pauses sign-in for that address, so wait and try again later.",
          "Sessions last 12 hours, after which you sign in again.",
        ],
      },
      {
        kind: "steps",
        title: "Sign out",
        items: [
          "Select your name at the end of the top bar to open the account menu.",
          "Select Sign out.",
        ],
      },
      {
        kind: "para",
        text: "The Tickets page is a placeholder for now. The ticket workspace arrives in the next milestone.",
      },
    ],
  },
  {
    slug: "resetting-your-password",
    title: "Resetting your password",
    summary: "Choose a new password yourself, or have an administrator issue a link.",
    section: "Getting started",
    audience: "everyone",
    blocks: [
      {
        kind: "steps",
        title: "If you forgot your password",
        items: [
          "On the Sign in page, select Forgot password?.",
          "On the page titled Reset your password, type your address into Email address and select Send reset link.",
          "Open the email and follow its link. It is valid for 60 minutes.",
          "On the page titled Set a new password, fill in New password (at least 10 characters) and Confirm password.",
          "Select Set password and sign out everywhere. Then sign in with the new password.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "Tadbeerly gives the same answer whether or not the address has an account, so the page never reveals who is registered. If no email arrives, check the address and ask your administrator.",
      },
      {
        kind: "list",
        items: [
          "A reset link works once. Using it signs the account out of every device.",
          "If a link says Link not usable, it has been used or has expired. Select Request a new link.",
          "A reset does not turn off two-step verification: you are still asked for a code when you sign in.",
        ],
      },
      {
        kind: "subheading",
        text: "Administrators: issuing a link for someone",
      },
      {
        kind: "steps",
        items: [
          "Open Admin, then Agents.",
          "Find the person (they must be Active) and select Reset password. Confirm the prompt.",
          "Copy the link shown. It is displayed once and is valid for 24 hours.",
          "Send it to the person yourself, for example when email is the problem.",
        ],
      },
    ],
  },

  /* ------------------------------ Administration ------------------------ */
  {
    slug: "inviting-agents",
    title: "Inviting and managing agents",
    summary: "Invite people, set their role, and disable or restore accounts.",
    section: "Administration",
    audience: "org-admin",
    blocks: [
      {
        kind: "para",
        text: "Agents are the people who work in your organization. You need the Manage users permission, which Administrators have, to see Admin then Agents.",
      },
      {
        kind: "steps",
        title: "Invite an agent",
        items: [
          "Open Admin, then Agents, and scroll to the card titled Invite an agent.",
          "Fill in First name, Last name and Email. Job title is optional.",
          "Choose a Role. The list shows your organization's roles; Administrator appears only if you are an Administrator yourself.",
          "Select Send invitation. The person gets an email with a link to choose a password. It works for 30 days.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "An email address can belong to one account across the whole system. If it is taken you will be told that someone with that email already has an account.",
      },
      { kind: "subheading", text: "The agents list" },
      {
        kind: "para",
        text: "Use Search name or email, and the Role and Status filters (All roles, All statuses), to narrow the list. Each row has a Role dropdown and a status badge: Invited, Active or Disabled.",
      },
      {
        kind: "table",
        head: ["Button", "Shown for", "What it does"],
        rows: [
          ["Resend invitation", "Invited", "Replaces the earlier link with a new one and emails it."],
          ["Withdraw", "Invited", "Cancels the invitation and removes the unactivated account."],
          ["Reset password", "Active", "Issues a password reset link valid for 24 hours, shown once."],
          ["Reset 2-step", "Active", "Clears the person's two-step verification and signs them out. They set it up again at next sign-in."],
          ["Disable", "Active", "Ends the person's access immediately and signs them out. Not available on your own row."],
          ["Enable", "Disabled", "Restores access."],
        ],
      },
      {
        kind: "steps",
        title: "Change someone's role",
        items: [
          "Open Admin, then Agents.",
          "Use the Role dropdown on the person's row and pick the new role.",
        ],
      },
      {
        kind: "note",
        tone: "warning",
        text: "An organization must keep at least one active Administrator. Disabling, demoting or withdrawing the last one is refused with that message. Make another person an Administrator first.",
      },
      {
        kind: "note",
        tone: "info",
        text: "Only an Administrator can make someone an Administrator, or change the role of, disable, enable, reset the password or two-step verification of, or resend or withdraw the invitation of an Administrator. If you manage users without being an Administrator, Administrator rows show Only an Administrator can change an Administrator instead of buttons.",
      },
    ],
  },
  {
    slug: "roles-and-permissions",
    title: "Roles and permissions",
    summary: "What each role may do, and how to make a role of your own.",
    section: "Administration",
    audience: "org-admin",
    blocks: [
      {
        kind: "para",
        text: "A role is a named set of permissions. Every organization has its own copy of the standard roles, so changing yours never affects another organization. Open Admin, then Roles (you need Manage roles).",
      },
      {
        kind: "table",
        head: ["Role", "Starts with"],
        rows: [
          ["Administrator", "Every permission. It is locked: its permissions cannot be changed."],
          ["Supervisor", "No administration permissions. Gains ticket permissions in later milestones."],
          ["Agent", "No administration permissions."],
          ["Read-only", "No administration permissions."],
        ],
      },
      {
        kind: "para",
        text: "The Roles list shows Role, Description and Members, and marks standard roles with a System badge. Select a role's name to open it.",
      },
      {
        kind: "subheading",
        text: "The four permissions",
      },
      {
        kind: "table",
        head: ["Permission", "Lets a person"],
        rows: [
          ["Manage users", "Invite, edit, disable and reset passwords for people in the organization."],
          ["Manage roles", "Create, edit and delete roles and choose what each role may do."],
          ["Manage configuration", "Change organization settings and security policy."],
          ["View audit trail", "Read the record of who changed what and when."],
        ],
      },
      {
        kind: "steps",
        title: "Change what a role may do",
        items: [
          "Open the role. Under Permissions, tick or untick the boxes.",
          "Select Save permissions.",
        ],
      },
      {
        kind: "para",
        text: "On the Administrator role the boxes are disabled and a Locked badge is shown.",
      },
      {
        kind: "note",
        tone: "info",
        text: "You can't change the permissions of your own role. Unless you are an Administrator, you also can't grant a permission you don't have yourself: its box stays disabled, and you can't create a role from one that has it. You can still keep or remove a permission a role already has.",
      },
      {
        kind: "steps",
        title: "Create a role",
        items: [
          "Open the role you want to start from. Its permissions are copied.",
          "In the card titled Create role from this one, enter a Name (2 to 60 characters) and optionally a Description.",
          "Select Create role. Then open the new role and adjust its permissions.",
        ],
      },
      {
        kind: "note",
        tone: "tip",
        text: "Roles are stored as data, so a change to the standard templates in a new release does not reach existing organizations by itself. Operators run the db:sync-roles command to add newly introduced permissions without touching your customisations.",
      },
    ],
  },
  {
    slug: "organization-settings",
    title: "Organization settings",
    summary: "Rename the organization and set its security policy.",
    section: "Administration",
    audience: "org-admin",
    blocks: [
      {
        kind: "para",
        text: "Open Admin, then Settings. The page is titled Organization settings and needs the Manage configuration permission.",
      },
      {
        kind: "steps",
        title: "Rename the organization",
        items: [
          "In the Name card, edit Organization name (2 to 120 characters).",
          "Select Save name.",
        ],
      },
      {
        kind: "para",
        text: "Names must be unique across Tadbeerly, ignoring capital letters. If another organization already uses the name, you are told and nothing changes.",
      },
      {
        kind: "steps",
        title: "Require two-factor authentication for everyone",
        items: [
          "Make sure two-step verification is already on for your own account (see Two-step verification).",
          "In the card titled Require two-factor authentication for everyone, select Require for everyone.",
          "To relax the policy later, select Stop requiring.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text: "While the policy is on, anyone who has not enrolled can reach only the Security page until they do. Administrators are always required to use two-step verification, whatever this setting says.",
      },
      {
        kind: "para",
        text: "Both changes are recorded in the audit trail.",
      },
    ],
  },
  {
    slug: "email-delivery",
    title: "How email is delivered",
    summary: "The outbox, the transport setting, and the five-minute scheduled drain.",
    section: "Administration",
    audience: "system-admin",
    blocks: [
      {
        kind: "para",
        text: "Tadbeerly sends email for three events: an invitation (user_invitation), a notice to the inviter when it is accepted (invitation_accepted), and a password reset link (password_reset). Nothing else sends mail.",
      },
      { kind: "subheading", text: "The outbox" },
      {
        kind: "para",
        text: "A message is first written to an outbox table in the same transaction as the action that caused it, so it is never lost if the mail server is down and never sent for an action that rolled back. Right after the action commits, the app makes a quick best-effort attempt to send. A message that is not delivered is retried, up to 5 attempts, after which it is marked failed.",
      },
      { kind: "subheading", text: "Choosing a transport" },
      {
        kind: "para",
        text: "The EMAIL_TRANSPORT environment variable picks how mail leaves the server.",
      },
      {
        kind: "table",
        head: ["Value", "Behaviour"],
        rows: [
          ["console (default)", "Prints the message in the server log instead of sending it. Safe for development."],
          ["smtp", "Any SMTP server. Not suitable for serverless hosting."],
          ["resend", "Resend's HTTPS API. EMAIL_FROM must be on a domain verified with them."],
          ["graph", "Microsoft 365 through Graph, sending from a real mailbox. Needs the Mail.Send application permission."],
        ],
      },
      {
        kind: "para",
        text: "EMAIL_FROM and EMAIL_FROM_NAME set the sender. The provider's own variables (SMTP_HOST, RESEND_API_KEY and so on) are listed in the .env.example file.",
      },
      { kind: "subheading", text: "The scheduled drain" },
      {
        kind: "para",
        text: "The immediate attempt is best-effort, and on a serverless host the function can be frozen before it finishes. A second path catches whatever it missed: POST /api/cron/notifications, protected by the CRON_SECRET environment variable.",
      },
      {
        kind: "code",
        text: 'curl -X POST -H "x-cron-secret: $CRON_SECRET" https://your-host/api/cron/notifications',
      },
      {
        kind: "list",
        items: [
          "With no CRON_SECRET set the endpoint is switched off, and a message that fails its first attempt is never retried.",
          "On Netlify the scheduled function in netlify/functions/notifications.ts calls the endpoint every 5 minutes, reading the same CRON_SECRET. Netlify runs scheduled functions on production deploys only, so previews never send mail.",
          "On other hosts, point any scheduler at the endpoint every few minutes.",
        ],
      },
      {
        kind: "note",
        tone: "warning",
        text: "Set CRON_SECRET in every deployment that sends mail. Without it, undelivered invitations and reset links sit pending indefinitely, which looks like mail that was never sent.",
      },
    ],
  },

  /* ------------------------------ Security ------------------------------ */
  {
    slug: "two-factor-authentication",
    title: "Two-step verification",
    summary: "Add a code from your phone to your password, and what to do if you lose it.",
    section: "Security",
    audience: "everyone",
    blocks: [
      {
        kind: "para",
        text: "Two-step verification (also called two-factor authentication) asks for a 6-digit code from an authenticator app each time you sign in, on top of your password. Administrators must use it. An organization can also require it for everyone.",
      },
      {
        kind: "steps",
        title: "Turn it on",
        items: [
          "Open the account menu and select Security.",
          "Select Set up two-step verification.",
          "Install an authenticator app if you need one: Microsoft Authenticator, Google Authenticator and 1Password all work.",
          "Scan the code with the app. If you cannot scan it, type the key shown by hand, or use Copy key.",
          "Type the code the app shows and select Turn on two-step verification.",
          "Save the recovery codes shown. Each works once if you lose your phone.",
        ],
      },
      {
        kind: "note",
        tone: "warning",
        text: "If you are an Administrator who has not enrolled yet, the message Administrators must use two-step verification appears on the Security page and the rest of the app is closed to you until you finish the setup above.",
      },
      {
        kind: "steps",
        title: "Make new recovery codes",
        items: [
          "On the Security page, find Recovery codes. It shows how many of the 10 are unused.",
          "Under Generate new recovery codes, enter a current code from your app and select Generate new codes.",
          "Replacing the set cancels every code you had written down.",
        ],
      },
      {
        kind: "steps",
        title: "Switch it off (when it is not required)",
        items: [
          "Under Switch off two-step verification, enter a code in Code from your app, or a recovery code.",
          "Type your password into Confirm your password.",
          "Select Switch off.",
        ],
      },
      {
        kind: "para",
        text: "If your role or your organization requires two-step verification, the Switch off form is replaced by a note saying so.",
      },
      {
        kind: "subheading",
        text: "Lost your phone and your recovery codes",
      },
      {
        kind: "para",
        text: "Ask an administrator to open Admin, then Agents, and select Reset 2-step on your row. You are signed out and set it up again at your next sign-in.",
      },
    ],
  },
  {
    slug: "the-audit-trail",
    title: "The audit trail",
    summary: "Read the record of who did what, and filter it.",
    section: "Security",
    audience: "org-admin",
    blocks: [
      {
        kind: "para",
        text: "Every change to people, roles and settings, and every sign-in event, is recorded. Open Admin, then Audit trail. You need the View audit trail permission. Entries cannot be edited or removed, and you see only your own organization's.",
      },
      {
        kind: "table",
        head: ["Column", "Shows"],
        rows: [
          ["When", "The date and time of the event."],
          ["Who", "The person who did it, or System when no person was involved."],
          ["Action", "The kind of event, such as Agent invited or Role permissions updated."],
          ["Summary", "A sentence describing what happened."],
          ["IP", "The address the request came from, when known."],
        ],
      },
      {
        kind: "steps",
        title: "Filter the list",
        items: [
          "Select Filters.",
          "Choose an Action, choose who (Anyone by default), and optionally fill the Date range From date and To date. The whole of the last day is included.",
          "Select Apply. Each active filter appears as a chip you can remove, and Clear all resets them.",
        ],
      },
      {
        kind: "para",
        text: "The list shows 100 entries per page, newest first, with page links below it.",
      },
      {
        kind: "note",
        tone: "info",
        text: "The IP column depends on the hosting platform's proxy setting the x-forwarded-for header. When it is missing the column is blank.",
      },
    ],
  },
];

export function getTopic(slug: string): HelpTopic | undefined {
  return HELP_TOPICS.find((topic) => topic.slug === slug);
}

/** Topics grouped by section, in the order of HELP_SECTIONS. Empty sections are kept out. */
export function topicsBySection(): { section: string; topics: HelpTopic[] }[] {
  return HELP_SECTIONS.map((section) => ({
    section,
    topics: HELP_TOPICS.filter((topic) => topic.section === section),
  })).filter((group) => group.topics.length > 0);
}

/** Every topic in reading order: section by section, as the index shows them. */
export function orderedTopics(): HelpTopic[] {
  return topicsBySection().flatMap((group) => group.topics);
}
