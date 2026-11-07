import Link from "next/link";

/*
 * The sign-in screen is set on a drawing sheet: a pale ground, a faint
 * drafting grid and a title block along the foot. The grid is drawn with
 * gradients rather than an image, so it costs nothing and stays crisp at any
 * zoom.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-paper text-ink-900 lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-e border-brand-200 bg-gradient-to-b from-brand-50 via-brand-50 to-brand-100 p-10 lg:flex xl:p-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgb(25 20 16 / 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgb(25 20 16 / 0.05) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        {/* A heavier rule every fifth square, the way a drafting grid reads. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgb(25 20 16 / 0.07) 1px, transparent 1px), linear-gradient(to bottom, rgb(25 20 16 / 0.07) 1px, transparent 1px)",
            backgroundSize: "140px 140px",
          }}
        />

        <Link href="/" className="relative inline-flex">
          <span className="text-[22px] font-semibold tracking-tight text-brand-800">
            Tadbeerly
          </span>
        </Link>

        <div className="relative max-w-lg border-s-2 border-brand-500/70 ps-7">
          <h2 className="text-[2rem] font-semibold leading-[1.15] tracking-tight xl:text-[2.35rem]">
            Every request, owned and answered.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-600">
            A help desk for your team: requests come in, get routed to the
            right agent, and are tracked to resolution.
          </p>
        </div>

        <dl className="relative flex rounded-md border border-brand-200 bg-white/60 backdrop-blur-sm">
          {[
            { label: "Module 01", value: "Tickets" },
            { label: "Module 02", value: "Self-service" },
            { label: "Module 03", value: "Administration" },
          ].map((cell, index) => (
            <div
              key={cell.label}
              className={
                index > 0
                  ? "flex-1 border-s border-brand-200 px-4 py-3"
                  : "flex-1 px-4 py-3"
              }
            >
              <dt className="font-mono text-[10px] uppercase tracking-[0.09em] text-brand-700">
                {cell.label}
              </dt>
              <dd className="mt-1 text-[13px] font-medium text-ink-800">{cell.value}</dd>
            </div>
          ))}
        </dl>
      </aside>

      <main className="flex flex-col items-center justify-center px-4 py-12 sm:px-8">
        <Link href="/" className="mb-8 lg:hidden">
          <span className="text-[22px] font-semibold tracking-tight text-brand-800">
            Tadbeerly
          </span>
        </Link>
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
