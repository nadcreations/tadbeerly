import { requireAgent } from "@/lib/authz";
import { Card, EmptyState, TitleBlock } from "@/components/ui";

export default async function TicketsPage() {
  // Layouts are skipped on client navigation, so every page checks for itself.
  await requireAgent();
  return (
    <>
      <TitleBlock title="Tickets" />
      <Card>
        <EmptyState
          title="No tickets yet"
          description="Ticket intake arrives in the next milestone."
        />
      </Card>
    </>
  );
}
