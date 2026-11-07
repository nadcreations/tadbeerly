import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { mfaGateRedirect } from "@/lib/mfa";
import { PERMISSIONS } from "@/lib/permissions";
import { can, requireAgent } from "@/lib/authz";
import { logout } from "@/lib/actions/auth";
import { initials } from "@/lib/format";
import { AppNav, type NavLink } from "@/components/AppNav";

const ADMIN_PERMISSIONS = [
  PERMISSIONS.ADMIN_USERS,
  PERMISSIONS.ADMIN_ROLES,
  PERMISSIONS.ADMIN_CONFIG,
  PERMISSIONS.ADMIN_AUDIT,
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAgent();

  // Unenrolled users who must use MFA (organization policy, or the locked
  // Administrator role) can reach only the security page until they enrol.
  const pathname = (await headers()).get("x-tb-pathname") ?? "";
  const gate = mfaGateRedirect(user, pathname);
  if (gate) redirect(gate);

  const links: NavLink[] = [{ href: "/tickets", label: "Tickets" }];
  if (ADMIN_PERMISSIONS.some((p) => can(user, p))) {
    links.push({ href: "/admin", label: "Admin" });
  }
  links.push({ href: "/help", label: "Help" });

  return (
    <div className="flex min-h-screen flex-col">
      {/*
        A sheet, not a band: the same drafting ground as the sign-in panel, with
        a deeper cream than the page, a brand hairline and the card shadow as
        four quiet cues that this is chrome. It stays put on scroll, and it is
        opaque so the page never shows through and shifts its tone.

        The ground and grid are literals sampled from the artwork (paper
        #faf5ef falling to #f5f0ea, a 16px pitch on the 88px bar), not steps on
        a scale, so they are not tokens.
      */}
      <header className="sticky top-0 z-20 border-b border-brand-300 bg-gradient-to-b from-[#faf5ef] to-[#f5f0ea] shadow-card">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgb(25 20 16 / 0.055) 1px, transparent 1px), linear-gradient(to bottom, rgb(25 20 16 / 0.055) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        />
        <div className="relative mx-auto flex h-22 max-w-[105rem] items-center gap-5 px-4 sm:px-6">
          <Link href="/tickets" className="shrink-0 rounded-md">
            <span className="text-[22px] font-semibold tracking-tight text-brand-800">
              Tadbeerly
            </span>
          </Link>

          <span aria-hidden="true" className="h-7 w-px bg-brand-300" />

          <AppNav
            links={links}
            name={`${user.firstName} ${user.lastName}`}
            organization={user.organizationName}
            email={user.email}
            initials={initials(user)}
            signOut={
              <form action={logout}>
                <button
                  type="submit"
                  className="block w-full px-3 py-1.5 text-start text-[13px] text-ink-700 hover:bg-brand-50 hover:text-brand-800"
                >
                  Sign out
                </button>
              </form>
            }
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[105rem] flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
