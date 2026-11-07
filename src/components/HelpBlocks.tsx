import type { HelpBlock } from "@/lib/help/content";
import { tableHeadClass } from "./ui";

/*
 * The guide is the one place in Tadbeerly that is read rather than scanned, so it
 * deliberately runs against the 13px register rhythm used everywhere else:
 * prose sits at 15px with relaxed leading. Tables stay dense, because a table
 * is data even when it appears inside an article.
 */

const noteStyles: Record<string, { wrap: string; label: string }> = {
  info: {
    wrap: "border-brand-200 bg-brand-50/60",
    label: "text-brand-800",
  },
  warning: {
    wrap: "border-amber-200 bg-amber-50/70",
    label: "text-amber-900",
  },
  tip: {
    wrap: "border-emerald-200 bg-emerald-50/70",
    label: "text-emerald-800",
  },
};

const noteTitles: Record<string, string> = {
  info: "Note",
  warning: "Important",
  tip: "Tip",
};

/* The note label cannot use the field-label utility: that utility fixes a
 * colour, and each tone needs its own. Same shape, stated inline. */
const noteLabelBase =
  "font-mono text-[10px] font-medium uppercase leading-none tracking-[0.09em]";

/** Renders one help topic's content. Pure presentation, no data access. */
export function HelpBlocks({ blocks }: { blocks: HelpBlock[] }) {
  return (
    <div className="space-y-5">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "para":
            return (
              <p key={index} className="text-[15px] leading-relaxed text-ink-700">
                {block.text}
              </p>
            );

          case "subheading":
            return (
              <h2
                key={index}
                className="border-b border-ink-200 pb-2 pt-3 text-base font-semibold tracking-tight text-ink-900"
              >
                {block.text}
              </h2>
            );

          case "steps":
            return (
              <div key={index}>
                {block.title ? (
                  <p className="mb-2.5 text-[15px] font-medium text-ink-900">
                    {block.title}
                  </p>
                ) : null}
                {/* Numbered because these genuinely are a sequence — the order
                    is instruction, not decoration. */}
                <ol className="space-y-2.5">
                  {block.items.map((item, i) => (
                    <li
                      key={i}
                      className="flex gap-3 text-[15px] leading-relaxed text-ink-700"
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-ink-900 font-mono text-[11px] font-medium text-white">
                        {i + 1}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </div>
            );

          case "list":
            return (
              <ul key={index} className="space-y-2">
                {block.items.map((item, i) => (
                  <li
                    key={i}
                    className="flex gap-3 text-[15px] leading-relaxed text-ink-700"
                  >
                    {/* A short rule rather than a bullet — it reads as a
                        leader line on a drawing schedule. */}
                    <span
                      aria-hidden="true"
                      className="mt-3 h-px w-2.5 shrink-0 bg-ink-300"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            );

          case "note": {
            const style = noteStyles[block.tone] ?? noteStyles.info;
            return (
              <div
                key={index}
                className={`rounded-md border px-4 py-3 ${style.wrap}`}
              >
                <p className={`${noteLabelBase} ${style.label}`}>
                  {noteTitles[block.tone] ?? "Note"}
                </p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-700">
                  {block.text}
                </p>
              </div>
            );
          }

          case "table":
            return (
              <div
                key={index}
                className="overflow-x-auto rounded-md border border-ink-200"
              >
                <table className="tb-table w-full text-start text-[13px]">
                  <thead>
                    <tr>
                      {block.head.map((cell) => (
                        <th key={cell} className={tableHeadClass}>
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, i) => (
                      <tr key={i} className="align-top">
                        {row.map((cell, j) => (
                          <td
                            key={j}
                            className={`border-b border-ink-100 px-4 py-2.5 leading-relaxed ${
                              j === 0
                                ? "font-medium text-ink-900"
                                : "text-ink-700"
                            }`}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "code":
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-md bg-ink-900 px-4 py-3 font-mono text-[12px] leading-relaxed text-ink-100"
              >
                <code>{block.text}</code>
              </pre>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}
