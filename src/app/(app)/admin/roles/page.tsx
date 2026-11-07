import Link from "next/link";
import { requirePagePermission } from "@/lib/authz";
import { PERMISSIONS } from "@/lib/permissions";
import { listRoles } from "@/lib/rolesAdmin";
import { Badge, Card, Table, Td, Th, TitleBlock } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const user = await requirePagePermission(PERMISSIONS.ADMIN_ROLES);
  const roles = await listRoles(user.organizationId);

  return (
    <>
      <TitleBlock
        title="Roles"
        description="What each kind of agent may do. Open a role to change its permissions or to make a new role from it."
      />
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Role</Th>
              <Th>Description</Th>
              <Th className="text-end">Members</Th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <Td>
                  <Link
                    href={`/admin/roles/${role.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {role.name}
                  </Link>
                  {role.isSystem ? (
                    <span className="ms-2">
                      <Badge>System</Badge>
                    </span>
                  ) : null}
                </Td>
                <Td className="text-ink-600">{role.description ?? ""}</Td>
                <Td className="text-end">
                  <span className="doc-code text-[12px]">{role.memberCount}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
