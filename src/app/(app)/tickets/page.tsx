import { Card, EmptyState, TitleBlock } from "@/components/ui";

export default function TicketsPage() {
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
