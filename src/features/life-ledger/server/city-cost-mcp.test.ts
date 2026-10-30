import assert from 'node:assert/strict';
import { it } from 'node:test';

import { lookupCityCostsViaMcp } from './city-cost-mcp';

it('calls the city tool through MCP and labels synthetic data', async () => {
  const result = await lookupCityCostsViaMcp({
    fromCity: '上海',
    toCity: '杭州',
    householdSize: 2,
    housingMode: 'rent',
  });
  assert.equal(result.source.mode, 'demo');
  assert.equal(result.source.datasetVersion, 'demo-2026-10-23');
  assert.equal(result.housingMonthlyChangeCents, -250_000);
  assert.match(result.source.disclaimer, /合成演示数据/);
});

it('returns a business error for a city outside the demo dataset', async () => {
  await assert.rejects(
    lookupCityCostsViaMcp({
      fromCity: '上海',
      toCity: '火星城',
      householdSize: 1,
      housingMode: 'unknown',
    }),
    /演示数据暂不包含/
  );
});
