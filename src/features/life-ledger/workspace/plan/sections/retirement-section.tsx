import { MoneyEditor } from '../fields';
import {
  findBucket,
  updateBucketSummary,
  updateRetirementPension,
} from '../plan-mutations';
import type { SectionProps } from '../types';

export function RetirementSection({
  plan,
  locale,
  copy,
  onChange,
}: SectionProps) {
  const pension = plan.standaloneCashFlows.find(
    (flow) =>
      flow.ownerId === plan.primaryMemberId && flow.category === 'pension'
  );
  return (
    <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
      <MoneyEditor
        label={copy.plan.retirement_self_funded}
        hint={copy.plan.retirement_hint}
        value={
          findBucket(plan, 'retirement-expenses')?.summary?.amountCents ?? 0
        }
        locale={locale}
        onCommit={(value: number) =>
          onChange((current) =>
            updateBucketSummary(current, 'retirement-expenses', value)
          )
        }
      />
      <MoneyEditor
        label={copy.plan.retirement_pension}
        hint={copy.plan.retirement_pension_hint}
        value={pension?.amountCents ?? 0}
        locale={locale}
        onCommit={(value: number) =>
          onChange((current) =>
            updateRetirementPension(
              current,
              value,
              copy.plan.retirement_pension
            )
          )
        }
      />
    </div>
  );
}
