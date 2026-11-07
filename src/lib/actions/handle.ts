import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/errors";
import type { ActionState } from "./types";

/**
 * Turns the expected, user-facing failures of a service call into an
 * ActionState. Anything else (including Next's redirect signals) is rethrown.
 * Lives outside the "use server" files: only actions belong there.
 */
export function serviceErrorState(error: unknown): ActionState {
  // Services write each message for the person reading it, NotFoundError's
  // included ("That role could not be found."), so it is shown as written.
  if (
    error instanceof ConflictError ||
    error instanceof AuthorizationError ||
    error instanceof NotFoundError
  ) {
    return { error: error.message };
  }
  throw error;
}
