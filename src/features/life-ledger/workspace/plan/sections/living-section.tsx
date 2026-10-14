import { CategoryEditor, MoneyEditor } from '../fields';
import {
  confirmDetailedTotal,
  findBucket,
  updateBucketSummary,
  updateCategoryDetail,
} from '../plan-mutations';
import type { SectionProps } from '../types';

export function LivingSection(props: SectionProps) {
  const { plan, locale, copy, onChange } = props;
  return (
    <div className="space-y-6">
      <MoneyEditor
        label={copy.plan.monthly_expense}
        locale={locale}
        value={findBucket(plan, 'working-expenses')?.summary?.amountCents ?? 0}
        onCommit={(v: number) =>
          onChange((p) => updateBucketSummary(p, 'working-expenses', v))
        }
      />
      <details>
        <summary className="text-muted-foreground cursor-pointer text-sm">
          {copy.editor.existing_split}
        </summary>
        <div className="pt-4">
          <CategoryEditor
            label={copy.plan.sections.living}
            category="living"
            bucket={findBucket(plan, 'working-expenses')}
            copy={copy}
            locale={locale}
            onChange={(v: number) =>
              onChange((p) => updateCategoryDetail(p, 'living', v))
            }
            onConfirm={() => onChange(confirmDetailedTotal)}
          />
        </div>
      </details>
    </div>
  );
}
