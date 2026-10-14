import type { MonthlyCalculationResult } from '../calculation';

export function digestResult(result: MonthlyCalculationResult) {
  return {
    firstGapMonth: result.summary.firstGapMonth,
    minimumAvailableCents: result.summary.minimumAvailableCents,
    endingAvailableCents: result.summary.endingAvailableCents,
  };
}

export type ResultDigest = ReturnType<typeof digestResult>;
export interface ResultChange {
  before: ResultDigest;
  after: ResultDigest;
  minimumDeltaCents: number;
  endingDeltaCents: number;
}

export function compareResults(
  before: MonthlyCalculationResult,
  after: MonthlyCalculationResult
): ResultChange {
  return {
    before: digestResult(before),
    after: digestResult(after),
    minimumDeltaCents:
      after.summary.minimumAvailableCents -
      before.summary.minimumAvailableCents,
    endingDeltaCents:
      after.summary.endingAvailableCents - before.summary.endingAvailableCents,
  };
}
