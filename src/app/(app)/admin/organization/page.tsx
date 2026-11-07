import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requirePagePermission } from "@/lib/authz";
import { PERMISSIONS } from "@/lib/permissions";
import {
  setOrganizationMfaPolicyAction,
  updateOrganizationAction,
} from "@/lib/actions/organization";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { Card, CardHeader, Field, Input, TitleBlock } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OrganizationPage() {
  const user = await requirePagePermission(PERMISSIONS.ADMIN_CONFIG);
  const [org] = await db
    .select({ name: organizations.name, requireMfa: organizations.requireMfa })
    .from(organizations)
    .where(eq(organizations.id, user.organizationId));

  return (
    <>
      <TitleBlock
        title="Organization settings"
        description="The name people see, and the security policy for everyone who signs in."
      />

      <Card className="max-w-2xl">
        <CardHeader title="Name" />
        <div className="px-4 py-4">
          <ActionForm action={updateOrganizationAction}>
            <Field label="Organization name" htmlFor="name" required>
              <Input
                id="name"
                name="name"
                defaultValue={org.name}
                required
                minLength={2}
                maxLength={120}
              />
              <FieldError name="name" />
            </Field>
            <SubmitButton pendingLabel="Saving…">Save name</SubmitButton>
          </ActionForm>
        </div>
      </Card>

      <Card className="mt-6 max-w-2xl">
        <CardHeader
          title="Require two-factor authentication for everyone"
          description={
            org.requireMfa
              ? "On. Everyone must set up two-factor authentication before they can use the app."
              : "Off. Turn it on to make everyone set up two-factor authentication. You need it on your own account first."
          }
        />
        <div className="px-4 py-4">
          <ActionForm action={setOrganizationMfaPolicyAction}>
            <input type="hidden" name="require" value={org.requireMfa ? "false" : "true"} />
            <SubmitButton pendingLabel="Saving…" variant={org.requireMfa ? "secondary" : "primary"}>
              {org.requireMfa ? "Stop requiring" : "Require for everyone"}
            </SubmitButton>
          </ActionForm>
        </div>
      </Card>
    </>
  );
}
