"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/* Small, consistent 16px stroke icons — enough to make the groups scannable
 * without pulling in an icon library. */
function Icon({ name }: { name: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
      );
    case "dashboard":
      return (
        <svg {...common}>
          <path d="M2 13.5V9M6 13.5V4M10 13.5V7M14 13.5V2" />
        </svg>
      );
    case "documents":
      return (
        <svg {...common}>
          <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5Z" />
          <path d="M9 1.5V5.5H13" />
        </svg>
      );
    case "transmittals":
      return (
        <svg {...common}>
          <path d="M14 2 7 9" />
          <path d="M14 2l-4.5 12-2.5-5-5-2.5Z" />
        </svg>
      );
    case "mail":
      return (
        <svg {...common}>
          <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
          <path d="m2 4.5 6 4 6-4" />
        </svg>
      );
    case "workflows":
      return (
        <svg {...common}>
          <circle cx="4" cy="4" r="2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M4 6v4a2 2 0 0 0 2 2h4" />
        </svg>
      );
    case "organizations":
      return (
        <svg {...common}>
          <rect x="1.5" y="5.5" width="6" height="9" rx="1" />
          <rect x="8.5" y="1.5" width="6" height="13" rx="1" />
          <path d="M10.5 5h2M10.5 8h2M3.5 9h2" />
        </svg>
      );
    case "members":
      return (
        <svg {...common}>
          <circle cx="6" cy="5" r="2.5" />
          <path d="M1.5 14a4.5 4.5 0 0 1 9 0" />
          <path d="M11 3.2a2.5 2.5 0 0 1 0 4.6M12.2 14a4.5 4.5 0 0 0-1.6-3.4" />
        </svg>
      );
    case "roles":
      return (
        <svg {...common}>
          <path d="M8 1.5 3 3.5v4c0 3 2 5.5 5 7 3-1.5 5-4 5-7v-4Z" />
          <path d="m6 8 1.5 1.5L10.5 6.5" />
        </svg>
      );
    case "audit":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 4.5V8l2.5 1.5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * A tint per module, so the eye finds Mail or Workflows by colour before it
 * reads the label. Each is a light wash behind the icon rather than a filled
 * block — enough to give the rail some life without turning a working tool
 * into a toybox.
 *
 * These used to run across the spectrum — violet, cyan, indigo, emerald — which
 * separated eleven items cleanly and now reads as eleven brands. Warm hues
 * cannot spread that far, so the rail leans on depth as much as hue: the three
 * document modules take the gold itself at increasing strength, the people
 * modules take terracotta and rust, and the administrative ones stay neutral.
 *
 * Worth being honest that this is a trade. Distinguishing Transmittals from
 * Mail by two steps of warmth is harder than distinguishing violet from amber,
 * so the labels carry more of the load than they did.
 */
const ICON_TONES: Record<string, { idle: string; active: string }> = {
  dashboard: { idle: "bg-brand-50 text-brand-600", active: "bg-brand-100 text-brand-700" },
  overview: { idle: "bg-ink-100 text-ink-500", active: "bg-ink-200 text-ink-700" },
  documents: { idle: "bg-brand-100 text-brand-700", active: "bg-brand-200 text-brand-800" },
  transmittals: { idle: "bg-brand-50 text-brand-800", active: "bg-brand-200 text-brand-900" },
  mail: { idle: "bg-amber-50 text-amber-600", active: "bg-amber-100 text-amber-700" },
  workflows: { idle: "bg-orange-50 text-orange-600", active: "bg-orange-100 text-orange-700" },
  organizations: { idle: "bg-stone-100 text-stone-600", active: "bg-stone-200 text-stone-700" },
  members: { idle: "bg-rose-50 text-rose-500", active: "bg-rose-100 text-rose-600" },
  roles: { idle: "bg-red-50 text-red-700", active: "bg-red-100 text-red-800" },
  audit: { idle: "bg-ink-900/10 text-ink-700", active: "bg-ink-900/15 text-ink-900" },
  settings: { idle: "bg-ink-100 text-ink-500", active: "bg-ink-200 text-ink-700" },
};

export type SidebarItem = {
  href: string;
  label: string;
  icon: string;
  /** Rendered as a pill on the right. Omitted or zero renders nothing. */
  badge?: number;
  /** Draws attention — used where the count means "waiting on you". */
  badgeTone?: "neutral" | "action";
};

export type SidebarGroup = {
  label: string | null;
  items: SidebarItem[];
};

export function Sidebar({
  groups,
  header,
  label = "Section",
}: {
  groups: SidebarGroup[];
  /** Optional block above the groups, such as a heading or a switcher. */
  header?: ReactNode;
  /** The accessible name of the navigation landmark. */
  label?: string;
}) {
  const pathname = usePathname();

  // A root item's href is a prefix of its siblings' routes, so the active item
  // is the one with the longest href that matches the current path.
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const activeHref = groups
    .flatMap((group) => group.items.map((item) => item.href))
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === activeHref;

  return (
    <nav
      aria-label={label}
      /*
       * Sticks below the header, not 24px from the top of the viewport. The
       * application header is `sticky top-0` at z-20, so a rail pinned above it
       * scrolls underneath and loses its first item.
       *
       * 6rem is the bar's 88px plus a gap. This has to be changed with the
       * header height: there is no way to express "below the header" in CSS
       * alone when the header is sticky and the rail is a sibling.
       */
      className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7.5rem)] lg:overflow-y-auto"
    >
      {header}

      <div className={header ? "mt-5 space-y-5" : "space-y-5"}>
        {groups.map((group, index) => (
          <div key={group.label ?? `group-${index}`}>
            {group.label ? (
              <p className="field-label px-2.5 pb-1.5">{group.label}</p>
            ) : null}
            <ul className="space-y-px">
              {group.items.map((item) => {
                const active = isActive(item.href);
                const tone = ICON_TONES[item.icon] ?? ICON_TONES.overview;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={
                        active
                          ? "flex items-center gap-2.5 rounded-md bg-white px-2 py-1.5 text-[13px] font-medium text-ink-900 shadow-card ring-1 ring-inset ring-ink-200"
                          : "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-ink-600 transition-colors duration-100 hover:bg-white/70 hover:text-ink-900"
                      }
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-100 ${
                          active ? tone.active : tone.idle
                        }`}
                      >
                        <Icon name={item.icon} />
                      </span>
                      <span className="truncate">{item.label}</span>
                      {item.badge ? (
                        <span
                          className={
                            item.badgeTone === "action"
                              ? "ms-auto rounded-full bg-brand-600 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-white shadow-card"
                              : "ms-auto rounded-full bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-ink-600"
                          }
                        >
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

