import { requirePagePermission } from "@/lib/authz";
import { PERMISSIONS } from "@/lib/permissions";
import { AUDIT_ACTIONS } from "@/lib/audit";
import {
  auditActionLabel,
  listAuditActorOptions,
  listAuditEvents,
  parseDayBound,
} from "@/lib/auditQueries";
import { formatDateTime } from "@/lib/format";
import { FilterBar } from "@/components/FilterBar";
import { Pagination, parsePage } from "@/components/Pagination";
import { Card, EmptyState, Table, Td, Th, TitleBlock } from "@/components/ui";

export const dynamic = "force-dynamic";

type SearchParams = { action?: string; actor?: string; from?: string; to?: string; page?: string };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePagePermission(PERMISSIONS.ADMIN_AUDIT);
  const query = await searchParams;
  const action = query.action ?? "";
  const actor = query.actor ?? "";
  const fromDate = parseDayBound(query.from, "start");
  // The whole of the "to" day is included.
  const toDate = parseDayBound(query.to, "end");

  const [list, actors] = await Promise.all([
    listAuditEvents(
      user.organizationId,
      {
        action: action || undefined,
        actorUserId: actor || undefined,
        from: fromDate ?? undefined,
        to: toDate ?? undefined,
      },
      parsePage(query.page),
    ),
    listAuditActorOptions(user.organizationId),
  ]);

  const from = fromDate ? (query.from ?? "") : "";
  const to = toDate ? (query.to ?? "") : "";

  return (
    <>
      <TitleBlock
        title="Audit trail"
        description="Who did what, and when. Entries cannot be edited or removed."
      />

      <Card>
        <div className="border-b border-ink-100 px-4 py-3">
          <FilterBar
            action="/admin/audit"
            filters={[
              {
                name: "action",
                label: "Action",
                value: action,
                anyLabel: "All actions",
                options: AUDIT_ACTIONS.map((a) => ({ value: a, label: auditActionLabel(a) })),
              },
              {
                name: "actor",
                label: "Who",
                value: actor,
                anyLabel: "Anyone",
                options: actors.map((a) => ({ value: a.id, label: a.name })),
              },
            ]}
            dateRange={{ fromName: "from", toName: "to", from, to }}
            count={list.total}
            countNoun="entry"
          />
        </div>

        {list.rows.length === 0 ? (
          <EmptyState title="No entries match" description="Change the filters to see more." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Summary</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={row.id}>
                  <Td className="whitespace-nowrap">
                    <span className="doc-code text-[12px]">{formatDateTime(row.occurredAt)}</span>
                  </Td>
                  <Td>{row.actorName ?? "System"}</Td>
                  <Td className="whitespace-nowrap">{auditActionLabel(row.action)}</Td>
                  <Td className="text-ink-600">{row.summary}</Td>
                  <Td>
                    <span className="doc-code text-[12px]">{row.ipAddress ?? ""}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="px-4 pb-3">
          <Pagination
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            basePath="/admin/audit"
            params={{ action, actor, from, to }}
            noun="entry"
            nounPlural="entries"
          />
        </div>
      </Card>
    </>
  );
}
