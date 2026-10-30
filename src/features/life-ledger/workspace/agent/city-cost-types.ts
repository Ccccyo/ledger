export type HousingMode = 'rent' | 'own' | 'unknown';

export interface CityCostLookupInput {
  fromCity: string;
  toCity: string;
  householdSize: number;
  housingMode: HousingMode;
}

export interface CityCostCandidate {
  kind: 'city-cost-candidate';
  fromCity: string;
  toCity: string;
  householdSize: number;
  housingMode: HousingMode;
  currency: 'CNY';
  housingMonthlyChangeCents: number;
  livingMonthlyChangeCents: number;
  movingExpenseCandidateCents: number;
  ranges: {
    housingMonthlyChangeCents: [number, number];
    livingMonthlyChangeCents: [number, number];
    movingExpenseCents: [number, number];
  };
  source: {
    provider: string;
    mode: 'demo' | 'remote-mcp';
    datasetVersion: string;
    observedAt: string;
    retrievedAt: string;
    referenceUrl: string | null;
    disclaimer: string;
  };
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function parseCityCostLookupInput(
  value: unknown
): CityCostLookupInput | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const fromCity =
    typeof input.fromCity === 'string' ? input.fromCity.trim() : '';
  const toCity = typeof input.toCity === 'string' ? input.toCity.trim() : '';
  const housingMode = input.housingMode;
  if (
    fromCity.length < 2 ||
    fromCity.length > 40 ||
    toCity.length < 2 ||
    toCity.length > 40 ||
    fromCity === toCity ||
    !safeInteger(input.householdSize) ||
    input.householdSize < 1 ||
    input.householdSize > 8 ||
    (housingMode !== 'rent' &&
      housingMode !== 'own' &&
      housingMode !== 'unknown')
  ) {
    return null;
  }
  return {
    fromCity,
    toCity,
    householdSize: input.householdSize,
    housingMode,
  };
}

export function isCityCostCandidate(
  value: unknown
): value is CityCostCandidate {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const source = item.source as Record<string, unknown> | undefined;
  const ranges = item.ranges as Record<string, unknown> | undefined;
  return (
    item.kind === 'city-cost-candidate' &&
    typeof item.fromCity === 'string' &&
    typeof item.toCity === 'string' &&
    safeInteger(item.householdSize) &&
    (item.housingMode === 'rent' ||
      item.housingMode === 'own' ||
      item.housingMode === 'unknown') &&
    item.currency === 'CNY' &&
    safeInteger(item.housingMonthlyChangeCents) &&
    safeInteger(item.livingMonthlyChangeCents) &&
    safeInteger(item.movingExpenseCandidateCents) &&
    Boolean(ranges) &&
    [
      'housingMonthlyChangeCents',
      'livingMonthlyChangeCents',
      'movingExpenseCents',
    ].every(
      (key) =>
        Array.isArray(ranges?.[key]) &&
        (ranges?.[key] as unknown[]).length === 2 &&
        (ranges?.[key] as unknown[]).every(safeInteger)
    ) &&
    Boolean(source) &&
    typeof source?.provider === 'string' &&
    (source?.mode === 'demo' || source?.mode === 'remote-mcp') &&
    typeof source?.datasetVersion === 'string' &&
    typeof source?.observedAt === 'string' &&
    typeof source?.retrievedAt === 'string' &&
    typeof source?.disclaimer === 'string'
  );
}
