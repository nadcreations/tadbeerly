import { can } from "@/lib/authz";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

type AdminNavItem = { href: string; label: string; icon: string; permission: Permission };
type AdminNavGroup = { label: string; items: AdminNavItem[] };

/** The admin area's navigation, each item gated by the permission its page needs. */
const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: "Organization",
    items: [
      { href: "/admin/organization", label: "Settings", icon: "settings", permission: PERMISSIONS.ADMIN_CONFIG },
      { href: "/admin/agents", label: "Agents", icon: "members", permission: PERMISSIONS.ADMIN_USERS },
      { href: "/admin/roles", label: "Roles", icon: "roles", permission: PERMISSIONS.ADMIN_ROLES },
    ],
  },
  {
    label: "Security",
    items: [
      { href: "/admin/audit", label: "Audit trail", icon: "audit", permission: PERMISSIONS.ADMIN_AUDIT },
    ],
  },
];

/** The groups the user may see; groups left empty are dropped. */
export function visibleAdminNav(user: Pick<SessionUser, "permissions">) {
  return ADMIN_NAV.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => can(user, item.permission))
      .map(({ href, label, icon }) => ({ href, label, icon })),
  })).filter((group) => group.items.length > 0);
}
