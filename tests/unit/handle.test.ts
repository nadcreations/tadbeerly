import { describe, expect, test } from "vitest";
import { serviceErrorState } from "@/lib/actions/handle";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/errors";

describe("serviceErrorState", () => {
  test("a NotFoundError shows its own message", () => {
    expect(serviceErrorState(new NotFoundError("That role could not be found."))).toEqual({
      error: "That role could not be found.",
    });
    expect(serviceErrorState(new NotFoundError("That organization could not be found."))).toEqual({
      error: "That organization could not be found.",
    });
  });

  test("conflicts and refusals show their own messages", () => {
    expect(serviceErrorState(new ConflictError("Taken."))).toEqual({ error: "Taken." });
    expect(serviceErrorState(new AuthorizationError("No."))).toEqual({ error: "No." });
  });

  test("anything else is rethrown", () => {
    const boom = new Error("boom");
    expect(() => serviceErrorState(boom)).toThrow(boom);
  });
});
