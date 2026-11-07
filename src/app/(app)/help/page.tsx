import Link from "next/link";
import { requireAgent } from "@/lib/authz";
import { AUDIENCE_LABELS, topicsBySection, type Audience } from "@/lib/help/content";
import { Badge, Card, PageHeader } from "@/components/ui";

const audienceTone: Record<Audience, string> = {
  everyone: "neutral",
  "org-admin": "info",
  "system-admin": "warning",
};

export const metadata = {
  title: "User guide — Tadbeerly",
};

export default async function HelpIndexPage() {
  const user = await requireAgent();
  const groups = topicsBySection();

  return (
    <>
      <PageHeader
        title="User guide"
        description="Step-by-step instructions for what Tadbeerly does today, including administration."
      />

      <Card className="mb-6 border-brand-200 bg-brand-50/40 px-4 py-4">
        <p className="text-[13px] text-ink-800">
          New to Tadbeerly? Start with{" "}
          <Link
            href="/help/signing-in"
            className="font-medium text-brand-700 hover:text-brand-800"
          >
            Signing in
          </Link>
          . You are signed in as part of {user.organizationName}, and everything you
          see belongs to it. The ticket workspace arrives in the next milestone.
        </p>
      </Card>

      <div className="space-y-8">
        {groups.map((group) => (
          <section key={group.section}>
            <h2 className="field-label mb-3">{group.section}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {group.topics.map((topic) => (
                <Link key={topic.slug} href={`/help/${topic.slug}`}>
                  <Card className="h-full p-4 transition-colors duration-100 hover:border-brand-300">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[13px] font-semibold text-ink-900">
                        {topic.title}
                      </h3>
                      {topic.audience !== "everyone" ? (
                        <Badge tone={audienceTone[topic.audience]}>
                          {topic.audience === "org-admin" ? "Org admin" : "System admin"}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[13px] text-ink-500">{topic.summary}</p>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-8 text-[12px] text-ink-500">
        Topics marked <span className="font-medium">Org admin</span> or{" "}
        <span className="font-medium">System admin</span> describe tasks for{" "}
        {AUDIENCE_LABELS["org-admin"].toLowerCase()} and{" "}
        {AUDIENCE_LABELS["system-admin"].toLowerCase()}. You can read them
        regardless: the actions themselves are permission-checked.
      </p>
    </>
  );
}
