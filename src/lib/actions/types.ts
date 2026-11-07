export type ActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
};

export const emptyState: ActionState = {};

/** Turns a ZodError's flattened field errors into our ActionState shape. */
export function fieldErrorsFrom(
  flattened: Record<string, string[] | undefined>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(flattened)) {
    if (value?.length) out[key] = value;
  }
  return out;
}
