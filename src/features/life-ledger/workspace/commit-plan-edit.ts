import type { LifePlan } from '../domain';

/** Timestamp accepted edits, not previews, hydration, exports or undo snapshots. */
export function commitPlanEdit(
  current: LifePlan,
  next: LifePlan,
  updatedAt: string
): LifePlan {
  if (next === current) return current;
  return { ...next, metadata: { ...next.metadata, updatedAt } };
}
