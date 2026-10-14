import type {
  CashFlowBucket,
  CashFlowItem,
  LifePlan,
  MoneyCents,
  MonthIndex,
} from './types';

export type PlanIssueCode =
  | 'UNSUPPORTED_SCHEMA'
  | 'UNSAFE_MONEY'
  | 'INVALID_MONTH_RANGE'
  | 'INVALID_RATE'
  | 'MISSING_MEMBER'
  | 'MISSING_SOURCE'
  | 'PENDING_AGENT_VALUE'
  | 'DUPLICATE_ID'
  | 'INVALID_BUCKET_FLOW'
  | 'MISSING_SUMMARY'
  | 'DETAILS_EXCEED_SUMMARY'
  | 'INVALID_CONFIRMED_TOTAL'
  | 'RETIREMENT_OUTSIDE_PLAN'
  | 'INVALID_LIFE_STAGE'
  | 'INVALID_CAREER_CHANGE';

export interface PlanIssue {
  code: PlanIssueCode;
  path: string;
  severity: 'error' | 'warning';
  messageKey: string;
  recovery?: string;
}

export interface PlanValidationResult {
  valid: boolean;
  issues: PlanIssue[];
}

function issue(
  code: PlanIssueCode,
  path: string,
  messageKey: string,
  recovery?: string,
  severity: PlanIssue['severity'] = 'error'
): PlanIssue {
  return { code, path, severity, messageKey, recovery };
}

function validMoney(value: MoneyCents) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validMonth(value: MonthIndex) {
  return Number.isSafeInteger(value);
}

function validateFlow(
  flow: CashFlowItem,
  path: string,
  memberIds: Set<string>,
  seenIds: Set<string>,
  issues: PlanIssue[]
) {
  if (seenIds.has(flow.id)) {
    issues.push(issue('DUPLICATE_ID', `${path}.id`, 'plan.duplicateId'));
  }
  seenIds.add(flow.id);

  if (!validMoney(flow.amountCents)) {
    issues.push(
      issue('UNSAFE_MONEY', `${path}.amountCents`, 'plan.money.integerCents')
    );
  }
  if (
    !validMonth(flow.startMonth) ||
    !validMonth(flow.endMonthExclusive) ||
    flow.startMonth >= flow.endMonthExclusive
  ) {
    issues.push(issue('INVALID_MONTH_RANGE', path, 'plan.time.invalidRange'));
  }
  if (!memberIds.has(flow.ownerId)) {
    issues.push(
      issue('MISSING_MEMBER', `${path}.ownerId`, 'plan.member.missing')
    );
  }
  if (!flow.source?.kind || !flow.source.label) {
    issues.push(
      issue('MISSING_SOURCE', `${path}.source`, 'plan.source.required')
    );
  }
  if (flow.source?.kind === 'external') {
    if (!flow.source.region || !flow.source.effectiveMonth) {
      issues.push(
        issue(
          'MISSING_SOURCE',
          `${path}.source`,
          'plan.source.externalEvidenceRequired'
        )
      );
    }
  }
  if (flow.source?.kind === 'agent' && flow.confirmation !== 'confirmed') {
    issues.push(
      issue(
        'PENDING_AGENT_VALUE',
        `${path}.confirmation`,
        'plan.agent.confirmationRequired',
        'Confirm or remove the Agent suggestion before calculating.'
      )
    );
  }
  if (
    !Number.isSafeInteger(flow.annualGrowthBps) ||
    flow.annualGrowthBps <= -10_000
  ) {
    issues.push(
      issue('INVALID_RATE', `${path}.annualGrowthBps`, 'plan.rate.invalid')
    );
  }
  if (flow.frequency.kind === 'yearly') {
    if (
      !Number.isSafeInteger(flow.frequency.postingMonth) ||
      flow.frequency.postingMonth < 1 ||
      flow.frequency.postingMonth > 12
    ) {
      issues.push(
        issue(
          'INVALID_MONTH_RANGE',
          `${path}.frequency.postingMonth`,
          'plan.time.invalidPostingMonth'
        )
      );
    }
  }
}

function monthlyAmount(flow: CashFlowItem): number | null {
  return flow.frequency.kind === 'monthly' ? flow.amountCents : null;
}

function validateBucket(
  bucket: CashFlowBucket,
  path: string,
  memberIds: Set<string>,
  seenIds: Set<string>,
  issues: PlanIssue[]
) {
  if (seenIds.has(bucket.id)) {
    issues.push(issue('DUPLICATE_ID', `${path}.id`, 'plan.duplicateId'));
  }
  seenIds.add(bucket.id);

  if (bucket.mode === 'summary' && !bucket.summary) {
    issues.push(
      issue('MISSING_SUMMARY', `${path}.summary`, 'plan.bucket.summaryRequired')
    );
  }

  const flows = [
    ...(bucket.summary ? [[bucket.summary, `${path}.summary`] as const] : []),
    ...bucket.details.map(
      (flow, index) => [flow, `${path}.details.${index}`] as const
    ),
  ];
  for (const [flow, flowPath] of flows) {
    validateFlow(flow, flowPath, memberIds, seenIds, issues);
    if (
      flow.direction !== bucket.direction ||
      flow.frequency.kind !== 'monthly'
    ) {
      issues.push(
        issue(
          'INVALID_BUCKET_FLOW',
          flowPath,
          'plan.bucket.monthlyMatchingDirectionOnly',
          'Move yearly or one-time values to standalone cash flows.'
        )
      );
    }
  }

  if (bucket.mode !== 'detailed' || !bucket.summary) return;
  const summary = monthlyAmount(bucket.summary);
  const details = bucket.details.reduce(
    (total, flow) => total + (monthlyAmount(flow) ?? 0),
    0
  );
  if (summary === null) return;
  if (details > summary && bucket.confirmedDetailedTotalCents === undefined) {
    issues.push(
      issue(
        'DETAILS_EXCEED_SUMMARY',
        path,
        'plan.bucket.detailsExceedSummary',
        'Confirm the detailed total as the new total before calculating.'
      )
    );
  }
  if (
    bucket.confirmedDetailedTotalCents !== undefined &&
    bucket.confirmedDetailedTotalCents !== details
  ) {
    issues.push(
      issue(
        'INVALID_CONFIRMED_TOTAL',
        `${path}.confirmedDetailedTotalCents`,
        'plan.bucket.confirmedTotalMismatch'
      )
    );
  }
}

export function validateLifePlan(plan: LifePlan): PlanValidationResult {
  const issues: PlanIssue[] = [];
  const exclusions = plan.metadata?.excludedLifeStages;
  if (
    exclusions !== undefined &&
    (!Array.isArray(exclusions) ||
      exclusions.some(
        (stage) =>
          !['career', 'partner', 'child', 'housing', 'parents'].includes(stage)
      ))
  ) {
    issues.push(
      issue(
        'INVALID_LIFE_STAGE',
        'metadata.excludedLifeStages',
        'plan.stage.invalid'
      )
    );
  }
  if (plan.schemaVersion !== '2.0.0') {
    issues.push(
      issue('UNSUPPORTED_SCHEMA', 'schemaVersion', 'plan.schema.unsupported')
    );
  }
  if (
    !validMonth(plan.baseMonth) ||
    !validMonth(plan.endMonthExclusive) ||
    plan.baseMonth >= plan.endMonthExclusive
  ) {
    issues.push(issue('INVALID_MONTH_RANGE', 'plan', 'plan.time.invalidRange'));
  }
  if (
    plan.retirementMonth <= plan.baseMonth ||
    plan.retirementMonth >= plan.endMonthExclusive
  ) {
    issues.push(
      issue(
        'RETIREMENT_OUTSIDE_PLAN',
        'retirementMonth',
        'plan.retirement.outsidePlan'
      )
    );
  }

  const memberIds = new Set(plan.members.map((member) => member.id));
  if (!memberIds.has(plan.primaryMemberId)) {
    issues.push(
      issue('MISSING_MEMBER', 'primaryMemberId', 'plan.member.primaryMissing')
    );
  }
  const seenIds = new Set<string>();
  for (const member of plan.members) {
    if (seenIds.has(member.id)) {
      issues.push(
        issue('DUPLICATE_ID', `members.${member.id}`, 'plan.duplicateId')
      );
    }
    seenIds.add(member.id);
  }
  plan.cashFlowBuckets.forEach((bucket, index) =>
    validateBucket(
      bucket,
      `cashFlowBuckets.${index}`,
      memberIds,
      seenIds,
      issues
    )
  );
  plan.standaloneCashFlows.forEach((flow, index) =>
    validateFlow(
      flow,
      `standaloneCashFlows.${index}`,
      memberIds,
      seenIds,
      issues
    )
  );

  const overrides = plan.standaloneCashFlows.filter(
    (f) => f.incomeTreatment !== undefined
  );
  for (const flow of overrides) {
    if (
      flow.incomeTreatment !== 'replace-salary' ||
      flow.category !== 'salary' ||
      flow.direction !== 'income' ||
      flow.ownerId !== plan.primaryMemberId ||
      flow.frequency.kind !== 'monthly' ||
      flow.startMonth < plan.baseMonth ||
      flow.endMonthExclusive > plan.retirementMonth ||
      overrides.some(
        (other) =>
          other.id !== flow.id &&
          (other.amountCents === 0) === (flow.amountCents === 0) &&
          other.startMonth < flow.endMonthExclusive &&
          flow.startMonth < other.endMonthExclusive
      )
    ) {
      issues.push(
        issue(
          'INVALID_CAREER_CHANGE',
          `standaloneCashFlows.${flow.id}`,
          'plan.career.invalidOrOverlapping'
        )
      );
    }
  }
  if (overrides.length && plan.cashFlowBuckets.some((b) => b.direction === 'income' && b.mode === 'detailed' && b.summary && b.details.reduce((sum,f) => sum + f.amountCents,0) < b.summary.amountCents)) issues.push(issue('INVALID_CAREER_CHANGE','cashFlowBuckets','plan.career.classifySalaryFirst'));
  if (
    plan.cashFlowBuckets.some((b) =>
      [b.summary, ...b.details].some((f) => f?.incomeTreatment !== undefined)
    )
  ) {
    issues.push(
      issue(
        'INVALID_CAREER_CHANGE',
        'cashFlowBuckets',
        'plan.career.standaloneOnly'
      )
    );
  }

  for (const [collectionName, values] of [
    ['assets', plan.assets],
    ['liabilities', plan.liabilities],
  ] as const) {
    values.forEach((value, index) => {
      const path = `${collectionName}.${index}`;
      if (seenIds.has(value.id))
        issues.push(issue('DUPLICATE_ID', `${path}.id`, 'plan.duplicateId'));
      seenIds.add(value.id);
      if (!memberIds.has(value.ownerId))
        issues.push(
          issue('MISSING_MEMBER', `${path}.ownerId`, 'plan.member.missing')
        );
      if (!value.source?.kind || !value.source.label)
        issues.push(
          issue('MISSING_SOURCE', `${path}.source`, 'plan.source.required')
        );
      if (
        value.source?.kind === 'agent' &&
        value.confirmation !== 'confirmed'
      ) {
        issues.push(
          issue(
            'PENDING_AGENT_VALUE',
            `${path}.confirmation`,
            'plan.agent.confirmationRequired'
          )
        );
      }
    });
  }

  plan.assets.forEach((asset, index) => {
    if (!validMoney(asset.openingBalanceCents))
      issues.push(
        issue(
          'UNSAFE_MONEY',
          `assets.${index}.openingBalanceCents`,
          'plan.money.integerCents'
        )
      );
    if (
      !Number.isSafeInteger(asset.annualReturnBps) ||
      asset.annualReturnBps <= -10_000
    )
      issues.push(
        issue(
          'INVALID_RATE',
          `assets.${index}.annualReturnBps`,
          'plan.rate.invalid'
        )
      );
  });
  plan.liabilities.forEach((liability, index) => {
    if (
      !validMoney(liability.openingPrincipalCents) ||
      !validMoney(liability.monthlyPaymentCents)
    )
      issues.push(
        issue('UNSAFE_MONEY', `liabilities.${index}`, 'plan.money.integerCents')
      );
    if (
      !Number.isSafeInteger(liability.annualInterestBps) ||
      liability.annualInterestBps < 0
    )
      issues.push(
        issue(
          'INVALID_RATE',
          `liabilities.${index}.annualInterestBps`,
          'plan.rate.invalid'
        )
      );
    if (liability.startMonth >= liability.endMonthExclusive)
      issues.push(
        issue(
          'INVALID_MONTH_RANGE',
          `liabilities.${index}`,
          'plan.time.invalidRange'
        )
      );
  });

  return { valid: !issues.some((value) => value.severity === 'error'), issues };
}
