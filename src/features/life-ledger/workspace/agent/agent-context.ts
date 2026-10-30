import { applyPlanPatch } from '../../analysis/action-patches';
import {
  calculateMonthlyLifePlan,
  type MonthlyCalculationResult,
} from '../../calculation';
import {
  addMonths,
  basisPoints,
  cashFlowInputDirection,
  cashFlowSignedAmount,
  moneyCents,
  type CashFlowItem,
  type LifePlan,
  type MonthIndex,
} from '../../domain';
import type {
  AgentAnnualRow,
  AgentObservation,
  AgentToolCall,
  LifeLedgerAgentContext,
} from './agent-types';

function allFlows(result: MonthlyCalculationResult): CashFlowItem[] {
  return [
    ...result.input.cashFlowBuckets.flatMap((bucket) => [
      ...(bucket.summary ? [bucket.summary] : []),
      ...bucket.details,
    ]),
    ...result.input.standaloneCashFlows,
  ];
}

export function buildAgentContext(
  result: MonthlyCalculationResult
): LifeLedgerAgentContext {
  const plan = result.input;
  const flows = allFlows(result);
  const primaryMember = plan.members.find(
    (member) => member.id === plan.primaryMemberId
  );
  const ageAt = (month: number) =>
    primaryMember?.birthMonth === undefined
      ? null
      : Math.max(0, Math.floor((month - primaryMember.birthMonth) / 12));
  return {
    planHash: result.inputHash,
    planName: plan.name,
    baseMonth: plan.baseMonth,
    endMonthExclusive: plan.endMonthExclusive,
    retirementMonth: plan.retirementMonth,
    primaryBirthMonth: primaryMember?.birthMonth ?? null,
    currentAge: ageAt(plan.baseMonth),
    retirementAge: ageAt(plan.retirementMonth),
    endAge: ageAt(plan.endMonthExclusive),
    householdSize: Math.max(1, plan.members.length),
    summary: {
      firstGapMonth: result.summary.firstGapMonth,
      firstGapYear: result.summary.firstGapYear,
      minimumAvailableCents: result.summary.minimumAvailableCents,
      endingAvailableCents: result.summary.endingAvailableCents,
      endingNetWorthCents: result.summary.endingNetWorthCents,
      retirementAvailableCents: result.summary.retirementAvailableCents,
    },
    keyEvents: flows
      .filter(
        (flow) =>
          flow.amountCents !== 0 || flow.incomeTreatment === 'replace-salary'
      )
      .slice(0, 80)
      .map((flow) => ({
        id: flow.id,
        label: flow.name,
        category: flow.category,
        direction: cashFlowInputDirection(flow),
        amountCents: cashFlowSignedAmount(flow),
        startMonth: flow.startMonth,
        endMonthExclusive: flow.endMonthExclusive,
        frequency: flow.frequency.kind,
        annualGrowthBps: flow.annualGrowthBps,
        sourceLabel: flow.source.label,
        incomeTreatment: flow.incomeTreatment ?? null,
      })),
    assets: plan.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      liquid: asset.liquid,
      openingBalanceCents: asset.openingBalanceCents,
      annualReturnBps: asset.annualReturnBps,
      acquiredMonth: asset.acquiredMonth ?? null,
      purchaseLiabilityId: asset.purchase?.liabilityId ?? null,
      downPaymentFlowId: asset.purchase?.downPaymentFlowId ?? null,
    })),
    liabilities: plan.liabilities.map((liability) => ({
      id: liability.id,
      name: liability.name,
      kind: liability.kind,
      openingPrincipalCents: liability.openingPrincipalCents,
      annualInterestBps: liability.annualInterestBps,
      monthlyPaymentCents: liability.monthlyPaymentCents,
      startMonth: liability.startMonth,
      endMonthExclusive: liability.endMonthExclusive,
    })),
    investments: (plan.metadata.investmentScenarios ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      principalCents: item.principalCents,
      riskLevel: item.riskLevel,
      lowerAnnualReturnBps: item.lowerAnnualReturnBps,
      upperAnnualReturnBps: item.upperAnnualReturnBps,
      startMonth: item.startMonth,
      endMonthExclusive: item.endMonthExclusive,
    })),
    relocations: (plan.metadata.relocations ?? []).map((item) => ({
      id: item.id,
      currentCity: item.currentCity ?? null,
      targetCity: item.targetCity,
      moveMonth: item.moveMonth,
      movingExpenseFlowId: item.movingExpenseFlowId ?? null,
      housingAdjustmentFlowId: item.housingAdjustmentFlowId ?? null,
      livingAdjustmentFlowId: item.livingAdjustmentFlowId ?? null,
      incomeAdjustmentFlowId: item.incomeAdjustmentFlowId ?? null,
      flowIds: [
        item.movingExpenseFlowId,
        item.housingAdjustmentFlowId,
        item.livingAdjustmentFlowId,
        item.incomeAdjustmentFlowId,
      ].filter((id): id is string => Boolean(id)),
    })),
    topInfluences: result.summary.topInfluences.map((item) => ({
      inputId: item.inputId,
      label: item.label,
      perturbation: item.perturbation,
      endingAvailableDeltaCents: item.endingAvailableDeltaCents,
      absoluteImpactCents: item.absoluteImpactCents,
    })),
    editableTargets: [
      {
        id: 'retirement',
        kind: 'retirement',
        label: 'Retirement month',
        startMonth: plan.retirementMonth,
      },
      ...flows
        .filter(
          (flow) =>
            !plan.assets.some(
              (asset) => asset.purchase?.downPaymentFlowId === flow.id
            )
        )
        .slice(0, 80)
        .map((flow) => ({
          id: flow.id,
          kind: 'cash-flow' as const,
          label: flow.name,
          category: flow.category,
          amountCents: cashFlowSignedAmount(flow),
          startMonth: flow.startMonth,
          endMonthExclusive: flow.endMonthExclusive,
        })),
      ...plan.assets
        .filter((asset) => asset.liquid)
        .map((asset) => ({
          id: asset.id,
          kind: 'liquid-asset' as const,
          label: asset.name,
          amountCents: asset.openingBalanceCents,
        })),
    ],
  };
}

export function toAgentAnnualRow(
  row: MonthlyCalculationResult['annual'][number]
): AgentAnnualRow {
  return {
    year: row.year,
    ageStart: row.ageStart,
    ageEnd: row.ageEnd,
    phase: row.phase,
    incomeCents: row.incomeCents,
    expenseCents: row.expenseCents,
    netCashFlowCents: row.netCashFlowCents,
    closingAvailableCents: row.closingAvailableCents,
    minimumAvailableCents: row.minimumAvailableCents,
    closingNetWorthCents: row.closingNetWorthCents,
    expenseByCategory: Object.fromEntries(
      Object.entries(row.expenseByCategory).map(([category, amount]) => [
        category,
        amount,
      ])
    ),
    topExpenseCategories: Object.entries(row.expenseByCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category]) => category),
  };
}

export function runReadOnlyAgentTool(
  result: MonthlyCalculationResult,
  tool: AgentToolCall
): AgentObservation {
  if (
    tool.name === 'simulate_patch' ||
    tool.name === 'simulate_scenario' ||
    tool.name === 'simulate_relocation_candidate' ||
    tool.name === 'lookup_city_costs'
  ) {
    return {
      tool: tool.name,
      ok: false,
      error: 'This tool requires the Agent runtime executor.',
    };
  }
  if (tool.name === 'read_overview') {
    return {
      tool: tool.name,
      ok: true,
      result: {
        planHash: result.inputHash,
        summary: {
          firstGapMonth: result.summary.firstGapMonth,
          minimumAvailableCents: result.summary.minimumAvailableCents,
          endingAvailableCents: result.summary.endingAvailableCents,
          endingNetWorthCents: result.summary.endingNetWorthCents,
          retirementAvailableCents: result.summary.retirementAvailableCents,
        },
      },
    };
  }
  if (tool.name === 'compare_child_timing') {
    return compareChildTiming(result, tool.arguments);
  }
  if (tool.name === 'compare_retirement_ages') {
    const primaryMember = result.input.members.find(
      (member) => member.id === result.input.primaryMemberId
    );
    const currentRetirementAge = primaryMember?.birthMonth
      ? Math.floor(
          (result.input.retirementMonth - primaryMember.birthMonth) / 12
        )
      : null;
    if (currentRetirementAge === null)
      return {
        tool: tool.name,
        ok: false,
        error: 'Birth month is required to compare retirement ages.',
      };
    try {
      const options = tool.arguments.ages.map((age) => {
        const candidate = calculateMonthlyLifePlan(
          applyPlanPatch(result.input, {
            type: 'change-retirement-month',
            retirementMonth: addMonths(
              result.input.retirementMonth,
              (age - currentRetirementAge) * 12
            ),
          })
        );
        return {
          age,
          retirementAvailableCents: candidate.summary.retirementAvailableCents,
          endingAvailableCents: candidate.summary.endingAvailableCents,
          firstGapMonth: candidate.summary.firstGapMonth,
        };
      });
      return { tool: tool.name, ok: true, result: options };
    } catch (error) {
      return {
        tool: tool.name,
        ok: false,
        error: error instanceof Error ? error.message : 'Comparison failed.',
      };
    }
  }
  if (tool.name === 'get_investment_capacity') {
    const { startMonth, endMonthExclusive } = tool.arguments;
    if (
      startMonth < result.input.baseMonth ||
      endMonthExclusive > result.input.endMonthExclusive ||
      endMonthExclusive <= startMonth
    ) {
      return {
        tool: tool.name,
        ok: false,
        error: 'Investment period is outside this plan.',
      };
    }
    const startRow = result.monthly.find((row) => row.month === startMonth);
    const holdingRows = result.monthly.filter(
      (row) => row.month >= startMonth && row.month < endMonthExclusive
    );
    if (!startRow || holdingRows.length === 0) {
      return {
        tool: tool.name,
        ok: false,
        error: 'Investment period is outside this plan.',
      };
    }
    const availableAtStartCents = Math.max(
      0,
      startRow.openingAvailableCents +
        startRow.investmentReleasedCents -
        startRow.investmentAllocatedCents
    );
    const minimumDuringHoldingCents = Math.min(
      ...holdingRows.map((row) => row.closingAvailableCents)
    );
    return {
      tool: tool.name,
      ok: true,
      result: {
        startMonth,
        endMonthExclusive,
        availableAtStartCents,
        gapFreeAdditionalCents: Math.max(
          0,
          Math.min(availableAtStartCents, minimumDuringHoldingCents)
        ),
      },
    };
  }
  if (tool.name === 'inspect_year') {
    const row = result.annual.find((item) => item.year === tool.arguments.year);
    return row
      ? { tool: tool.name, ok: true, result: toAgentAnnualRow(row) }
      : {
          tool: tool.name,
          ok: false,
          error: `Year ${tool.arguments.year} is outside this plan.`,
        };
  }

  const start = tool.arguments.startYear ?? Number.NEGATIVE_INFINITY;
  const end = tool.arguments.endYear ?? Number.POSITIVE_INFINITY;
  const rows = result.annual
    .filter((row) => row.year >= start && row.year <= end)
    .map(toAgentAnnualRow);
  return rows.length
    ? { tool: tool.name, ok: true, result: rows }
    : {
        tool: tool.name,
        ok: false,
        error: 'The requested year range is outside this plan.',
      };
}

interface ChildTimingOption {
  firstChildAge: number;
  secondChildAge: number;
  firstChildYear: number;
  secondChildYear: number;
  firstGapMonth: number | null;
  minimumAvailableCents: number;
  endingAvailableCents: number;
}

interface ChildTimingResult {
  usedCurrentChildBudget: boolean;
  comparedStartAge: number;
  comparedEndAge: number;
  spacingYears: number;
  options: ChildTimingOption[];
}

function activeChildExpenseFlows(plan: LifePlan) {
  return [
    ...plan.cashFlowBuckets.flatMap((bucket) =>
      bucket.mode === 'summary'
        ? bucket.summary
          ? [bucket.summary]
          : []
        : bucket.details
    ),
    ...plan.standaloneCashFlows,
  ].filter(
    (flow) =>
      flow.category === 'child' &&
      flow.direction === 'expense' &&
      flow.amountCents > 0
  );
}

function withoutActiveChildExpenses(plan: LifePlan): LifePlan {
  const clear = (flow: CashFlowItem) =>
    flow.category === 'child' && flow.direction === 'expense'
      ? { ...flow, amountCents: moneyCents(0) }
      : flow;
  return {
    ...plan,
    cashFlowBuckets: plan.cashFlowBuckets.map((bucket) => ({
      ...bucket,
      summary: bucket.summary ? clear(bucket.summary) : undefined,
      details: bucket.details.map(clear),
    })),
    standaloneCashFlows: plan.standaloneCashFlows.map(clear),
  };
}

function shiftedChildFlow(
  flow: CashFlowItem,
  monthDelta: number,
  id: string,
  plan: LifePlan
): CashFlowItem | null {
  const shiftedStart = addMonths(flow.startMonth, monthDelta);
  const shiftedEnd = addMonths(flow.endMonthExclusive, monthDelta);
  if (shiftedStart < plan.baseMonth || shiftedStart >= plan.endMonthExclusive)
    return null;
  const endMonthExclusive = Math.min(
    shiftedEnd,
    plan.endMonthExclusive
  ) as MonthIndex;
  if (endMonthExclusive <= shiftedStart) return null;
  const frequency =
    flow.frequency.kind === 'once'
      ? {
          kind: 'once' as const,
          postingMonth: addMonths(flow.frequency.postingMonth, monthDelta),
        }
      : flow.frequency;
  if (
    frequency.kind === 'once' &&
    (frequency.postingMonth < shiftedStart ||
      frequency.postingMonth >= endMonthExclusive)
  )
    return null;
  return {
    ...flow,
    id,
    name: `${flow.name}（情景）`,
    startMonth: shiftedStart,
    endMonthExclusive,
    frequency,
    growthStartMonth:
      flow.growthStartMonth === undefined
        ? undefined
        : addMonths(flow.growthStartMonth, monthDelta),
    growthEndMonthExclusive:
      flow.growthEndMonthExclusive === undefined
        ? undefined
        : (Math.min(
            addMonths(flow.growthEndMonthExclusive, monthDelta),
            plan.endMonthExclusive
          ) as MonthIndex),
    source: { kind: 'agent', label: '规划助手情景试算' },
    confirmation: 'confirmed',
  };
}

function compareChildTiming(
  result: MonthlyCalculationResult,
  args: Extract<AgentToolCall, { name: 'compare_child_timing' }>['arguments']
): AgentObservation {
  const plan = result.input;
  const primary = plan.members.find(
    (member) => member.id === plan.primaryMemberId
  );
  if (primary?.birthMonth === undefined) {
    return {
      tool: 'compare_child_timing',
      ok: false,
      error: 'Birth month is required to compare age-based timing.',
    };
  }

  const template = activeChildExpenseFlows(plan);
  if (template.length === 0 && args.monthlyCostCents === null) {
    return {
      tool: 'compare_child_timing',
      ok: false,
      error: 'A child budget is required before comparing timing.',
    };
  }

  const basePlan = withoutActiveChildExpenses(plan);
  const anchorMonth = template.length
    ? template.reduce<number>(
        (earliest, flow) => Math.min(earliest, flow.startMonth),
        template[0].startMonth
      )
    : null;
  const options: ChildTimingOption[] = [];

  for (let firstAge = args.startAge; firstAge <= args.endAge; firstAge += 1) {
    const firstMonth = addMonths(primary.birthMonth, firstAge * 12);
    const secondMonth = addMonths(firstMonth, args.spacingYears * 12);
    if (firstMonth < plan.baseMonth || secondMonth >= plan.endMonthExclusive)
      continue;

    let scenarioFlows: CashFlowItem[];
    if (template.length && anchorMonth !== null) {
      const firstDelta = firstMonth - anchorMonth;
      scenarioFlows = [0, args.spacingYears * 12].flatMap(
        (childDelta, childIndex) =>
          template.flatMap((flow, flowIndex) => {
            const shifted = shiftedChildFlow(
              flow,
              firstDelta + childDelta,
              `agent-child-${firstAge}-${childIndex + 1}-${flowIndex}`,
              plan
            );
            return shifted ? [shifted] : [];
          })
      );
    } else {
      scenarioFlows = [firstMonth, secondMonth].map((startMonth, index) => ({
        id: `agent-child-${firstAge}-${index + 1}`,
        name: `孩子 ${index + 1} 每月支出（情景）`,
        direction: 'expense' as const,
        category: 'child' as const,
        ownerId: plan.primaryMemberId,
        amountCents: moneyCents(args.monthlyCostCents ?? 0),
        frequency: { kind: 'monthly' as const },
        startMonth,
        endMonthExclusive: Math.min(
          addMonths(startMonth, args.supportYears * 12),
          plan.endMonthExclusive
        ) as MonthIndex,
        annualGrowthBps: basisPoints(0),
        source: { kind: 'agent' as const, label: '规划助手情景试算' },
        confirmation: 'confirmed' as const,
      }));
    }

    const scenario = calculateMonthlyLifePlan({
      ...basePlan,
      standaloneCashFlows: [...basePlan.standaloneCashFlows, ...scenarioFlows],
    });
    const latestChildEnd = scenarioFlows.reduce<number>(
      (latest, flow) => Math.max(latest, flow.endMonthExclusive),
      secondMonth
    );
    const childWindow = scenario.monthly.filter(
      (row) => row.month >= firstMonth && row.month < latestChildEnd
    );
    const firstGapMonth = scenario.summary.firstGapMonth;
    options.push({
      firstChildAge: firstAge,
      secondChildAge: firstAge + args.spacingYears,
      firstChildYear: Math.floor(firstMonth / 12),
      secondChildYear: Math.floor(secondMonth / 12),
      firstGapMonth:
        firstGapMonth !== null &&
        firstGapMonth >= firstMonth &&
        firstGapMonth < latestChildEnd
          ? firstGapMonth
          : null,
      minimumAvailableCents: childWindow.reduce<number>(
        (minimum, row) => Math.min(minimum, row.closingAvailableCents),
        childWindow[0]?.closingAvailableCents ?? 0
      ),
      endingAvailableCents:
        childWindow.at(-1)?.closingAvailableCents ??
        scenario.summary.endingAvailableCents,
    });
  }

  options.sort((a, b) => {
    if (a.firstGapMonth === null && b.firstGapMonth !== null) return -1;
    if (a.firstGapMonth !== null && b.firstGapMonth === null) return 1;
    if (a.firstGapMonth !== b.firstGapMonth)
      return (b.firstGapMonth ?? 0) - (a.firstGapMonth ?? 0);
    if (a.minimumAvailableCents !== b.minimumAvailableCents)
      return b.minimumAvailableCents - a.minimumAvailableCents;
    return b.endingAvailableCents - a.endingAvailableCents;
  });

  const payload: ChildTimingResult = {
    usedCurrentChildBudget: template.length > 0,
    comparedStartAge: args.startAge,
    comparedEndAge: args.endAge,
    spacingYears: args.spacingYears,
    options: options.slice(0, 3),
  };
  return options.length
    ? { tool: 'compare_child_timing', ok: true, result: payload }
    : {
        tool: 'compare_child_timing',
        ok: false,
        error: 'No valid child timing options fit within this plan.',
      };
}
