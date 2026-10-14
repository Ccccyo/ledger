import { MoneyEditor } from '../fields';
import { findBucket, updateBucketSummary } from '../plan-mutations';
import type { SectionProps } from '../types';

export function IncomeSection({ plan, locale, copy, onChange }: SectionProps) {
  return (
    <MoneyEditor
      label={copy.plan.monthly_income}
      value={findBucket(plan, 'income')?.summary?.amountCents ?? 0}
      locale={locale}
      onCommit={(value: number) =>
        onChange((current) => updateBucketSummary(current, 'income', value))
      }
    />
  );
}
