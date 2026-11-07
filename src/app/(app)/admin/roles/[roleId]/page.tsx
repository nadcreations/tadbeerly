import { notFound } from "next/navigation";
import { z } from "zod";
import { can, requirePagePermission } from "@/lib/authz";
import { NotFoundError } from "@/lib/errors";
import { PERMISSION_GROUPS, PERMISSIONS } from "@/lib/permissions";
import { getRole } from "@/lib/rolesAdmin";
import { createRoleAction, updateRolePermissionsAction } from "@/lib/actions/roles";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, Field, Input, TitleBlock } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RolePage({ params }: { params: Promise<{ roleId: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.ADMIN_ROLES);
  const { roleId } = await params;
  if (!z.string().uuid().safeParse(roleId).success) notFound();

  let role;
  try {
    role = await getRole(user.organizationId, roleId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const editable = !role.isLocked && can(user, PERMISSIONS.ADMIN_ROLES);
  const granted = new Set(role.permissions);

  return (
    <>
      <TitleBlock
        eyebrow="Role"
        title={role.name}
        description={role.description ?? undefined}
        fields={[
          { label: "Type", value: role.isSystem ? "System" : "Custom" },
          { label: "Permissions", value: String(role.permissions.length), code: true },
        ]}
      />

      <Card className="max-w-3xl">
        <CardHeader
          title="Permissions"
          description={
            role.isLocked
              ? "The Administrator role always has every permission, so it cannot be changed."
              : "Choose what people with this role may do."
          }
          action={role.isLocked ? <Badge>Locked</Badge> : undefined}
        />
        <div className="px-4 py-4">
          <ActionForm action={updateRolePermissionsAction}>
            <input type="hidden" name="roleId" value={role.id} />
            {PERMISSION_GROUPS.map((group) => (
              <fieldset key={group.label} className="space-y-3">
                <legend className="field-label mb-2">{group.label}</legend>
                {group.permissions.map((p) => (
                  <label key={p.key} className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      name="permissions"
                      value={p.key}
                      defaultChecked={granted.has(p.key)}
                      disabled={!editable}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-[13px] font-medium text-ink-900">{p.label}</span>
                      <span className="block text-[12px] text-ink-500">{p.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
            {editable ? <SubmitButton pendingLabel="Saving…">Save permissions</SubmitButton> : null}
          </ActionForm>
        </div>
      </Card>

      <Card className="mt-6 max-w-2xl">
        <CardHeader
          title="Create role from this one"
          description="The new role starts with the same permissions. Change them afterwards."
        />
        <div className="px-4 py-4">
          <ActionForm action={createRoleAction} resetOnSuccess>
            <input type="hidden" name="copyFromRoleId" value={role.id} />
            <Field label="Name" htmlFor="name" required>
              <Input id="name" name="name" required minLength={2} maxLength={60} />
              <FieldError name="name" />
            </Field>
            <Field label="Description" htmlFor="description">
              <Input id="description" name="description" maxLength={300} />
              <FieldError name="description" />
            </Field>
            <SubmitButton pendingLabel="Creating…">Create role</SubmitButton>
          </ActionForm>
        </div>
      </Card>
    </>
  );
}
