import type { AppEntry } from "../../../../../src/lib/config/settings-types";

/** Installation help is only appropriate for an explicit detection failure. */
export function isMissingAppError(raw: string | undefined, id: AppEntry["id"]): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { error?: { type?: unknown } } | null;
    return parsed?.error?.type === `${id}-not-installed`;
  } catch {
    return false;
  }
}
