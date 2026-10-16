import {
  addMonths,
  basisPoints,
  yuan,
  type CashFlowCategory,
  type CashFlowDirection,
  type CashFlowItem,
  type LifePlan,
  type MonthIndex,
  type RelocationPlan,
  type ValueSource,
} from '../../domain';

export interface RelocationInput {
  id: string;
  currentCity?: string;
  targetCity: string;
  moveMonth: MonthIndex;
  movingExpenseYuan: number;
  housingMonthlyChangeYuan: number;
  livingMonthlyChangeYuan: number;
  incomeMonthlyChangeYuan: number;
  flowNames: {
    moving: string;
    housing: string;
    living: string;
    income: string;
  };
  source?: ValueSource;
}

type FlowKey =
  | 'movingExpenseFlowId'
  | 'housingAdjustmentFlowId'
  | 'livingAdjustmentFlowId'
  | 'incomeAdjustmentFlowId';

function linkedFlowIds(relocation: RelocationPlan | undefined) {
  return new Set(
    relocation
      ? [
          relocation.movingExpenseFlowId,
          relocation.housingAdjustmentFlowId,
          relocation.livingAdjustmentFlowId,
          relocation.incomeAdjustmentFlowId,
        ].filter((id): id is string => Boolean(id))
      : []
  );
}

function relocationFlow({
  plan,
  input,
  existing,
  key,
  suffix,
  amountYuan,
  label,
  category,
  positiveDirection,
  frequency,
}: {
  plan: LifePlan;
  input: RelocationInput;
  existing?: RelocationPlan;
  key: FlowKey;
  suffix: string;
  amountYuan: number;
  label: string;
  category: CashFlowCategory;
  positiveDirection: CashFlowDirection;
  frequency: 'once' | 'monthly';
}): CashFlowItem | null {
  if (amountYuan === 0) return null;
  const direction =
    amountYuan > 0
      ? positiveDirection
      : positiveDirection === 'income'
        ? 'expense'
        : 'income';
  const id = existing?.[key] ?? `${input.id}:${suffix}`;
  return {
    id,
    name: `${label} · ${input.targetCity.trim()}`,
    direction,
    category:
      key === 'incomeAdjustmentFlowId' && direction === 'expense'
        ? 'other'
        : category,
    ownerId: plan.primaryMemberId,
    amountCents: yuan(Math.abs(amountYuan)),
    frequency:
      frequency === 'once'
        ? { kind: 'once', postingMonth: input.moveMonth }
        : { kind: 'monthly' },
    startMonth: input.moveMonth,
    endMonthExclusive:
      frequency === 'once'
        ? addMonths(input.moveMonth, 1)
        : plan.endMonthExclusive,
    annualGrowthBps: basisPoints(0),
    source: input.source ?? { kind: 'user', label: '用户填写' },
    confirmation: 'confirmed',
  };
}

export function saveRelocation(plan: LifePlan, input: RelocationInput): LifePlan {
  const amounts = [
    input.movingExpenseYuan,
    input.housingMonthlyChangeYuan,
    input.livingMonthlyChangeYuan,
    input.incomeMonthlyChangeYuan,
  ];
  if (
    !input.id.trim() ||
    !input.targetCity.trim() ||
    input.targetCity.trim().length > 80 ||
    (input.currentCity?.trim().length ?? 0) > 80 ||
    input.moveMonth < plan.baseMonth ||
    input.moveMonth >= plan.endMonthExclusive ||
    amounts.some(
      (amount) => !Number.isFinite(amount) || Math.abs(amount) > 1_000_000_000
    ) ||
    input.movingExpenseYuan < 0
  ) {
    throw new Error('Invalid relocation');
  }

  const relocations = plan.metadata.relocations ?? [];
  const existing = relocations.find((item) => item.id === input.id);
  const oldFlowIds = linkedFlowIds(existing);
  const movingFlow = relocationFlow({
      plan,
      input,
      existing,
      key: 'movingExpenseFlowId',
      suffix: 'moving',
      amountYuan: input.movingExpenseYuan,
      label: input.flowNames.moving,
      category: 'housing',
      positiveDirection: 'expense',
      frequency: 'once',
    });
  const housingFlow = relocationFlow({
      plan,
      input,
      existing,
      key: 'housingAdjustmentFlowId',
      suffix: 'housing',
      amountYuan: input.housingMonthlyChangeYuan,
      label: input.flowNames.housing,
      category: 'housing',
      positiveDirection: 'expense',
      frequency: 'monthly',
    });
  const livingFlow = relocationFlow({
      plan,
      input,
      existing,
      key: 'livingAdjustmentFlowId',
      suffix: 'living',
      amountYuan: input.livingMonthlyChangeYuan,
      label: input.flowNames.living,
      category: 'living',
      positiveDirection: 'expense',
      frequency: 'monthly',
    });
  const incomeFlow = relocationFlow({
      plan,
      input,
      existing,
      key: 'incomeAdjustmentFlowId',
      suffix: 'income',
      amountYuan: input.incomeMonthlyChangeYuan,
      label: input.flowNames.income,
      category: 'side_income',
      positiveDirection: 'income',
      frequency: 'monthly',
    });
  const flows = [movingFlow, housingFlow, livingFlow, incomeFlow].filter(
    (flow): flow is CashFlowItem => flow !== null
  );
  const relocation: RelocationPlan = {
    id: input.id,
    currentCity: input.currentCity?.trim() || undefined,
    targetCity: input.targetCity.trim(),
    moveMonth: input.moveMonth,
    movingExpenseFlowId: movingFlow?.id,
    housingAdjustmentFlowId: housingFlow?.id,
    livingAdjustmentFlowId: livingFlow?.id,
    incomeAdjustmentFlowId: incomeFlow?.id,
    source: input.source ?? { kind: 'user', label: '用户填写' },
  };

  return {
    ...plan,
    standaloneCashFlows: [
      ...plan.standaloneCashFlows.filter((flow) => !oldFlowIds.has(flow.id)),
      ...flows,
    ],
    metadata: {
      ...plan.metadata,
      relocations: existing
        ? relocations.map((item) => (item.id === existing.id ? relocation : item))
        : [...relocations, relocation],
      excludedLifeStages: plan.metadata.excludedLifeStages?.filter(
        (stage) => stage !== 'housing'
      ),
    },
  };
}

export function removeRelocation(plan: LifePlan, id: string): LifePlan {
  const relocation = (plan.metadata.relocations ?? []).find(
    (item) => item.id === id
  );
  if (!relocation) return plan;
  const flowIds = linkedFlowIds(relocation);
  return {
    ...plan,
    standaloneCashFlows: plan.standaloneCashFlows.filter(
      (flow) => !flowIds.has(flow.id)
    ),
    metadata: {
      ...plan.metadata,
      relocations: (plan.metadata.relocations ?? []).filter(
        (item) => item.id !== id
      ),
    },
  };
}
