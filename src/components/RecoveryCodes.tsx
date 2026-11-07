"use client";

import { CopyButton } from "./CopyButton";

/**
 * Shows recovery codes once, immediately after they are generated.
 *
 * Only hashes are stored, so this is the single moment the plaintext exists
 * anywhere the user can reach — the copy for that is deliberately blunt.
 */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
      <h3 className="text-[13px] font-semibold text-amber-900">
        Save these recovery codes now
      </h3>
      <p className="mt-1 text-[13px] text-amber-800">
        Each one signs you in once if you lose your phone. They are not shown
        again — we only keep a hash, so nobody, including an administrator, can
        retrieve them for you later.
      </p>

      <ul className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-2">
        {codes.map((code) => (
          <li
            key={code}
            className="rounded border border-amber-200 bg-white px-2.5 py-1.5 text-center font-mono text-[13px] tracking-wider text-ink-900"
          >
            {code}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <CopyButton value={codes.join("\n")} label="Copy all codes" />
        <a
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(
            `Tadbeerly recovery codes\n\nEach code can be used once.\n\n${codes.join("\n")}\n`,
          )}`}
          download="tadbeerly-recovery-codes.txt"
          className="rounded border border-ink-200 bg-white px-2.5 py-1 text-[12px] font-medium text-ink-700 hover:bg-ink-50"
        >
          Download as a file
        </a>
      </div>
    </div>
  );
}
