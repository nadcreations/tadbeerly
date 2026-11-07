/**
 * Permission model.
 *
 * Organization scope is enforced by every query filtering on the actor's
 * organization and cannot be overridden by any role. Within an organization,
 * a role grants the permission keys below. A permission never grants
 * cross-organization visibility.
 */

export const PERMISSIONS = {
  ADMIN_USERS: "admin.users",
  ADMIN_ROLES: "admin.roles",
  ADMIN_CONFIG: "admin.config",
  ADMIN_AUDIT: "admin.audit",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** Grouped for rendering the role editor. */
export const PERMISSION_GROUPS: {
  label: string;
  permissions: { key: Permission; label: string; description: string }[];
}[] = [
  {
    label: "Administration",
    permissions: [
      {
        key: PERMISSIONS.ADMIN_USERS,
        label: "Manage users",
        description: "Invite agents, change their roles, disable and enable their accounts, and reset their passwords and two-step verification.",
      },
      {
        key: PERMISSIONS.ADMIN_ROLES,
        label: "Manage roles",
        description: "Create roles from existing ones and choose what each role may do.",
      },
      {
        key: PERMISSIONS.ADMIN_CONFIG,
        label: "Manage configuration",
        description: "Change organization settings and security policy.",
      },
      {
        key: PERMISSIONS.ADMIN_AUDIT,
        label: "View audit trail",
        description: "Read the record of who changed what and when.",
      },
    ],
  },
];

/**
 * System role templates. Cloned into every new organization so it can tailor
 * its own roles without affecting anyone else.
 */
export const SYSTEM_ROLE_TEMPLATES: {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
  isLocked?: boolean;
}[] = [
  {
    key: "administrator",
    name: "Administrator",
    description: "Full control of the organization: people, roles, settings and audit.",
    permissions: [...ALL_PERMISSIONS],
    isLocked: true,
  },
  {
    key: "supervisor",
    name: "Supervisor",
    description: "Oversees the team and its queues.",
    permissions: [],
  },
  {
    key: "agent",
    name: "Agent",
    description: "Works requests day to day.",
    permissions: [],
  },
  {
    key: "read_only",
    name: "Read-only",
    description: "Can look but not change anything.",
    permissions: [],
  },
];

export function hasPermission(
  granted: string[] | undefined | null,
  required: Permission,
): boolean {
  if (!granted) return false;
  return granted.includes(required);
}
