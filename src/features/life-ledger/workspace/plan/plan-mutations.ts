import {
  basisPoints,
  moneyCents,
  type CashFlowCategory,
  type LifePlan,
} from '../../domain';

export function findBucket(plan: LifePlan, suffix: string) {
  return plan.cashFlowBuckets.find((bucket) => bucket.id.endsWith(suffix));
}

export function updateBucketSummary(
  plan: LifePlan,
  suffix: string,
  amountCents: number
): LifePlan {
  return {
    ...plan,
    cashFlowBuckets: plan.cashFlowBuckets.map((bucket) =>
      bucket.id.endsWith(suffix) && bucket.summary
        ? {
            ...bucket,
            summary: {
              ...bucket.summary,
              amountCents: moneyCents(amountCents),
            },
            confirmedDetailedTotalCents: undefined,
          }
        : bucket
    ),
    metadata: { ...plan.metadata, updatedAt: new Date().toISOString() },
  };
}

export function updateRetirementPension(
  plan: LifePlan,
  amountCents: number,
  name = '养老金及稳定收入'
): LifePlan {
  const existing = plan.standaloneCashFlows.find(
    (flow) =>
      flow.ownerId === plan.primaryMemberId && flow.category === 'pension'
  );
  const remaining = plan.standaloneCashFlows.filter(
    (flow) => flow.id !== existing?.id
  );
  if (amountCents === 0) return { ...plan, standaloneCashFlows: remaining };
  return {
    ...plan,
    standaloneCashFlows: [
      ...remaining,
      {
        id: existing?.id ?? `${plan.id}:retirement-pension`,
        name,
        ownerId: plan.primaryMemberId,
        direction: 'income',
        category: 'pension',
        amountCents: moneyCents(amountCents),
        frequency: { kind: 'monthly' },
        startMonth: plan.retirementMonth,
        endMonthExclusive: plan.endMonthExclusive,
        annualGrowthBps: basisPoints(0),
        source: { kind: 'user', label: '用户填写' },
        confirmation: 'confirmed',
      },
    ],
  };
}

export function updateCategoryDetail(
  plan: LifePlan,
  category: CashFlowCategory,
  amountCents: number,
  name: string = category
): LifePlan {
  const suffix = 'working-expenses';
  return {
    ...plan,
    cashFlowBuckets: plan.cashFlowBuckets.map((bucket) => {
      if (!bucket.id.endsWith(suffix) || !bucket.summary) return bucket;
      const existing = bucket.details.find(
        (flow) => flow.category === category
      );
      const details = existing
        ? bucket.details.map((flow) =>
            flow.id === existing.id
              ? { ...flow, amountCents: moneyCents(amountCents) }
              : flow
          )
        : [
            ...bucket.details,
            {
              ...bucket.summary,
              id: `${bucket.id}:${category}`,
              name,
              category,
              amountCents: moneyCents(amountCents),
            },
          ];
      const total = details.reduce((sum, flow) => sum + flow.amountCents, 0);
      return {
        ...bucket,
        mode: 'detailed' as const,
        details,
        confirmedDetailedTotalCents:
          total > bucket.summary.amountCents &&
          bucket.confirmedDetailedTotalCents === total
            ? bucket.confirmedDetailedTotalCents
            : undefined,
      };
    }),
    metadata: { ...plan.metadata, updatedAt: new Date().toISOString() },
  };
}

export function confirmDetailedTotal(plan: LifePlan): LifePlan {
  return {
    ...plan,
    cashFlowBuckets: plan.cashFlowBuckets.map((bucket) => {
      if (!bucket.id.endsWith('working-expenses') || !bucket.summary) {
        return bucket;
      }
      const detailedTotal = moneyCents(
        bucket.details.reduce((sum, flow) => sum + flow.amountCents, 0)
      );
      return {
        ...bucket,
        summary: { ...bucket.summary, amountCents: detailedTotal },
        confirmedDetailedTotalCents: undefined,
      };
    }),
    metadata: { ...plan.metadata, updatedAt: new Date().toISOString() },
  };
}

export function updateAges(
  plan: LifePlan,
  currentAge: number,
  retirementAge: number,
  endAge: number
): LifePlan {
  if (
    !(
      currentAge >= 18 &&
      retirementAge > currentAge &&
      endAge > retirementAge &&
      endAge <= 120
    )
  )
    return plan;
  const retirementMonth = (plan.baseMonth +
    (retirementAge - currentAge) * 12) as LifePlan['retirementMonth'];
  const endMonthExclusive = (plan.baseMonth +
    (endAge - currentAge) * 12) as LifePlan['endMonthExclusive'];
  return {
    ...plan,
    retirementMonth,
    endMonthExclusive,
    members: plan.members.map((member) =>
      member.id === plan.primaryMemberId
        ? {
            ...member,
            birthMonth: (plan.baseMonth -
              currentAge * 12) as LifePlan['baseMonth'],
          }
        : member
    ),
    cashFlowBuckets: plan.cashFlowBuckets.map((bucket) => ({
      ...bucket,
      summary: bucket.summary
        ? {
            ...bucket.summary,
            startMonth:
              bucket.summary.startMonth === plan.retirementMonth
                ? retirementMonth
                : bucket.summary.startMonth,
            endMonthExclusive:
              bucket.summary.endMonthExclusive === plan.endMonthExclusive
                ? endMonthExclusive
                : bucket.summary.endMonthExclusive === plan.retirementMonth
                  ? retirementMonth
                  : bucket.summary.endMonthExclusive,
          }
        : undefined,
      details: bucket.details.map((flow) => ({
        ...flow,
        startMonth:
          flow.startMonth === plan.retirementMonth
            ? retirementMonth
            : flow.startMonth,
        endMonthExclusive:
          flow.endMonthExclusive === plan.endMonthExclusive
            ? endMonthExclusive
            : flow.endMonthExclusive === plan.retirementMonth
              ? retirementMonth
              : flow.endMonthExclusive,
      })),
    })),
    standaloneCashFlows: plan.standaloneCashFlows.map((flow) =>
      flow.category === 'pension' && flow.ownerId === plan.primaryMemberId
        ? {
            ...flow,
            startMonth: retirementMonth,
            endMonthExclusive,
          }
        : flow
    ),
  };
}
