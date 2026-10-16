import type { LifePlan } from '../domain';

/** Timestamp accepted edits, not previews, hydration, exports or undo snapshots. */
export function commitPlanEdit(
  current: LifePlan,
  next: LifePlan,
  updatedAt: string
): LifePlan {
  if (next === current) return current;
  return {
    ...next,
    assets: next.assets.map((asset) =>
      asset.annualReturnBps === 0
        ? asset
        : {
            ...asset,
            annualReturnBps: 0 as LifePlan['assets'][number]['annualReturnBps'],
          }
    ),
    assumptions: {
      ...next.assumptions,
      annualLiquidReturnBps:
        0 as LifePlan['assumptions']['annualLiquidReturnBps'],
    },
    metadata: { ...next.metadata, updatedAt },
  };
}
