import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateMonthlyLifePlan } from '../calculation';
import { basisPoints, moneyCents, type LifePlan } from '../domain';
import { extractPlanFacts, type PlanFacts } from './extract-facts';
import {
  analysisFixtures,
  createHousingChildOverlapFixture,
  createPersonalBaselineFixture,
} from './fixtures';
import {
  generateInsights,
  ruleMatches,
  type RuleId,
} from './generate-insights';

const plan = createPersonalBaselineFixture();
const facts = extractPlanFacts(plan, calculateMonthlyLifePlan(plan));
const sample = createHousingChildOverlapFixture().standaloneCashFlows;
const housing = {
  ...sample[0],
  startMonth: plan.baseMonth,
  endMonthExclusive: (plan.baseMonth + 1) as LifePlan['baseMonth'],
};
const child = {
  ...sample[1],
  startMonth: (plan.baseMonth + 24) as LifePlan['baseMonth'],
};
const retirement = plan.cashFlowBuckets.find((b) =>
  b.id.endsWith('retirement-expenses')
)!.summary!;
type Case = {
  id: RuleId;
  hit: Partial<PlanFacts>;
  boundary: Partial<PlanFacts>;
  miss: Partial<PlanFacts>;
  boundaryHit: boolean;
};
const cases: Case[] = [
  {
    id: 'housing-causes-first-gap',
    hit: { housing: [housing], firstGapMonth: plan.baseMonth },
    boundary: {
      housing: [housing],
      firstGapMonth: (plan.baseMonth + 12) as LifePlan['baseMonth'],
    },
    miss: {
      housing: [housing],
      firstGapMonth: (plan.baseMonth + 13) as LifePlan['baseMonth'],
    },
    boundaryHit: true,
  },
  {
    id: 'housing-child-overlap',
    hit: {
      housing: [housing],
      children: [{ ...child, startMonth: plan.baseMonth }],
    },
    boundary: { housing: [housing], children: [child] },
    miss: {
      housing: [housing],
      children: [
        {
          ...child,
          startMonth: (plan.baseMonth + 25) as LifePlan['baseMonth'],
        },
      ],
    },
    boundaryHit: true,
  },
  {
    id: 'liquidity-gap',
    hit: {
      liquidGap: {
        ...calculateMonthlyLifePlan(plan).monthly[0],
        netWorthCents: moneyCents(100),
        closingAvailableCents: moneyCents(-1),
      },
    },
    boundary: { liquidGap: undefined },
    miss: { liquidGap: undefined },
    boundaryHit: false,
  },
  {
    id: 'retirement-transition-gap',
    hit: { firstGapMonth: plan.retirementMonth, retirement: [] },
    boundary: {
      firstGapMonth: (plan.retirementMonth + 12) as LifePlan['baseMonth'],
      retirement: [],
    },
    miss: {
      firstGapMonth: (plan.retirementMonth - 1) as LifePlan['baseMonth'],
    },
    boundaryHit: false,
  },
  {
    id: 'retirement-spend-sensitive',
    hit: {
      retirement: [retirement],
      topInfluences: [
        {
          inputId: retirement.id,
          label: 'retirement',
          perturbation: '金额增加 10%',
          endingAvailableDeltaCents: moneyCents(-1),
          absoluteImpactCents: moneyCents(1),
        },
      ],
    },
    boundary: { retirement: [retirement], topInfluences: [] },
    miss: { retirement: [], topInfluences: [] },
    boundaryHit: false,
  },
  {
    id: 'zero-return-conservative',
    hit: { positiveMonths: 121 },
    boundary: { positiveMonths: 120 },
    miss: { positiveMonths: 119 },
    boundaryHit: true,
  },
  {
    id: 'important-total-unclassified',
    hit: { unclassifiedBuckets: [plan.cashFlowBuckets[1]] },
    boundary: { unclassifiedBuckets: [] },
    miss: { unclassifiedBuckets: [] },
    boundaryHit: false,
  },
  {
    id: 'baseline-sustainable',
    hit: { firstGapMonth: null, missingSections: [] },
    boundary: { firstGapMonth: null, missingSections: ['child'] },
    miss: { firstGapMonth: plan.baseMonth, missingSections: [] },
    boundaryHit: false,
  },
];
describe('Deterministic rule boundaries', () => {
  for (const c of cases)
    describe(c.id, () => {
      it('matches', () =>
        assert.equal(ruleMatches(c.id, plan, { ...facts, ...c.hit }), true));
      it('handles the boundary', () =>
        assert.equal(
          ruleMatches(c.id, plan, { ...facts, ...c.boundary }),
          c.boundaryHit
        ));
      it('does not match', () =>
        assert.equal(ruleMatches(c.id, plan, { ...facts, ...c.miss }), false));
    });
  it('is repeatable, capped and every reference points to a real input or trace', () => {
    for (const { plan } of analysisFixtures) {
      const result = calculateMonthlyLifePlan(plan);
      const a = generateInsights(plan, result);
      assert.deepEqual(a, generateInsights(plan, result));
      assert.ok(a.length <= 3);
      assert.equal(new Set(a.map((i) => i.target)).size, a.length);
      for (const i of a)
        assert.ok(
          i.traceIds.every((id) => result.traces.some((t) => t.id === id))
        );
    }
  });
  it('keeps the formal principal-only rule for imported legacy return values', () =>
    assert.equal(
      ruleMatches(
        'zero-return-conservative',
        {
          ...plan,
          assumptions: {
            ...plan.assumptions,
            annualLiquidReturnBps: basisPoints(100),
          },
        },
        { ...facts, positiveMonths: 200 }
      ),
      true
    ));
});
