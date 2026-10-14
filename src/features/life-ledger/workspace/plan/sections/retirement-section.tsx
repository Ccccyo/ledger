import { MoneyEditor } from '../fields';
import { findBucket, updateBucketSummary } from '../plan-mutations';
import type { SectionProps } from '../types';

export function RetirementSection({
  plan,
  locale,
  copy,
  onChange,
}: SectionProps) {
  return (
    <MoneyEditor
      label={copy.plan.retirement_self_funded}
      hint={copy.plan.retirement_hint}
      value={findBucket(plan, 'retirement-expenses')?.summary?.amountCents ?? 0}
      locale={locale}
      onCommit={(value: number) =>
        onChange((current) =>
          updateBucketSummary(current, 'retirement-expenses', value)
        )
      }
    />
  );
}
