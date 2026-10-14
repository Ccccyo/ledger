import type { MonthlyCalculationResult } from '../calculation';
import { monthParts } from '../domain';

export const EXPENSE_GROUPS = [
  'living',
  'housing',
  'child',
  'parent',
  'other',
  'retirement',
] as const;
export function annualChartData(result: MonthlyCalculationResult) {
  return result.annual.map((row) => {
    const c = row.expenseByCategory;
    const groups = {
      living: (c.living ?? 0) + (c.healthcare ?? 0) + (c.tax ?? 0),
      housing: c.housing ?? 0,
      child: c.child ?? 0,
      parent: c.parent ?? 0,
      other:
        (c.other ?? 0) +
        (c.salary ?? 0) +
        (c.side_income ?? 0) +
        (c.pension ?? 0),
      retirement: c.retirement ?? 0,
    };
    if (Object.values(groups).reduce((s, n) => s + n, 0) !== row.expenseCents)
      throw new Error('Expense categories do not reconcile');
    return {
      ...groups,
      year: row.year,
      ageStart: row.ageStart,
      ageEnd: row.ageEnd,
      expense: row.expenseCents,
      available: row.closingAvailableCents,
      netWorth: row.closingNetWorthCents,
      debt: row.closingDebtBalanceCents,
    };
  });
}
export function keyYears(result: MonthlyCalculationResult): number[] {
  const minimum = result.monthly.reduce(
    (best, r) =>
      r.closingAvailableCents < best.closingAvailableCents ? r : best,
    result.monthly[0]
  );
  const years = new Set([
    result.annual[0].year,
    result.annual.at(-1)!.year,
    monthParts(result.input.retirementMonth).year,
    minimum.year,
  ]);
  if (result.summary.firstGapYear !== null)
    years.add(result.summary.firstGapYear);
  for (const flow of result.input.standaloneCashFlows) {
    years.add(monthParts(flow.startMonth).year);
    years.add(monthParts(flow.endMonthExclusive).year);
  }
  return result.annual.map((r) => r.year).filter((y) => years.has(y));
}
