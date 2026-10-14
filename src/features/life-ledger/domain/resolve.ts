import { moneyCents } from './primitives';
import type {
  CashFlowBucket,
  LifePlan,
  ResolutionTrace,
  ResolvedCashFlow,
  ResolvedPlan,
} from './types';
import { validateLifePlan } from './validation';

export class PlanResolutionError extends Error {
  readonly name = 'PlanResolutionError';

  constructor(readonly issues: ReturnType<typeof validateLifePlan>['issues']) {
    super('The life plan cannot be resolved because it contains invalid data.');
  }
}

function resolveBucket(bucket: CashFlowBucket): {
  flows: ResolvedCashFlow[];
  trace: ResolutionTrace;
} {
  const summaryMonthlyCents = moneyCents(bucket.summary?.amountCents ?? 0);
  const detailedMonthlyCents = moneyCents(
    bucket.details.reduce((total, flow) => total + flow.amountCents, 0)
  );

  if (bucket.mode === 'summary') {
    const summary = bucket.summary!;
    return {
      flows: [{ ...summary, resolution: 'summary', bucketId: bucket.id }],
      trace: {
        bucketId: bucket.id,
        mode: bucket.mode,
        includedFlowIds: [summary.id],
        summaryMonthlyCents,
        detailedMonthlyCents,
      },
    };
  }

  const flows: ResolvedCashFlow[] = bucket.details.map((flow) => ({
    ...flow,
    resolution: 'detail',
    bucketId: bucket.id,
  }));
  const includedFlowIds = flows.map((flow) => flow.id);
  let generatedUnallocatedFlowId: string | undefined;
  const remainder = summaryMonthlyCents - detailedMonthlyCents;
  if (bucket.summary && remainder > 0) {
    generatedUnallocatedFlowId = `${bucket.id}:unallocated`;
    flows.push({
      ...bucket.summary,
      id: generatedUnallocatedFlowId,
      name: `${bucket.name} · 待分类`,
      category: 'other',
      amountCents: moneyCents(remainder),
      resolution: 'unallocated',
      bucketId: bucket.id,
    });
    includedFlowIds.push(generatedUnallocatedFlowId);
  }

  return {
    flows,
    trace: {
      bucketId: bucket.id,
      mode: bucket.mode,
      excludedSummaryId: bucket.summary?.id,
      includedFlowIds,
      generatedUnallocatedFlowId,
      summaryMonthlyCents,
      detailedMonthlyCents,
    },
  };
}

export function resolveLifePlan(plan: LifePlan): ResolvedPlan {
  const validation = validateLifePlan(plan);
  if (!validation.valid) throw new PlanResolutionError(validation.issues);

  const resolved = plan.cashFlowBuckets.map(resolveBucket);
  return {
    plan,
    cashFlows: [
      ...resolved.flatMap((value) => value.flows),
      ...plan.standaloneCashFlows.map((flow) => ({
        ...flow,
        resolution: 'standalone' as const,
      })),
    ],
    traces: resolved.map((value) => value.trace),
  };
}
