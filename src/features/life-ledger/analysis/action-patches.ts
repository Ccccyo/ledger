import {
  addMonths,
  moneyCents,
  validateLifePlan,
  type CashFlowItem,
  type LifePlan,
  type MoneyCents,
  type MonthIndex,
} from '../domain';

export type PlanPatch =
  | { type: 'shift-cash-flow'; cashFlowId: string; monthDelta: number }
  | {
      type: 'change-cash-flow-amount';
      cashFlowId: string;
      amountCents: MoneyCents;
    }
  | { type: 'change-retirement-month'; retirementMonth: MonthIndex }
  | {
      type: 'change-liquid-opening-balance';
      assetId: string;
      openingBalanceCents: MoneyCents;
    }
  | { type: 'shift-purchase'; purchaseId: string; monthDelta: number }
  | { type: 'remove-purchase'; purchaseId: string }
  | { type: 'shift-relocation'; relocationId: string; monthDelta: number }
  | { type: 'remove-relocation'; relocationId: string };

export function applyPlanPatch(plan: LifePlan, patch: PlanPatch): LifePlan {
  let found = false;
  let next = structuredClone(plan);
  if (
    patch.type === 'shift-cash-flow' ||
    patch.type === 'change-cash-flow-amount'
  ) {
    if (
      plan.assets.some(
        (a) => a.purchase?.downPaymentFlowId === patch.cashFlowId
      )
    )
      throw new Error('Edit linked purchases through the housing calculator');
    const edit = (flow: CashFlowItem): CashFlowItem => {
      if (flow.id !== patch.cashFlowId) return flow;
      found = true;
      if (patch.type === 'change-cash-flow-amount')
        return { ...flow, amountCents: moneyCents(patch.amountCents) };
      if (!Number.isSafeInteger(patch.monthDelta))
        throw new Error('Invalid month offset');
      const startMonth = addMonths(flow.startMonth, patch.monthDelta),
        endMonthExclusive = addMonths(flow.endMonthExclusive, patch.monthDelta);
      if (
        startMonth < plan.baseMonth ||
        endMonthExclusive > plan.endMonthExclusive
      )
        throw new Error('Event outside plan');
      return {
        ...flow,
        startMonth,
        endMonthExclusive,
        frequency:
          flow.frequency.kind === 'once'
            ? {
                kind: 'once',
                postingMonth: addMonths(
                  flow.frequency.postingMonth,
                  patch.monthDelta
                ),
              }
            : flow.frequency,
      };
    };
    next.cashFlowBuckets = next.cashFlowBuckets.map((b) => ({
      ...b,
      summary: b.summary ? edit(b.summary) : undefined,
      details: b.details.map(edit),
    }));
    next.standaloneCashFlows = next.standaloneCashFlows.map(edit);
  } else if (patch.type === 'change-liquid-opening-balance') {
    next.assets = next.assets.map((a) => {
      if (a.id !== patch.assetId || !a.liquid) return a;
      found = true;
      return {
        ...a,
        openingBalanceCents: moneyCents(patch.openingBalanceCents),
      };
    });
  } else if (patch.type === 'change-retirement-month') {
    if (!Number.isSafeInteger(patch.retirementMonth))
      throw new Error('Invalid retirement month');
    found = true;
    const move = (f: CashFlowItem) => ({
      ...f,
      startMonth:
        f.startMonth === plan.retirementMonth
          ? patch.retirementMonth
          : f.startMonth,
      endMonthExclusive:
        f.endMonthExclusive === plan.retirementMonth
          ? patch.retirementMonth
          : f.endMonthExclusive,
      growthStartMonth:
        f.growthStartMonth === plan.retirementMonth
          ? patch.retirementMonth
          : f.growthStartMonth,
      growthEndMonthExclusive:
        f.growthEndMonthExclusive === plan.retirementMonth
          ? patch.retirementMonth
          : f.growthEndMonthExclusive,
    });
    next.retirementMonth = patch.retirementMonth;
    next.cashFlowBuckets = next.cashFlowBuckets.map((b) => ({
      ...b,
      summary: b.summary ? move(b.summary) : undefined,
      details: b.details.map(move),
    }));
    // Career salary replacements are bounded by retirement. Other explicitly
    // dated independent events stay unchanged.
    next.standaloneCashFlows = next.standaloneCashFlows.map((flow) =>
      flow.incomeTreatment === 'replace-salary' &&
      flow.endMonthExclusive === plan.retirementMonth
        ? {
            ...flow,
            endMonthExclusive: patch.retirementMonth,
            growthEndMonthExclusive:
              flow.growthEndMonthExclusive === plan.retirementMonth
                ? patch.retirementMonth
                : flow.growthEndMonthExclusive,
          }
        : flow
    );
  } else if (
    patch.type === 'shift-purchase' ||
    patch.type === 'remove-purchase'
  ) {
    const asset = next.assets.find((item) => item.id === patch.purchaseId);
    if (!asset?.purchase) throw new Error('Purchase not found');
    found = true;
    const flowId = asset.purchase.downPaymentFlowId;
    const liabilityId = asset.purchase.liabilityId;
    if (patch.type === 'remove-purchase') {
      next.assets = next.assets.filter((item) => item.id !== asset.id);
      next.standaloneCashFlows = next.standaloneCashFlows.filter(
        (item) => item.id !== flowId
      );
      next.liabilities = next.liabilities.filter(
        (item) => item.id !== liabilityId
      );
    } else {
      const shiftMonth = (month: MonthIndex) =>
        addMonths(month, patch.monthDelta);
      next.assets = next.assets.map((item) =>
        item.id === asset.id && item.acquiredMonth !== undefined
          ? { ...item, acquiredMonth: shiftMonth(item.acquiredMonth) }
          : item
      );
      next.standaloneCashFlows = next.standaloneCashFlows.map((item) =>
        item.id === flowId
          ? {
              ...item,
              startMonth: shiftMonth(item.startMonth),
              endMonthExclusive: shiftMonth(item.endMonthExclusive),
              frequency:
                item.frequency.kind === 'once'
                  ? {
                      kind: 'once' as const,
                      postingMonth: shiftMonth(item.frequency.postingMonth),
                    }
                  : item.frequency,
            }
          : item
      );
      next.liabilities = next.liabilities.map((item) =>
        item.id === liabilityId
          ? {
              ...item,
              startMonth: shiftMonth(item.startMonth),
              endMonthExclusive: shiftMonth(item.endMonthExclusive),
            }
          : item
      );
    }
  } else if (
    patch.type === 'shift-relocation' ||
    patch.type === 'remove-relocation'
  ) {
    const relocation = next.metadata.relocations?.find(
      (item) => item.id === patch.relocationId
    );
    if (!relocation) throw new Error('Relocation not found');
    found = true;
    const flowIds = new Set(
      [
        relocation.movingExpenseFlowId,
        relocation.housingAdjustmentFlowId,
        relocation.livingAdjustmentFlowId,
        relocation.incomeAdjustmentFlowId,
      ].filter((id): id is string => Boolean(id))
    );
    if (patch.type === 'remove-relocation') {
      next.standaloneCashFlows = next.standaloneCashFlows.filter(
        (item) => !flowIds.has(item.id)
      );
      next.metadata.relocations = next.metadata.relocations?.filter(
        (item) => item.id !== relocation.id
      );
    } else {
      const shiftMonth = (month: MonthIndex) =>
        addMonths(month, patch.monthDelta);
      next.standaloneCashFlows = next.standaloneCashFlows.map((item) =>
        flowIds.has(item.id)
          ? {
              ...item,
              startMonth: shiftMonth(item.startMonth),
              endMonthExclusive:
                item.frequency.kind === 'once'
                  ? shiftMonth(item.endMonthExclusive)
                  : item.endMonthExclusive,
              frequency:
                item.frequency.kind === 'once'
                  ? {
                      kind: 'once' as const,
                      postingMonth: shiftMonth(item.frequency.postingMonth),
                    }
                  : item.frequency,
            }
          : item
      );
      next.metadata.relocations = next.metadata.relocations?.map((item) =>
        item.id === relocation.id
          ? { ...item, moveMonth: shiftMonth(item.moveMonth) }
          : item
      );
    }
  }
  const validation = validateLifePlan(next);
  if (!found || !validation.valid)
    throw new Error(
      !found
        ? 'Invalid patch target'
        : `Invalid patch: ${validation.issues[0]?.code ?? 'validation failed'}`
    );
  return next;
}
