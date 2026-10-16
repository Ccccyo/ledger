import {
  addMonths,
  basisPoints,
  moneyCents,
  yuan,
  type LifePlan,
  type MonthIndex,
} from '../../domain';

export interface PurchaseInput {
  id: string;
  name: string;
  priceYuan: number;
  downPaymentYuan: number;
  annualRatePercent: number;
  years: number;
  month: MonthIndex;
}

/** Equal payments with annual quoted rate / 12. Rounded cents, final payment settles remainder. */
export function estimateMortgage(
  priceYuan: number,
  downPaymentYuan: number,
  annualRatePercent: number,
  years: number
) {
  if (
    ![priceYuan, downPaymentYuan, annualRatePercent, years].every(
      Number.isFinite
    ) ||
    priceYuan <= 0 ||
    priceYuan > 1e9 ||
    downPaymentYuan < 0 ||
    downPaymentYuan > priceYuan ||
    annualRatePercent < 0 ||
    annualRatePercent > 30 ||
    !Number.isInteger(years) ||
    years < 1 ||
    years > 40
  )
    throw new Error('Invalid purchase');
  const principal = yuan(priceYuan - downPaymentYuan);
  const rateBps = basisPoints(Math.round(annualRatePercent * 100));
  const rate = rateBps / 120_000;
  const months = years * 12;
  const payment = moneyCents(
    Math.ceil(
      principal === 0
        ? 0
        : rate === 0
          ? principal / months
          : (principal * rate) / (1 - Math.pow(1 + rate, -months))
    )
  );
  let balance = Number(principal),
    total = 0;
  for (let i = 0; i < months && balance > 0; i++) {
    const due = balance + Math.round(balance * rate);
    const paid = i === months - 1 ? due : Math.min(due, payment);
    total += paid;
    balance = due - paid;
  }
  return {
    principal,
    rateBps,
    months,
    payment,
    interest: moneyCents(total - principal),
  };
}

export function removePurchase(plan: LifePlan, id: string): LifePlan {
  const asset = plan.assets.find((a) => a.id === id);
  if (!asset?.purchase) return plan;
  return {
    ...plan,
    assets: plan.assets.filter((a) => a.id !== id),
    liabilities: plan.liabilities.filter(
      (l) => l.id !== asset.purchase?.liabilityId
    ),
    standaloneCashFlows: plan.standaloneCashFlows.filter(
      (f) => f.id !== asset.purchase?.downPaymentFlowId
    ),
  };
}

export function savePurchase(plan: LifePlan, input: PurchaseInput): LifePlan {
  const estimate = estimateMortgage(
    input.priceYuan,
    input.downPaymentYuan,
    input.annualRatePercent,
    input.years
  );
  if (
    !input.name.trim() ||
    !Number.isSafeInteger(input.month) ||
    input.month < plan.baseMonth ||
    input.month >= plan.endMonthExclusive
  )
    throw new Error('Invalid purchase month');
  const next = removePurchase(plan, input.id);
  const downId = `${input.id}:down-payment`,
    loanId = `${input.id}:loan`;
  const common = {
    ownerId: plan.primaryMemberId,
    source: { kind: 'user' as const, label: '用户填写' },
    confirmation: 'confirmed' as const,
  };
  return {
    ...next,
    assets: [
      ...next.assets,
      {
        ...common,
        id: input.id,
        name: input.name.trim(),
        kind: 'property',
        liquid: false,
        openingBalanceCents: yuan(input.priceYuan),
        annualReturnBps: basisPoints(0),
        acquiredMonth: input.month,
        purchase: {
          downPaymentFlowId: downId,
          ...(estimate.principal > 0 ? { liabilityId: loanId } : {}),
        },
      },
    ],
    standaloneCashFlows: [
      ...next.standaloneCashFlows,
      ...(input.downPaymentYuan > 0
        ? [
            {
              ...common,
              id: downId,
              name: input.name.trim(),
              direction: 'expense' as const,
              category: 'housing' as const,
              amountCents: yuan(input.downPaymentYuan),
              frequency: { kind: 'once' as const, postingMonth: input.month },
              startMonth: input.month,
              endMonthExclusive: addMonths(input.month, 1),
              annualGrowthBps: basisPoints(0),
            },
          ]
        : []),
    ],
    liabilities: [
      ...next.liabilities,
      ...(estimate.principal > 0
        ? [
            {
              ...common,
              id: loanId,
              name: input.name.trim(),
              kind: 'mortgage' as const,
              openingPrincipalCents: estimate.principal,
              annualInterestBps: estimate.rateBps,
              monthlyPaymentCents: estimate.payment,
              startMonth: input.month,
              endMonthExclusive: addMonths(input.month, estimate.months),
              originatesAtStart: true,
              interestMethod: 'nominal-monthly' as const,
            },
          ]
        : []),
    ],
    metadata: {
      ...next.metadata,
      excludedLifeStages: next.metadata.excludedLifeStages?.filter(
        (s) => s !== 'housing'
      ),
    },
  };
}
