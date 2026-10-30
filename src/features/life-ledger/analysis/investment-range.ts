import type { MonthlyCalculationResult } from '../calculation';
import {
  addMonths,
  moneyCents,
  monthIndex,
  monthParts,
  roundMoney,
  type InvestmentScenario,
  type MoneyCents,
} from '../domain';

export interface InvestmentRangeMarker {
  year: number;
  kind: 'start' | 'end';
  names: string[];
  ids: string[];
}

export interface InvestmentRangeRow {
  year: number;
  age: number | null;
  started: boolean;
  principalCents: MoneyCents;
  lowerCents: MoneyCents;
  upperCents: MoneyCents;
}

function scenarioDelta(
  scenario: InvestmentScenario,
  pointEndExclusive: number,
  rateBps: number
) {
  const months = Math.max(
    0,
    Math.min(pointEndExclusive, scenario.endMonthExclusive) -
      scenario.startMonth
  );
  if (months === 0 || rateBps === 0) return moneyCents(0);
  const annualFactor = 1 + rateBps / 10_000;
  const value = roundMoney(
    scenario.principalCents * Math.pow(annualFactor, months / 12)
  );
  return moneyCents(value - scenario.principalCents);
}

/** Adds a display-only return range to the formal principal-only result. */
export function calculateInvestmentRange(
  result: MonthlyCalculationResult
): InvestmentRangeRow[] {
  const scenarios = result.input.metadata.investmentScenarios ?? [];
  return result.annual.map((row) => {
    const pointEndExclusive = Math.min(
      monthIndex(row.year + 1, 1),
      result.input.endMonthExclusive
    );
    const lowerDelta = scenarios.reduce(
      (total, item) =>
        total +
        scenarioDelta(item, pointEndExclusive, item.lowerAnnualReturnBps),
      0
    );
    const upperDelta = scenarios.reduce(
      (total, item) =>
        total +
        scenarioDelta(item, pointEndExclusive, item.upperAnnualReturnBps),
      0
    );
    const principalCents = moneyCents(
      row.closingAvailableCents + row.closingReservedInvestmentCents
    );
    return {
      year: row.year,
      age: row.ageEnd,
      started: scenarios.some(
        (item) => pointEndExclusive > item.startMonth
      ),
      principalCents,
      lowerCents: moneyCents(principalCents + lowerDelta),
      upperCents: moneyCents(principalCents + upperDelta),
    };
  });
}

/** Groups display-only investment boundaries into chart nodes by year. */
export function investmentRangeMarkers(
  result: MonthlyCalculationResult
): InvestmentRangeMarker[] {
  const groups = new Map<string, InvestmentRangeMarker>();
  for (const scenario of result.input.metadata.investmentScenarios ?? []) {
    const boundaries = [
      {
        year: monthParts(scenario.startMonth).year,
        kind: 'start' as const,
      },
      {
        year: monthParts(addMonths(scenario.endMonthExclusive, -1)).year,
        kind: 'end' as const,
      },
    ];

    for (const boundary of boundaries) {
      const key = `${boundary.year}-${boundary.kind}`;
      const group = groups.get(key) ?? { ...boundary, names: [], ids: [] };
      group.names.push(scenario.name);
      group.ids.push(scenario.id);
      groups.set(key, group);
    }
  }

  return [...groups.values()].sort(
    (left, right) =>
      left.year - right.year || (left.kind === 'start' ? -1 : 1)
  );
}
