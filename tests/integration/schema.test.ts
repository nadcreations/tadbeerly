import { beforeEach, describe, expect, test } from "vitest";
import { db } from "@/db";
import { roles, users } from "@/db/schema";
import { makeOrg, resetDb } from "../setup/factories";

beforeEach(resetDb);

describe("schema", () => {
  test("an agent must have a role", async () => {
    const org = await makeOrg();
    await expect(
      db.insert(users).values({
        organizationId: org.id,
        email: "a@x.example",
        firstName: "A",
        lastName: "B",
        kind: "agent",
      }),
    ).rejects.toThrow(/users_agent_has_role/);
  });

  test("emails are unique regardless of case", async () => {
    const org = await makeOrg();
    await db.insert(users).values({
      organizationId: org.id,
      email: "r@x.example",
      firstName: "R",
      lastName: "S",
      kind: "requester",
    });
    await expect(
      db.insert(users).values({
        organizationId: org.id,
        email: "R@X.example",
        firstName: "R",
        lastName: "S",
        kind: "requester",
      }),
    ).rejects.toThrow(/users_email_lower_idx/);
  });

  test("role keys are unique per organization, not globally", async () => {
    const [a, b] = [await makeOrg("A"), await makeOrg("B")];
    // "custom_x" rather than a template key: once Task 4 makes makeOrg clone
    // the templates, "agent" already exists.
    await db.insert(roles).values([
      { organizationId: a.id, key: "custom_x", name: "X" },
      { organizationId: b.id, key: "custom_x", name: "X" },
    ]);
    await expect(
      db
        .insert(roles)
        .values({ organizationId: a.id, key: "custom_x", name: "Again" }),
    ).rejects.toThrow();
  });
});
