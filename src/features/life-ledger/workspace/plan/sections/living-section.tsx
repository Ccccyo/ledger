import { BookOpen, Dumbbell, Heart, Plane, Users } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

import { yuan, type CashFlowCategory } from '../../../domain';
import { MoneyEditor, moneyFormatter, NumberField } from '../fields';
import {
  confirmDetailedTotal,
  findBucket,
  updateBucketSummary,
  updateCategoryDetail,
} from '../plan-mutations';
import type { SectionProps } from '../types';

const personalCategories = [
  { id: 'self_travel', icon: Plane },
  { id: 'self_hobbies', icon: Heart },
  { id: 'self_learning', icon: BookOpen },
  { id: 'self_wellness', icon: Dumbbell },
  { id: 'self_social', icon: Users },
] as const satisfies ReadonlyArray<{
  id: CashFlowCategory;
  icon: typeof Plane;
}>;

export function LivingSection(props: SectionProps) {
  const { plan, locale, copy, onChange } = props;
  const bucket = findBucket(plan, 'working-expenses');
  const originalTotal = bucket?.summary?.amountCents ?? 0;
  const detailedTotal =
    bucket?.details.reduce((sum, flow) => sum + flow.amountCents, 0) ?? 0;
  const currentTotal = bucket?.confirmedDetailedTotalCents ?? originalTotal;
  const personalTotal =
    bucket?.details
      .filter((flow) =>
        personalCategories.some((item) => item.id === flow.category)
      )
      .reduce((sum, flow) => sum + flow.amountCents, 0) ?? 0;
  const unallocated = Math.max(0, currentTotal - detailedTotal);
  const needsConfirmation =
    detailedTotal > currentTotal &&
    bucket?.confirmedDetailedTotalCents !== detailedTotal;
  const difference = Math.max(0, detailedTotal - currentTotal);
  const money = moneyFormatter(locale);
  const ratio =
    currentTotal > 0 ? Math.min(100, (detailedTotal / currentTotal) * 100) : 0;

  const updateDetail = (
    category: CashFlowCategory,
    label: string,
    amountCents: number
  ) =>
    onChange((current) =>
      updateCategoryDetail(current, category, amountCents, label)
    );

  return (
    <div className="space-y-6">
      <MoneyEditor
        label={copy.personal_spending.total_label}
        locale={locale}
        value={currentTotal}
        hint={copy.personal_spending.total_hint}
        onCommit={(value: number) =>
          onChange((current) =>
            updateBucketSummary(current, 'working-expenses', value)
          )
        }
      />

      <section>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span>
            {copy.personal_spending.personal_total}：
            <strong className="text-primary font-semibold tabular-nums">
              {money(personalTotal)}
            </strong>
          </span>
          <span>
            {copy.personal_spending.unallocated}：
            <strong className="text-foreground font-semibold tabular-nums">
              {money(unallocated)}
            </strong>
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={copy.personal_spending.progress_label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ratio)}
          className="bg-primary/10 mt-2 h-1.5 overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${ratio}%` }}
          />
        </div>

        {needsConfirmation && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-amber-300/70 bg-amber-50/70 p-4 text-sm dark:border-amber-700/60 dark:bg-amber-950/25"
          >
            <p className="font-medium text-amber-950 dark:text-amber-100">
              {copy.personal_spending.over_title.replace(
                '{difference}',
                money(difference)
              )}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-900/80 dark:text-amber-200/80">
              {copy.personal_spending.over_description.replace(
                '{details}',
                money(detailedTotal)
              )}
            </p>
            <button
              type="button"
              onClick={() => onChange(confirmDetailedTotal)}
              className={cn(
                'mt-3 min-h-10 rounded-lg bg-amber-700 px-3.5 text-xs font-semibold text-white',
                'hover:bg-amber-800 focus-visible:ring-4 focus-visible:ring-amber-500/25 focus-visible:outline-none'
              )}
            >
              {copy.personal_spending.confirm.replace(
                '{amount}',
                money(detailedTotal)
              )}
            </button>
          </div>
        )}

        <div className="mt-4 grid min-w-0 gap-x-6 sm:grid-cols-[repeat(2,minmax(0,1fr))] [&>div]:min-w-0">
          {personalCategories.map(({ id, icon }) => (
            <div key={id} className="border-border/70 border-t py-4">
              <NumberField
                label={copy.personal_spending.categories[id]}
                leadingIcon={icon}
                value={
                  (bucket?.details.find((flow) => flow.category === id)
                    ?.amountCents ?? 0) / 100
                }
                unit={locale.startsWith('zh') ? '元/月' : 'CNY/mo'}
                allowMoneyUnit
                locale={locale}
                onCommit={(value: number) =>
                  updateDetail(
                    id,
                    copy.personal_spending.categories[id],
                    yuan(value)
                  )
                }
              />
            </div>
          ))}
          <div className="border-border/70 border-t py-4">
            <NumberField
              label={copy.personal_spending.categories.living}
              value={
                (bucket?.details.find((flow) => flow.category === 'living')
                  ?.amountCents ?? 0) / 100
              }
              unit={locale.startsWith('zh') ? '元/月' : 'CNY/mo'}
              allowMoneyUnit
              locale={locale}
              onCommit={(value: number) =>
                updateDetail(
                  'living',
                  copy.personal_spending.categories.living,
                  yuan(value)
                )
              }
            />
          </div>
        </div>
      </section>
    </div>
  );
}
