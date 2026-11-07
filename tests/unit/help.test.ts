import { expect, test } from "vitest";
import {
  HELP_SECTIONS,
  HELP_TOPICS,
  getTopic,
  orderedTopics,
  topicsBySection,
} from "@/lib/help/content";

test("help topics are well formed", () => {
  const slugs = HELP_TOPICS.map((t) => t.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
  for (const t of HELP_TOPICS) {
    expect(HELP_SECTIONS).toContain(t.section);
    expect(t.title.length).toBeGreaterThan(0);
    expect(t.summary.length).toBeGreaterThan(0);
    expect(t.blocks.length).toBeGreaterThan(0);
  }
});

test("the M0 topics exist", () => {
  expect(HELP_TOPICS.map((t) => t.slug).sort()).toEqual(
    [
      "email-delivery",
      "inviting-agents",
      "organization-settings",
      "resetting-your-password",
      "roles-and-permissions",
      "signing-in",
      "the-audit-trail",
      "two-factor-authentication",
    ].sort(),
  );
});

test("lookups follow the section order", () => {
  expect(getTopic("signing-in")?.section).toBe("Getting started");
  expect(getTopic("nope")).toBeUndefined();
  expect(topicsBySection().map((g) => g.section)).toEqual([...HELP_SECTIONS]);
  expect(orderedTopics()).toHaveLength(HELP_TOPICS.length);
  expect(orderedTopics()[0].section).toBe(HELP_SECTIONS[0]);
});
