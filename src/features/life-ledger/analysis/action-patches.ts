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
    };

export function applyPlanPatch(plan: LifePlan, patch: PlanPatch): LifePlan {
  let found = false;
  let next = structuredClone(plan);
  if (
    patch.type === 'shift-cash-flow' ||
    patch.type === 'change-cash-flow-amount'
  ) {
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
    });
    next.retirementMonth = patch.retirementMonth;
    next.cashFlowBuckets = next.cashFlowBuckets.map((b) => ({
      ...b,
      summary: b.summary ? move(b.summary) : undefined,
      details: b.details.map(move),
    }));
    // Explicitly dated independent events stay unchanged.
  }
  if (!found || !validateLifePlan(next).valid)
    throw new Error('Invalid patch or target');
  return next;
}
