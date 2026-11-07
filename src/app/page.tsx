import { redirect } from "next/navigation";
import { homeFor } from "@/lib/authz";
import { getCurrentUser } from "@/lib/session";

export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? homeFor(user) : "/login");
}
