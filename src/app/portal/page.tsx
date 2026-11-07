import { requireUser } from "@/lib/authz";
import { Card, EmptyState, TitleBlock } from "@/components/ui";

export default async function PortalPage() {
  await requireUser();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <TitleBlock title="Requester portal" />
      <Card>
        <EmptyState title="The requester portal is coming soon." />
      </Card>
    </main>
  );
}
