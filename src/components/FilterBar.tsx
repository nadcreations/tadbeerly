"use client";

import { useEffect, useRef, useState } from "react";

export type FilterDefinition = {
  name: string;
  label: string;
  /** Currently applied value, or "" for none. */
  value: string;
  /** The "no filter" entry, e.g. "All types". */
  anyLabel: string;
  options: { value: string; label: string }[];
};

/**
 * One-row filter toolbar: search, a filters popover, and chips for whatever is
 * applied.
 *
 * It stays a plain GET form so the URL remains the source of truth — every
 * filtered view is linkable and survives a refresh. The selects live in the
 * DOM whether or not the popover is open, because unmounting them would drop
 * their values from the submission.
 */
export function FilterBar({
  action,
  searchName,
  searchValue = "",
  searchPlaceholder,
  filters,
  dateRange,
  preserve = {},
  count,
  countNoun,
}: {
  action: string;
  /** Omit all three for a list with nothing to search by free text. */
  searchName?: string;
  searchValue?: string;
  searchPlaceholder?: string;
  filters: FilterDefinition[];
  /**
   * An optional pair of date inputs, for the one thing a select cannot express.
   * Omitted by every caller that does not need it, so no existing filter bar
   * changes shape.
   */
  dateRange?: { fromName: string; toName: string; from: string; to: string };
  /** Params carried through untouched, e.g. the active scope tab. */
  preserve?: Record<string, string>;
  count: number;
  countNoun: string;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!popoverRef.current?.parentElement?.contains(event.target as Node)) {
        setOpen(false);
      }
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

  const active = filters.filter((filter) => filter.value);
  const datesApplied = Boolean(dateRange?.from || dateRange?.to);
  const hasAnything = active.length > 0 || searchValue !== "" || datesApplied;

  /** Clears one filter by name and reapplies immediately. */
  function clearFilter(name: string) {
    const form = formRef.current;
    if (!form) return;
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLSelectElement) field.value = "";
    form.requestSubmit();
  }

  function clearSearch() {
    const form = formRef.current;
    if (!form) return;
    const field = searchName ? form.elements.namedItem(searchName) : null;
    if (field instanceof HTMLInputElement) field.value = "";
    form.requestSubmit();
  }

  /** Clears both ends at once — half a range is rarely what was meant. */
  function clearDates() {
    const form = formRef.current;
    if (!form || !dateRange) return;
    for (const name of [dateRange.fromName, dateRange.toName]) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLInputElement) field.value = "";
    }
    form.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      method="get"
      action={action}
      className="rounded-lg border border-ink-200 bg-white"
    >
      {Object.entries(preserve).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        {searchName ? (
        <div className="relative min-w-48 flex-1">
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-400"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            type="search"
            name={searchName}
            defaultValue={searchValue}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full rounded-md border border-ink-200 bg-white py-1.5 ps-8 pe-3 text-[13px] text-ink-900 transition-colors duration-100 placeholder:text-ink-400 hover:border-ink-300 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          />
        </div>
        ) : (
          <div className="flex-1" />
        )}

        {filters.length > 0 || dateRange ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className={
                active.length > 0 || datesApplied
                  ? "flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1.5 text-[13px] font-medium text-brand-800"
                  : "flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-ink-700 transition-colors duration-100 hover:border-ink-300"
              }
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M2 4h12M4.5 8h7M6.5 12h3" />
              </svg>
              Filters
              {active.length + (datesApplied ? 1 : 0) > 0 ? (
                <span className="rounded-sm bg-brand-600 px-1.5 font-mono text-[10px] font-medium leading-4 text-white">
                  {active.length + (datesApplied ? 1 : 0)}
                </span>
              ) : null}
            </button>

            <div
              ref={popoverRef}
              className={
                open
                  ? "absolute end-0 top-full z-20 mt-1 w-72 rounded-lg border border-ink-200 bg-white p-3 shadow-pop"
                  : "hidden"
              }
            >
              <div className="space-y-3">
                {filters.map((filter) => (
                  <div key={filter.name}>
                    <label
                      htmlFor={`filter-${filter.name}`}
                      className="field-label block"
                    >
                      {filter.label}
                    </label>
                    <select
                      id={`filter-${filter.name}`}
                      name={filter.name}
                      defaultValue={filter.value}
                      onChange={() => formRef.current?.requestSubmit()}
                      className="mt-1 block w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-[13px] text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
                    >
                      <option value="">{filter.anyLabel}</option>
                      {filter.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}

                {dateRange ? (
                  <div>
                    <span className="field-label block">Date range</span>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="date"
                        name={dateRange.fromName}
                        defaultValue={dateRange.from}
                        aria-label="From date"
                        className="w-full rounded-md border border-ink-300 bg-white px-2 py-1.5 text-[13px] text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
                      />
                      <span className="text-[12px] text-ink-500">to</span>
                      <input
                        type="date"
                        name={dateRange.toName}
                        defaultValue={dateRange.to}
                        aria-label="To date"
                        className="w-full rounded-md border border-ink-300 bg-white px-2 py-1.5 text-[13px] text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
                      />
                    </div>
                    {/* Dates do not apply themselves on change: a range is
                        half-typed for most of the time it is being entered. */}
                    <p className="mt-1 text-[12px] text-ink-500">
                      Both ends are inclusive.
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 flex justify-between border-t border-ink-100 pt-2.5">
                <a
                  href={action}
                  className="text-[12px] font-medium text-ink-500 hover:text-ink-800"
                >
                  Clear all
                </a>
                <button
                  type="submit"
                  className="text-[12px] font-medium text-brand-700 hover:text-brand-800"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <span className="ms-auto whitespace-nowrap text-[13px] text-ink-500">
          <span className="doc-code text-[13px] font-medium text-ink-800">
            {count}
          </span>{" "}
          {countNoun}
        </span>
      </div>

      {hasAnything ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-100 px-3 py-2">
          {searchValue ? (
            <Chip label={`Search: ${searchValue}`} onRemove={clearSearch} />
          ) : null}
          {datesApplied ? (
            <Chip
              label={`Date: ${dateRange?.from || "any"} to ${dateRange?.to || "any"}`}
              onRemove={clearDates}
            />
          ) : null}
          {active.map((filter) => (
            <Chip
              key={filter.name}
              label={`${filter.label}: ${
                filter.options.find((o) => o.value === filter.value)?.label ??
                filter.value
              }`}
              onRemove={() => clearFilter(filter.name)}
            />
          ))}
          <a
            href={action}
            className="ms-1 text-[12px] font-medium text-ink-500 hover:text-ink-800"
          >
            Clear all
          </a>
        </div>
      ) : null}
    </form>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-ink-200 bg-ink-50 py-0.5 ps-2 pe-1 text-[12px] text-ink-700">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="rounded-full p-0.5 text-ink-400 hover:bg-ink-200 hover:text-ink-800"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </span>
  );
}

/**
 * Scope tabs shown beneath the toolbar. Kept separate from filters because a
 * scope is a different kind of choice — it changes which set you are looking
 * at, not which rows within it.
 */
export function ScopeTabs({
  tabs,
}: {
  tabs: { href: string; label: string; count?: number; active: boolean }[];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {tabs.map((tab) => (
        <a
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={
            tab.active
              ? "flex items-center gap-1.5 rounded-md bg-ink-900 px-2.5 py-1 text-[12px] font-medium text-white"
              : "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium text-ink-600 transition-colors duration-100 hover:bg-ink-100"
          }
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span
              className={
                tab.active
                  ? "font-mono text-[11px] text-white/70"
                  : "font-mono text-[11px] text-ink-400"
              }
            >
              {tab.count}
            </span>
          ) : null}
        </a>
      ))}
    </div>
  );
}
