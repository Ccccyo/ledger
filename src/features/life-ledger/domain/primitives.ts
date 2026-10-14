import type { BasisPoints, MoneyCents, MonthIndex } from './types';

export function moneyCents(value: number): MoneyCents {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError('Money must be a safe integer number of cents.');
  }
  return value as MoneyCents;
}

export function yuan(value: number): MoneyCents {
  if (!Number.isFinite(value)) throw new TypeError('Yuan must be finite.');
  return moneyCents(Math.round(value * 100));
}

export function basisPoints(value: number): BasisPoints {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError('Rates must be integer basis points.');
  }
  return value as BasisPoints;
}

export function monthIndex(year: number, month: number): MonthIndex {
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month)) {
    throw new TypeError('Year and month must be integers.');
  }
  if (month < 1 || month > 12) {
    throw new RangeError('Month must be between 1 and 12.');
  }
  return (year * 12 + month - 1) as MonthIndex;
}

export function monthParts(month: MonthIndex) {
  return {
    year: Math.floor(month / 12),
    month: (month % 12) + 1,
  };
}

export function formatMonth(month: MonthIndex) {
  const parts = monthParts(month);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
}

export function addMonths(month: MonthIndex, amount: number): MonthIndex {
  if (!Number.isSafeInteger(amount)) {
    throw new TypeError('Month offset must be an integer.');
  }
  return (month + amount) as MonthIndex;
}

export function roundMoney(value: number): MoneyCents {
  if (!Number.isFinite(value)) {
    throw new RangeError('Calculated money must be finite.');
  }
  // Math.round is asymmetric for negative half values. This keeps financial
  // rounding symmetric around zero.
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value);
  return moneyCents(rounded);
}

export function monthlyRateFromAnnualBps(rate: BasisPoints): number {
  const annual = rate / 10_000;
  if (annual <= -1) throw new RangeError('Annual rate must exceed -100%.');
  return Math.pow(1 + annual, 1 / 12) - 1;
}

export function growMoney(
  amount: MoneyCents,
  annualGrowthBps: BasisPoints,
  elapsedMonths: number
): MoneyCents {
  if (annualGrowthBps === 0 || elapsedMonths === 0) return amount;
  const factor = Math.pow(1 + annualGrowthBps / 10_000, elapsedMonths / 12);
  return roundMoney(amount * factor);
}
