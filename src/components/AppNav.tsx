"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type NavLink = { href: string; label: string };

/**
 * Primary navigation and the account menu.
 *
 * The sign-out control is passed in rather than imported, so the server action
 * stays on the server side of the boundary and this file remains a thin piece
 * of interaction.
 */
export function AppNav({
  links,
  name,
  organization,
  email,
  initials,
  signOut,
}: {
  links: NavLink[];
  name: string;
  organization: string;
  email: string;
  initials: string;
  signOut: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <>
      <nav aria-label="Main" className="flex items-center gap-0.5">
        {links.map((link) => {
          const active =
            pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "relative rounded-md px-2.5 py-1.5 text-[13px] font-medium text-ink-900 after:absolute after:inset-x-2.5 after:-bottom-[10px] after:h-0.5 after:bg-brand-500"
                  : "rounded-md px-2.5 py-1.5 text-[13px] font-medium text-ink-600 transition-colors duration-100 hover:bg-brand-100 hover:text-ink-900"
              }
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <AccountMenu
        name={name}
        organization={organization}
        email={email}
        initials={initials}
        signOut={signOut}
      />
    </>
  );
}

function AccountMenu({
  name,
  organization,
  email,
  initials,
  signOut,
}: {
  name: string;
  organization: string;
  email: string;
  initials: string;
  signOut: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative ms-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-md py-1 ps-1 pe-1.5 transition-colors duration-100 hover:bg-brand-100"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-600 to-brand-800 font-mono text-[11px] font-medium tracking-tight text-white shadow-card">
          {initials}
        </span>
        <span className="hidden leading-tight sm:block">
          <span className="block text-[13px] font-medium text-ink-900">
            {name}
          </span>
          <span className="block text-[11px] text-ink-500">{organization}</span>
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-ink-400"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute end-0 top-full z-30 mt-1.5 w-60 rounded-lg border border-ink-200 bg-white py-1 shadow-pop"
        >
          <div className="border-b border-ink-100 px-3 pb-2 pt-1.5">
            <p className="truncate text-[13px] font-medium text-ink-900">
              {name}
            </p>
            <p className="truncate font-mono text-[11px] text-ink-500">
              {email}
            </p>
          </div>
          <Link
            href="/security"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-1.5 text-[13px] text-ink-700 hover:bg-brand-50 hover:text-brand-800"
          >
            Security
          </Link>
          <Link
            href="/help"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-1.5 text-[13px] text-ink-700 hover:bg-brand-50 hover:text-brand-800"
          >
            Help
          </Link>
          <div className="mt-1 border-t border-ink-100 pt-1">{signOut}</div>
        </div>
      ) : null}
    </div>
  );
}

