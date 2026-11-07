import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------- Buttons -------------------------------- */

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium leading-5 transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-45";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white shadow-card hover:bg-brand-700",
  secondary:
    "border border-ink-200 bg-white text-ink-800 shadow-card hover:border-ink-300 hover:bg-ink-50",
  danger: "bg-red-600 text-white shadow-card hover:bg-red-700",
  ghost: "text-ink-600 hover:bg-brand-50 hover:text-brand-800",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cx(buttonBase, buttonVariants[variant], className)}
    />
  );
}

export function LinkButton({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return (
    <Link
      {...props}
      className={cx(buttonBase, buttonVariants[variant], className)}
    />
  );
}

/* -------------------------------- Cards --------------------------------- */

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cx(
        "rounded-lg border border-ink-200 bg-white shadow-card",
        className,
      )}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    /*
     * Tinted so a page of stacked cards reads as separate sections rather than
     * one continuous sheet — on the document page there are five of them in a
     * column, and a white header on a white body gave no edge to catch.
     *
     * The top corners are rounded here rather than clipping the whole Card with
     * overflow-hidden, which would cut off any popover opened inside one.
     */
    <div className="flex items-start justify-between gap-4 rounded-t-lg border-b border-brand-100 bg-brand-50 px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-tight text-brand-900">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-[13px] leading-snug text-ink-600">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------ Title block ------------------------------ */

export type TitleBlockField = {
  label: string;
  value: ReactNode;
  /** Renders the value as a controlled reference — codes, revisions, numbers. */
  code?: boolean;
};

/**
 * The page header, borrowed from the one device everybody in this industry
 * already reads without thinking: the title block in the corner of a drawing.
 *
 * A drawing's title block answers "what is this, which revision, and is it
 * current?" in a single ruled strip. The same four or five answers are what
 * somebody opening a register, a transmittal or a workflow needs first, so the
 * header states them in the same form — small uppercase labels over values,
 * divided by hairlines.
 */
export function TitleBlock({
  eyebrow,
  title,
  description,
  fields = [],
  action,
}: {
  /** The line above the title — a parent reference, not a breadcrumb trail. */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  fields?: TitleBlockField[];
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 overflow-hidden rounded-lg border border-ink-200 bg-white shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-3.5">
        <div className="min-w-0">
          {eyebrow ? <p className="field-label mb-1">{eyebrow}</p> : null}
          <h1 className="text-lg font-semibold leading-tight tracking-tight text-ink-900">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-[13px] leading-snug text-ink-500">
              {description}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 items-center gap-2">{action}</div>
        ) : null}
      </div>

      {fields.length > 0 ? (
        <dl className="flex flex-wrap border-t border-brand-100 bg-brand-50/50">
          {fields.map((field, index) => (
            <div
              key={field.label}
              className={cx(
                "min-w-0 flex-1 basis-40 px-4 py-2.5",
                index > 0 && "border-brand-100 sm:border-s",
              )}
            >
              <dt className="field-label">{field.label}</dt>
              <dd
                className={cx(
                  "mt-1 truncate text-[13px] text-ink-900",
                  field.code && "doc-code font-medium",
                )}
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** A controlled reference rendered in the register's own idiom. */
export function DocCode({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("doc-code text-[13px] font-medium text-ink-900", className)}>
      {children}
    </span>
  );
}

/**
 * Kept so pages written against the first build keep working. New pages should
 * reach for TitleBlock, which says considerably more in the same space.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <TitleBlock title={title} description={description} action={action} />
  );
}

/* ------------------------------- Form bits ------------------------------ */

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string[];
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-[13px] font-medium text-ink-800"
      >
        {label}
        {required ? <span className="ms-0.5 text-red-700">*</span> : null}
      </label>
      {children}
      {hint && !error?.length ? (
        <p className="text-[12px] leading-snug text-ink-500">{hint}</p>
      ) : null}
      {error?.length ? (
        <p className="text-[12px] leading-snug text-red-700">{error.join(" ")}</p>
      ) : null}
    </div>
  );
}

const controlClass =
  "block w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-[13px] text-ink-900 transition-colors duration-100 placeholder:text-ink-400 hover:border-ink-400 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:bg-ink-50 disabled:text-ink-500";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(controlClass, className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(controlClass, className)} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cx(controlClass, className)} />;
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-md border border-rose-200 border-s-2 border-s-rose-500 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
      {message}
    </div>
  );
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-md border border-emerald-200 border-s-2 border-s-emerald-500 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
      {message}
    </div>
  );
}

/* -------------------------------- Badges -------------------------------- */

/*
 * Statuses read as stamps rather than pills: rectangular, uppercase, mono. A
 * drawing marked SUPERSEDED carries that mark in a box, and borrowing the form
 * makes state legible at a glance down a column.
 */
/*
 * Status colour stays semantic: green is active, red is suspended, and no
 * amount of house style is worth making those two agree with the furniture.
 *
 * `warning` moved from amber to orange when the brand went gold. Amber against
 * a gold `info` badge was two pale warm stamps a shade apart — fine in
 * isolation, indistinguishable side by side in a register column, which is
 * exactly where they appear.
 */
const badgeTones: Record<string, string> = {
  neutral: "bg-ink-100 text-ink-600 ring-ink-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-orange-50 text-orange-700 ring-orange-200",
  danger: "bg-rose-50 text-rose-700 ring-rose-200",
  info: "bg-brand-100 text-brand-800 ring-brand-300",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof badgeTones | string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase leading-4 tracking-[0.07em] ring-1 ring-inset",
        badgeTones[tone] ?? badgeTones.neutral,
      )}
    >
      {children}
    </span>
  );
}

/** Maps the domain status enums onto badge tones. */
export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "success"
      : status === "invited" || status === "pending" || status === "setup"
        ? "warning"
        : status === "suspended" || status === "disabled" || status === "declined"
          ? "danger"
          : status === "archived" || status === "withdrawn" || status === "revoked"
            ? "neutral"
            : "info";
  return <Badge tone={tone}>{status.replace(/_/g, " ")}</Badge>;
}

/* -------------------------------- Tables -------------------------------- */

export function Table({
  children,
  wide = false,
}: {
  children: ReactNode;
  /**
   * Lets the columns take the width they need and scroll the container, rather
   * than compressing them until the text wraps. For a register of twenty
   * columns, a row that wraps to three lines is harder to read than one that
   * runs off the side — the eye can follow a row, it cannot follow a paragraph.
   */
  wide?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      {/* tb-table carries the striping and row hover — see globals.css. */}
      <table
        className={cx(
          "tb-table text-start text-[13px]",
          wide ? "w-max min-w-full" : "w-full",
        )}
      >
        {children}
      </table>
    </div>
  );
}

/**
 * The column-header treatment, stated in full rather than composed from the
 * field-label utility.
 *
 * field-label fixes its own colour and weight, and both are single-class
 * selectors — layering `font-semibold` or `text-ink-700` on top would leave the
 * winner down to Tailwind's emit order rather than intent. Spelling it out here
 * makes the header unambiguous, and gives one place for anything else that
 * needs to match (see HelpBlocks).
 */
export const tableHeadClass =
  "whitespace-nowrap border-b border-ink-300 bg-ink-200 px-4 py-2.5 text-start font-mono text-[10px] font-bold uppercase leading-tight tracking-[0.09em] text-ink-800";

export function Th({ children, className }: ComponentProps<"th">) {
  return <th className={cx(tableHeadClass, className)}>{children}</th>;
}

export function Td({ children, className }: ComponentProps<"td">) {
  return (
    <td className={cx("border-b border-ink-100 px-4 py-2.5 align-middle", className)}>
      {children}
    </td>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-[13px] font-medium text-ink-800">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-[13px] leading-snug text-ink-500">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
