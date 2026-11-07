import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/errors";
import type { ActionState } from "./types";

/**
 * Turns the expected, user-facing failures of a service call into an
 * ActionState. Anything else (including Next's redirect signals) is rethrown.
 * Lives outside the "use server" files: only actions belong there.
 */
export function serviceErrorState(error: unknown): ActionState {
  if (error instanceof ConflictError || error instanceof AuthorizationError) {
    return { error: error.message };
  }
  if (error instanceof NotFoundError) {
    return { error: "That person or role could not be found. Refresh and try again." };
  }
  throw error;
}
