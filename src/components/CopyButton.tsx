"use client";

import { useEffect, useState } from "react";

/**
 * Copies a value to the clipboard with brief confirmation.
 *
 * Falls back to revealing the text when the Clipboard API is unavailable —
 * over plain HTTP, or in a browser that refuses it — because an administrator
 * chasing a lost invitation still needs to get at the link somehow.
 */
export function CopyButton({
  value,
  label = "Copy link",
  copiedLabel = "Copied",
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("manual");
    }
  }

  if (state === "manual") {
    return (
      <input
        readOnly
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        aria-label={label}
        className="w-56 rounded border border-ink-300 px-2 py-1 text-[12px] text-ink-700"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={
        state === "copied"
          ? "rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700"
          : "rounded border border-ink-200 bg-white px-2.5 py-1 text-[12px] font-medium text-ink-700 hover:bg-ink-50"
      }
    >
      {state === "copied" ? copiedLabel : label}
    </button>
  );
}
