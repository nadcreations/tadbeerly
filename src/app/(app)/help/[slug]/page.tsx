import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/authz";
import {
  AUDIENCE_LABELS,
  HELP_TOPICS,
  getTopic,
  orderedTopics,
} from "@/lib/help/content";
import { HelpBlocks } from "@/components/HelpBlocks";
import { Badge, Card, TitleBlock } from "@/components/ui";

// Rendered per request: requireAgent reads the session, so there is nothing to
// prerender (and generateStaticParams would only pretend otherwise).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const topic = getTopic(slug);
  return { title: topic ? `${topic.title} — Tadbeerly guide` : "Tadbeerly guide" };
}

export default async function HelpTopicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Layouts are skipped on client navigation, so every page checks for itself.
  await requireAgent();

  const topic = getTopic(slug);
  if (!topic) notFound();

  const ordered = orderedTopics();
  const index = ordered.findIndex((t) => t.slug === slug);
  const previous = index > 0 ? ordered[index - 1] : null;
  const next = index < ordered.length - 1 ? ordered[index + 1] : null;

  const related = HELP_TOPICS.filter(
    (t) => t.section === topic.section && t.slug !== topic.slug,
  );

  return (
    <>
      <Link
        href="/help"
        className="mb-2 inline-block text-[13px] text-ink-500 hover:text-ink-800"
      >
        ← User guide
      </Link>
      <TitleBlock
        eyebrow={topic.section}
        title={topic.title}
        description={topic.summary}
        action={
          topic.audience !== "everyone" ? (
            <Badge tone="info">{AUDIENCE_LABELS[topic.audience]}</Badge>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <HelpBlocks blocks={topic.blocks} />
        </Card>

        <div className="space-y-6">
          {related.length > 0 ? (
            <Card className="p-5">
              <h2 className="field-label">More in {topic.section}</h2>
              <ul className="mt-3 space-y-2">
                {related.map((item) => (
                  <li key={item.slug}>
                    <Link
                      href={`/help/${item.slug}`}
                      className="text-[13px] font-medium text-brand-700 hover:text-brand-800"
                    >
                      {item.title}
                    </Link>
                    <p className="text-[12px] text-ink-500">{item.summary}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-stretch justify-between gap-3">
        {previous ? (
          <Link href={`/help/${previous.slug}`} className="min-w-56 flex-1">
            <Card className="h-full p-4 transition-colors duration-100 hover:border-brand-300">
              <p className="text-[12px] text-ink-500">← Previous</p>
              <p className="mt-0.5 text-[13px] font-medium text-ink-900">
                {previous.title}
              </p>
            </Card>
          </Link>
        ) : (
          <div className="min-w-56 flex-1" />
        )}
        {next ? (
          <Link href={`/help/${next.slug}`} className="min-w-56 flex-1">
            <Card className="h-full p-4 text-end transition-colors duration-100 hover:border-brand-300">
              <p className="text-[12px] text-ink-500">Next →</p>
              <p className="mt-0.5 text-[13px] font-medium text-ink-900">
                {next.title}
              </p>
            </Card>
          </Link>
        ) : (
          <div className="min-w-56 flex-1" />
        )}
      </div>
    </>
  );
}
