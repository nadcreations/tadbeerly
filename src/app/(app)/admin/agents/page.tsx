import { requirePagePermission } from "@/lib/authz";
import { PERMISSIONS } from "@/lib/permissions";
import { listAgents, listAssignableRoles } from "@/lib/agents";
import {
  changeAgentRoleAction,
  inviteAgentAction,
  issueAdminPasswordResetAction,
  resendInvitationAction,
  resetAgentMfaAction,
  setAgentStatusAction,
  withdrawInvitationAction,
} from "@/lib/actions/agents";
import { formatDateTime, fullName } from "@/lib/format";
import { FilterBar } from "@/components/FilterBar";
import { Pagination, parsePage } from "@/components/Pagination";
import { RoleSelect } from "@/components/RoleSelect";
import { ActionButton, ActionForm, FieldError, SubmitButton } from "@/components/forms";
import {
  Card,
  CardHeader,
  EmptyState,
  Input,
  Select,
  StatusBadge,
  Table,
  Td,
  Th,
  TitleBlock,
} from "@/components/ui";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; role?: string; status?: string; page?: string };

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "disabled", label: "Disabled" },
];

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePagePermission(PERMISSIONS.ADMIN_USERS);
  const query = await searchParams;
  const q = query.q?.trim() ?? "";
  const role = query.role ?? "";
  const status = query.status ?? "";

  const [list, roles] = await Promise.all([
    listAgents(user.organizationId, { q, roleId: role, status }, parsePage(query.page)),
    listAssignableRoles(user.organizationId),
  ]);

  return (
    <>
      <TitleBlock
        title="Agents"
        description={`The people who work in ${user.organizationName}, and what each of them can do.`}
      />

      <Card>
        <div className="border-b border-ink-100 px-4 py-3">
          <FilterBar
            action="/admin/agents"
            searchName="q"
            searchValue={q}
            searchPlaceholder="Search name or email"
            filters={[
              {
                name: "role",
                label: "Role",
                value: role,
                anyLabel: "All roles",
                options: roles.map((r) => ({ value: r.id, label: r.name })),
              },
              {
                name: "status",
                label: "Status",
                value: status,
                anyLabel: "All statuses",
                options: STATUS_OPTIONS,
              },
            ]}
            count={list.total}
            countNoun="agent"
          />
        </div>

        {list.rows.length === 0 ? (
          <EmptyState
            title="No agents match"
            description="Change the search or filters, or invite someone below."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-12 text-end">#</Th>
                <Th>Person</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Last sign-in</Th>
                <Th className="text-end">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row, index) => {
                const isSelf = row.id === user.id;
                return (
                  <tr key={row.id}>
                    {/* Position in the whole list, so row 51 reads 51. */}
                    <Td className="text-end align-top">
                      <span className="doc-code text-[12px] text-ink-500">
                        {(list.page - 1) * list.pageSize + index + 1}
                      </span>
                    </Td>
                    <Td>
                      <p className="font-medium text-ink-900">
                        {fullName(row)}
                        {isSelf ? (
                          <span className="ms-2 text-[12px] font-normal text-ink-400">(you)</span>
                        ) : null}
                      </p>
                      <p className="text-[12px] text-ink-500">{row.email}</p>
                      {row.jobTitle ? (
                        <p className="text-[12px] text-ink-500">{row.jobTitle}</p>
                      ) : null}
                    </Td>
                    <Td>
                      <RoleSelect
                        action={changeAgentRoleAction}
                        userId={row.id}
                        roleId={row.roleId ?? ""}
                        roles={roles}
                      />
                    </Td>
                    <Td>
                      <StatusBadge status={row.status} />
                    </Td>
                    <Td className="text-ink-500">
                      {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "Never"}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-start justify-end gap-2">
                        {row.status === "invited" ? (
                          <>
                            <ActionButton
                              action={resendInvitationAction}
                              fields={{ userId: row.id }}
                            >
                              Resend invitation
                            </ActionButton>
                            <ActionButton
                              action={withdrawInvitationAction}
                              fields={{ userId: row.id }}
                              confirm={`Withdraw the invitation to ${row.email}? The account is removed.`}
                              variant="danger"
                            >
                              Withdraw
                            </ActionButton>
                          </>
                        ) : null}
                        {row.status === "active" ? (
                          <>
                            <ActionButton
                              action={issueAdminPasswordResetAction}
                              fields={{ userId: row.id }}
                              confirm={`Issue a password reset link for ${row.email}? Their current password keeps working until they use it.`}
                            >
                              Reset password
                            </ActionButton>
                            <ActionButton
                              action={resetAgentMfaAction}
                              fields={{ userId: row.id }}
                              confirm={`Reset two-step verification for ${fullName(row)}? They are signed out and must set it up again.`}
                            >
                              Reset 2-step
                            </ActionButton>
                            {isSelf ? null : (
                              <ActionButton
                                action={setAgentStatusAction}
                                fields={{ userId: row.id, status: "disabled" }}
                                confirm={`Disable ${fullName(row)}? They are signed out immediately.`}
                                variant="danger"
                              >
                                Disable
                              </ActionButton>
                            )}
                          </>
                        ) : null}
                        {row.status === "disabled" ? (
                          <ActionButton
                            action={setAgentStatusAction}
                            fields={{ userId: row.id, status: "active" }}
                          >
                            Enable
                          </ActionButton>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="px-4 pb-3">
          <Pagination
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            basePath="/admin/agents"
            params={{ q, role, status }}
            noun="agent"
          />
        </div>
      </Card>

      <Card className="mt-6 max-w-2xl">
        <CardHeader
          title="Invite an agent"
          description="They get an email with a link to choose a password. The link works for 30 days."
        />
        <div className="px-4 pb-4">
          <ActionForm action={inviteAgentAction} resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="firstName" className="block text-[13px] font-medium text-ink-800">
                  First name <span className="text-red-700">*</span>
                </label>
                <Input id="firstName" name="firstName" required maxLength={100} className="mt-1.5" />
                <FieldError name="firstName" />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-[13px] font-medium text-ink-800">
                  Last name <span className="text-red-700">*</span>
                </label>
                <Input id="lastName" name="lastName" required maxLength={100} className="mt-1.5" />
                <FieldError name="lastName" />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block text-[13px] font-medium text-ink-800">
                Email <span className="text-red-700">*</span>
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="off"
                className="mt-1.5"
              />
              <FieldError name="email" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="jobTitle" className="block text-[13px] font-medium text-ink-800">
                  Job title
                </label>
                <Input id="jobTitle" name="jobTitle" maxLength={100} className="mt-1.5" />
                <FieldError name="jobTitle" />
              </div>
              <div>
                <label htmlFor="roleId" className="block text-[13px] font-medium text-ink-800">
                  Role <span className="text-red-700">*</span>
                </label>
                <Select id="roleId" name="roleId" required defaultValue="" className="mt-1.5">
                  <option value="" disabled>
                    Select a role…
                  </option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
                <FieldError name="roleId" />
              </div>
            </div>

            <SubmitButton pendingLabel="Inviting…">Send invitation</SubmitButton>
          </ActionForm>
        </div>
      </Card>
    </>
  );
}
