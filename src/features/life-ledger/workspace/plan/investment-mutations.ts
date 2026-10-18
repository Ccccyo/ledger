import { calculateMonthlyLifePlan } from '../../calculation';
import {
  basisPoints,
  createLocalId,
  moneyCents,
  yuan,
  type InvestmentRiskLevel,
  type InvestmentScenario,
  type LifePlan,
  type MonthIndex,
  type MoneyCents,
} from '../../domain';

export interface InvestmentInput {
  id?: string;
  name: string;
  principalYuan: number;
  riskLevel: InvestmentRiskLevel;
  lowerAnnualPercent: number;
  upperAnnualPercent: number;
  startMonth: MonthIndex;
  endMonthExclusive: MonthIndex;
}

export class InvestmentAllocationError extends Error {
  constructor(
    readonly code: 'invalid' | 'insufficient',
    message: string,
  ) {
    super(message);
    this.name = 'InvestmentAllocationError';
  }
}

function withoutAssetId(scenario: InvestmentScenario): InvestmentScenario {
  const { assetId: _assetId, ...rest } = scenario;
  return rest;
}

/**
 * Older plans represented an investment by moving today's cash into a linked
 * investment asset. New plans keep the investment as a future, display-only
 * allocation. Editing or removing a legacy item restores that opening cash.
 */
function normalizeLegacyLinkedAsset(
  plan: LifePlan,
  scenario?: InvestmentScenario,
): LifePlan {
  if (!scenario?.assetId) return plan;

  const linkedAsset = plan.assets.find(
    (asset) => asset.id === scenario.assetId && asset.kind === 'investment',
  );
  if (!linkedAsset) return plan;

  const remainingAssets = plan.assets.filter((asset) => asset.id !== linkedAsset.id);
  const cashIndex = remainingAssets.findIndex(
    (asset) =>
      asset.liquid &&
      (asset.kind === 'cash' || asset.kind === 'deposit') &&
      asset.acquiredMonth === undefined,
  );

  const restoredAssets = [...remainingAssets];
  if (cashIndex >= 0) {
    const cashAsset = restoredAssets[cashIndex];
    restoredAssets[cashIndex] = {
      ...cashAsset,
      openingBalanceCents: moneyCents(
        cashAsset.openingBalanceCents + linkedAsset.openingBalanceCents,
      ),
    };
  } else {
    restoredAssets.push({
      ...linkedAsset,
      id: `cash-restored-${linkedAsset.id}`,
      name: '现金',
      kind: 'cash',
      liquid: true,
      annualReturnBps: basisPoints(0),
    });
  }

  return {
    ...plan,
    assets: restoredAssets,
    metadata: {
      ...plan.metadata,
      investmentScenarios: (plan.metadata.investmentScenarios ?? []).map((item) =>
        item.assetId === linkedAsset.id ? withoutAssetId(item) : item,
      ),
    },
  };
}

function projectedOpeningAvailable(plan: LifePlan, month: MonthIndex): MoneyCents {
  const row = calculateMonthlyLifePlan(plan).monthly.find((item) => item.month === month);
  if (!row) {
    throw new InvestmentAllocationError('invalid', 'Investment month is outside the plan.');
  }
  return row.openingAvailableCents;
}

export function availableInvestmentPrincipalCents(
  plan: LifePlan,
  startMonth: MonthIndex,
  excludeScenarioId?: string,
): MoneyCents {
  const allocatedCents = (plan.metadata.investmentScenarios ?? [])
    .filter(
      (scenario) =>
        scenario.id !== excludeScenarioId &&
        scenario.startMonth <= startMonth &&
        startMonth < scenario.endMonthExclusive,
    )
    .reduce((sum, scenario) => sum + scenario.principalCents, 0);

  return moneyCents(
    Math.max(0, projectedOpeningAvailable(plan, startMonth) - allocatedCents),
  );
}

function assertAllocationCapacity(plan: LifePlan, scenario: InvestmentScenario): void {
  const otherScenarios = (plan.metadata.investmentScenarios ?? []).filter(
    (item) => item.id !== scenario.id,
  );
  const allScenarios = [...otherScenarios, scenario];
  const boundaryMonths = new Set<MonthIndex>([scenario.startMonth]);

  for (const item of otherScenarios) {
    if (
      scenario.startMonth < item.startMonth &&
      item.startMonth < scenario.endMonthExclusive
    ) {
      boundaryMonths.add(item.startMonth);
    }
  }

  for (const month of boundaryMonths) {
    const allocatedCents = allScenarios
      .filter((item) => item.startMonth <= month && month < item.endMonthExclusive)
      .reduce((sum, item) => sum + item.principalCents, 0);
    const availableCents = Math.max(0, projectedOpeningAvailable(plan, month));

    if (allocatedCents > availableCents) {
      throw new InvestmentAllocationError(
        'insufficient',
        'Investment principal exceeds projected available funds at the selected start.',
      );
    }
  }
}

export function saveInvestmentScenario(plan: LifePlan, input: InvestmentInput): LifePlan {
  if (
    !input.name.trim() ||
    !Number.isFinite(input.principalYuan) ||
    input.principalYuan <= 0 ||
    !Number.isFinite(input.lowerAnnualPercent) ||
    !Number.isFinite(input.upperAnnualPercent) ||
    input.lowerAnnualPercent > input.upperAnnualPercent ||
    input.startMonth >= input.endMonthExclusive
  ) {
    throw new InvestmentAllocationError('invalid', 'Invalid investment settings.');
  }

  const existing = (plan.metadata.investmentScenarios ?? []).find(
    (scenario) => scenario.id === input.id,
  );
  const normalizedPlan = normalizeLegacyLinkedAsset(plan, existing);
  const id = input.id ?? createLocalId('investment');
  const scenario: InvestmentScenario = {
    id,
    name: input.name.trim(),
    principalCents: yuan(input.principalYuan),
    riskLevel: input.riskLevel,
    lowerAnnualReturnBps: basisPoints(input.lowerAnnualPercent * 100),
    upperAnnualReturnBps: basisPoints(input.upperAnnualPercent * 100),
    startMonth: input.startMonth,
    endMonthExclusive: input.endMonthExclusive,
  };

  assertAllocationCapacity(normalizedPlan, scenario);

  const scenarios = normalizedPlan.metadata.investmentScenarios ?? [];
  return {
    ...normalizedPlan,
    metadata: {
      ...normalizedPlan.metadata,
      investmentScenarios: existing
        ? scenarios.map((item) => (item.id === existing.id ? scenario : item))
        : [...scenarios, scenario],
    },
  };
}

export function removeInvestmentScenario(plan: LifePlan, scenarioId: string): LifePlan {
  const existing = (plan.metadata.investmentScenarios ?? []).find(
    (scenario) => scenario.id === scenarioId,
  );
  if (!existing) return plan;

  const normalizedPlan = normalizeLegacyLinkedAsset(plan, existing);
  return {
    ...normalizedPlan,
    metadata: {
      ...normalizedPlan.metadata,
      investmentScenarios: (normalizedPlan.metadata.investmentScenarios ?? []).filter(
        (scenario) => scenario.id !== scenarioId,
      ),
    },
  };
}
