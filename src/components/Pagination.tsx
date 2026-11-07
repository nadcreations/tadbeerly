import Link from "next/link";

/**
 * Page navigation for a filtered list.
 *
 * Renders nothing when everything fits on one page — a lone "1 of 1" is noise.
 * All other query parameters are carried through, so paging never silently
 * drops the filters that produced the list.
 */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
  noun,
  nounPlural,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  /** Current query params to preserve, excluding `page`. */
  params: Record<string, string | undefined>;
  noun: string;
  /** Supply where appending "s" is wrong — "entry" becomes "entries". */
  nounPlural?: string;
}) {
  const plural = nounPlural ?? `${noun}s`;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  function href(target: number): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value);
    }
    if (target > 1) query.set("page", String(target));
    const qs = query.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  if (total <= pageSize) {
    return (
      <p className="mt-3 text-[12px] text-ink-500">
        <span className="doc-code text-[12px] font-medium text-ink-800">
          {total}
        </span>{" "}
        {total === 1 ? noun : plural} in total.
      </p>
    );
  }

  // A window of pages around the current one, so a 60-page register does not
  // render 60 links.
  const window: number[] = [];
  const from = Math.max(1, page - 2);
  const to = Math.min(pageCount, page + 2);
  for (let i = from; i <= to; i += 1) window.push(i);

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-[12px] text-ink-500">
        Showing{" "}
        <span className="doc-code text-[12px] font-medium text-ink-800">
          {first}–{last}
        </span>{" "}
        of{" "}
        <span className="doc-code text-[12px] font-medium text-ink-800">
          {total}
        </span>{" "}
        {total === 1 ? noun : plural}
      </p>

      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link
            href={href(page - 1)}
            rel="prev"
            className="rounded-md border border-ink-200 bg-white px-2.5 py-1 text-[12px] font-medium text-ink-700 transition-colors duration-100 hover:border-ink-300 hover:bg-ink-50"
          >
            ← Previous
          </Link>
        ) : (
          <span className="rounded-md border border-ink-100 px-2.5 py-1 text-[12px] font-medium text-ink-300">
            ← Previous
          </span>
        )}

        {from > 1 ? (
          <>
            <Link
              href={href(1)}
              className="rounded-md px-2 py-1 font-mono text-[12px] font-medium text-ink-600 transition-colors duration-100 hover:bg-ink-100"
            >
              1
            </Link>
            {from > 2 ? (
              <span className="px-1 text-[12px] text-ink-400">…</span>
            ) : null}
          </>
        ) : null}

        {window.map((target) => (
          <Link
            key={target}
            href={href(target)}
            aria-current={target === page ? "page" : undefined}
            className={
              target === page
                ? "rounded-md bg-ink-900 px-2 py-1 font-mono text-[12px] font-medium text-white"
                : "rounded-md px-2 py-1 font-mono text-[12px] font-medium text-ink-600 transition-colors duration-100 hover:bg-ink-100"
            }
          >
            {target}
          </Link>
        ))}

        {to < pageCount ? (
          <>
            {to < pageCount - 1 ? (
              <span className="px-1 text-[12px] text-ink-400">…</span>
            ) : null}
            <Link
              href={href(pageCount)}
              className="rounded-md px-2 py-1 font-mono text-[12px] font-medium text-ink-600 transition-colors duration-100 hover:bg-ink-100"
            >
              {pageCount}
            </Link>
          </>
        ) : null}

        {page < pageCount ? (
          <Link
            href={href(page + 1)}
            rel="next"
            className="rounded-md border border-ink-200 bg-white px-2.5 py-1 text-[12px] font-medium text-ink-700 transition-colors duration-100 hover:border-ink-300 hover:bg-ink-50"
          >
            Next →
          </Link>
        ) : (
          <span className="rounded-md border border-ink-100 px-2.5 py-1 text-[12px] font-medium text-ink-300">
            Next →
          </span>
        )}
      </div>
    </nav>
  );
}

/** Reads and clamps a `page` query parameter. */
export function parsePage(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(Math.floor(value), 10_000);
}
