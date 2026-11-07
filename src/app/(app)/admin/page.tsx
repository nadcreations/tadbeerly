import { notFound, redirect } from "next/navigation";
import { requireAgent } from "@/lib/authz";
import { visibleAdminNav } from "@/lib/adminNav";

/** The admin area has no page of its own: it opens on the first thing you can use. */
export default async function AdminIndexPage() {
  const user = await requireAgent();
  const first = visibleAdminNav(user)[0]?.items[0];
  if (!first) notFound();
  redirect(first.href);
}
