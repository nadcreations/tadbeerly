import { requireAgent } from "@/lib/authz";
import { visibleAdminNav } from "@/lib/adminNav";
import { Sidebar } from "@/components/Sidebar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Layouts are skipped on client navigation, so each page checks for itself too.
  const user = await requireAgent();

  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <Sidebar groups={visibleAdminNav(user)} label="Administration" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
