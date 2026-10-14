import assert from 'node:assert/strict';
import { it } from 'node:test';

import {
  balanceAgeTicks,
  balanceChartScale,
  balanceZeroOffset,
} from './balance-chart-scale';

it('age ticks retain endpoints and use readable decade ages without adjacent labels', () => {
  const rows = Array.from({ length: 63 }, (_, i) => ({
    year: 2026 + i,
    ageEnd: 28 + i,
  }));
  assert.deepEqual(
    balanceAgeTicks(rows),
    [2026, 2038, 2048, 2058, 2068, 2078, 2088]
  );
  assert.deepEqual(balanceAgeTicks([]), []);
  assert.deepEqual(balanceAgeTicks(rows.slice(0, 1)), [2026]);
});

it('balance axes include zero and all positive, negative, mixed and empty values', () => {
  for (const values of [
    [],
    [0],
    [49_710_000],
    [-674_400_000, -16_500_000],
    [-340_000, 25_000_000],
    [1],
    [-1, 1],
  ]) {
    const { domain, ticks } = balanceChartScale(values);
    assert.ok(domain[0] < domain[1]);
    assert.ok(ticks.includes(0));
    assert.ok(values.every((n) => n >= domain[0] && n <= domain[1]));
    assert.ok(ticks.every((n, i) => !i || n > ticks[i - 1]));
    assert.ok(ticks.length <= 7);
  }
});

it('area colour changes at the actual cash zero, independent of net worth or padded axes', () => {
  assert.equal(balanceZeroOffset([1, 200]), 1);
  assert.equal(balanceZeroOffset([-200, -1]), 0);
  assert.equal(balanceZeroOffset([-100, 300]), 0.75);
  assert.equal(balanceZeroOffset([0]), 1);
});
