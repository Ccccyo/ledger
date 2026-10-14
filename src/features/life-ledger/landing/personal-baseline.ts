import {
  createQuickLifePlan,
  monthParts,
  type LifePlan,
  type MonthIndex,
} from '../domain';

export interface PersonalBaselineInput {
  currentAge: number;
  startingAvailableAssetsWan: number;
  monthlyIncomeYuan: number;
  monthlyExpenseYuan: number;
  monthlyRetirementSelfFundedYuan: number;
  retirementAge: number;
  endAge: number;
}

export type PersonalBaselineField = keyof PersonalBaselineInput;

export type PersonalBaselineDraft = Record<PersonalBaselineField, string>;

export type PersonalBaselineIssueCode =
  | 'required'
  | 'invalid-number'
  | 'out-of-range'
  | 'age-order';

export interface PersonalBaselineIssue {
  field: PersonalBaselineField;
  code: PersonalBaselineIssueCode;
}

export type PersonalBaselineParseResult =
  | { ok: true; input: PersonalBaselineInput }
  | { ok: false; issues: PersonalBaselineIssue[] };

export const PERSONAL_BASELINE_DEFAULTS: PersonalBaselineInput = Object.freeze({
  currentAge: 28,
  startingAvailableAssetsWan: 0,
  monthlyIncomeYuan: 18_000,
  monthlyExpenseYuan: 9_000,
  monthlyRetirementSelfFundedYuan: 7_000,
  retirementAge: 60,
  endAge: 90,
});

export const PERSONAL_BASELINE_FIELDS: readonly PersonalBaselineField[] = [
  'currentAge',
  'startingAvailableAssetsWan',
  'monthlyIncomeYuan',
  'monthlyExpenseYuan',
  'monthlyRetirementSelfFundedYuan',
  'retirementAge',
  'endAge',
];

const LIMITS: Record<PersonalBaselineField, readonly [number, number]> = {
  currentAge: [18, 75],
  startingAvailableAssetsWan: [0, 100_000],
  monthlyIncomeYuan: [0, 10_000_000],
  monthlyExpenseYuan: [0, 10_000_000],
  monthlyRetirementSelfFundedYuan: [0, 10_000_000],
  retirementAge: [19, 80],
  endAge: [20, 120],
};

export function createPersonalBaselineDraft(
  input: PersonalBaselineInput = PERSONAL_BASELINE_DEFAULTS
): PersonalBaselineDraft {
  return {
    currentAge: String(input.currentAge),
    startingAvailableAssetsWan: String(input.startingAvailableAssetsWan),
    monthlyIncomeYuan: String(input.monthlyIncomeYuan),
    monthlyExpenseYuan: String(input.monthlyExpenseYuan),
    monthlyRetirementSelfFundedYuan: String(
      input.monthlyRetirementSelfFundedYuan
    ),
    retirementAge: String(input.retirementAge),
    endAge: String(input.endAge),
  };
}

export function parsePersonalBaselineDraft(
  draft: PersonalBaselineDraft
): PersonalBaselineParseResult {
  const values = {} as PersonalBaselineInput;
  const issues: PersonalBaselineIssue[] = [];

  for (const field of PERSONAL_BASELINE_FIELDS) {
    const raw = draft[field].trim();
    if (!raw) {
      issues.push({ field, code: 'required' });
      continue;
    }
    const value = Number(raw);
    const ageField =
      field === 'currentAge' || field === 'retirementAge' || field === 'endAge';
    if (!Number.isFinite(value) || (ageField && !Number.isInteger(value))) {
      issues.push({ field, code: 'invalid-number' });
      continue;
    }
    const [minimum, maximum] = LIMITS[field];
    if (value < minimum || value > maximum) {
      issues.push({ field, code: 'out-of-range' });
      continue;
    }
    values[field] = value;
  }

  if (issues.length === 0) {
    if (values.retirementAge <= values.currentAge) {
      issues.push({ field: 'retirementAge', code: 'age-order' });
    }
    if (values.endAge <= values.retirementAge) {
      issues.push({ field: 'endAge', code: 'age-order' });
    }
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, input: values };
}

export function createPersonalBaselinePlan(
  input: PersonalBaselineInput,
  context: {
    id: string;
    baseMonth: MonthIndex;
    nowIso: string;
  }
): LifePlan {
  const baseYear = monthParts(context.baseMonth).year;
  const plan = createQuickLifePlan({
    id: context.id,
    name: '我的一生账本',
    baseYear,
    baseMonth: context.baseMonth,
    currentAge: input.currentAge,
    retirementAge: input.retirementAge,
    endAge: input.endAge,
    monthlyIncomeYuan: input.monthlyIncomeYuan,
    monthlyWorkingExpensesYuan: input.monthlyExpenseYuan,
    monthlyRetirementSelfFundedYuan: input.monthlyRetirementSelfFundedYuan,
    currentSavingsYuan: input.startingAvailableAssetsWan * 10_000,
    now: context.nowIso,
  });

  return {
    ...plan,
    cashFlowBuckets: plan.cashFlowBuckets.map((bucket) => {
      if (bucket.id.endsWith(':income')) {
        return {
          ...bucket,
          name: '个人收入',
          summary: bucket.summary
            ? { ...bucket.summary, name: '个人每月到手收入' }
            : undefined,
        };
      }
      if (bucket.id.endsWith(':working-expenses')) {
        return {
          ...bucket,
          name: '当前个人支出',
          summary: bucket.summary
            ? { ...bucket.summary, name: '个人每月支出' }
            : undefined,
        };
      }
      if (bucket.id.endsWith(':retirement-expenses')) {
        return {
          ...bucket,
          name: '退休期个人支出',
          summary: bucket.summary
            ? { ...bucket.summary, name: '退休后每月需自付' }
            : undefined,
        };
      }
      return bucket;
    }),
    assets: plan.assets.map((asset) => ({
      ...asset,
      name: '基线起始可用资金',
    })),
  };
}
