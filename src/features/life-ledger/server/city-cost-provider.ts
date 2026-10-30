import type {
  CityCostCandidate,
  CityCostLookupInput,
} from '../workspace/agent/city-cost-types';

interface DemoCityCostRow {
  housingRentCents: number;
  housingOwnCents: number;
  livingCents: number;
  movingBaseCents: number;
}

/**
 * Synthetic, versioned fixtures for demonstrating the MCP and confirmation
 * workflow. They are deliberately not labelled as current market data.
 */
const DEMO_CITY_COSTS: Record<string, DemoCityCostRow> = {
  北京: {
    housingRentCents: 900_000,
    housingOwnCents: 650_000,
    livingCents: 520_000,
    movingBaseCents: 180_000,
  },
  上海: {
    housingRentCents: 950_000,
    housingOwnCents: 680_000,
    livingCents: 550_000,
    movingBaseCents: 180_000,
  },
  杭州: {
    housingRentCents: 700_000,
    housingOwnCents: 520_000,
    livingCents: 430_000,
    movingBaseCents: 160_000,
  },
  深圳: {
    housingRentCents: 900_000,
    housingOwnCents: 640_000,
    livingCents: 500_000,
    movingBaseCents: 180_000,
  },
  广州: {
    housingRentCents: 650_000,
    housingOwnCents: 480_000,
    livingCents: 400_000,
    movingBaseCents: 150_000,
  },
  成都: {
    housingRentCents: 450_000,
    housingOwnCents: 350_000,
    livingCents: 330_000,
    movingBaseCents: 140_000,
  },
  武汉: {
    housingRentCents: 400_000,
    housingOwnCents: 320_000,
    livingCents: 310_000,
    movingBaseCents: 140_000,
  },
};

function range(value: number, ratio: number): [number, number] {
  const spread = Math.max(50_000, Math.round(Math.abs(value) * ratio));
  return [value - spread, value + spread];
}

function householdLiving(row: DemoCityCostRow, householdSize: number) {
  return Math.round(row.livingCents * (1 + (householdSize - 1) * 0.58));
}

export function lookupDemoCityCosts(
  input: CityCostLookupInput,
  now = new Date()
): CityCostCandidate {
  const from = DEMO_CITY_COSTS[input.fromCity];
  const to = DEMO_CITY_COSTS[input.toCity];
  if (!from || !to) {
    const supported = Object.keys(DEMO_CITY_COSTS).join('、');
    throw new Error(`演示数据暂不包含该城市。当前支持：${supported}。`);
  }
  const housingKey =
    input.housingMode === 'own' ? 'housingOwnCents' : 'housingRentCents';
  const housingChange = to[housingKey] - from[housingKey];
  const livingChange =
    householdLiving(to, input.householdSize) -
    householdLiving(from, input.householdSize);
  const movingExpense = Math.max(from.movingBaseCents, to.movingBaseCents);
  return {
    kind: 'city-cost-candidate',
    fromCity: input.fromCity,
    toCity: input.toCity,
    householdSize: input.householdSize,
    housingMode: input.housingMode,
    currency: 'CNY',
    housingMonthlyChangeCents: housingChange,
    livingMonthlyChangeCents: livingChange,
    movingExpenseCandidateCents: movingExpense,
    ranges: {
      housingMonthlyChangeCents: range(housingChange, 0.15),
      livingMonthlyChangeCents: range(livingChange, 0.12),
      movingExpenseCents: range(movingExpense, 0.25),
    },
    source: {
      provider: 'life-ledger-synthetic-city-costs',
      mode: 'demo',
      datasetVersion: 'demo-2026-10-23',
      observedAt: '2026-10-23',
      retrievedAt: now.toISOString(),
      referenceUrl: null,
      disclaimer:
        '合成演示数据，仅用于验证 MCP、试算和确认流程；不代表当前市场价格。',
    },
  };
}

export function supportedDemoCities() {
  return Object.keys(DEMO_CITY_COSTS);
}
