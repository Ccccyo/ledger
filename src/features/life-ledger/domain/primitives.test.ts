import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  basisPoints,
  growMoney,
  moneyCents,
  monthIndex,
  monthlyRateFromAnnualBps,
  roundMoney,
  yuan,
} from './index';

describe('P0 amount, time and rate primitives', () => {
  it('stores yuan as integer cents and rejects fractional cents', () => {
    assert.equal(yuan(12.34), 1_234);
    assert.throws(() => moneyCents(1.5));
  });

  it('uses symmetric rounding for negative money', () => {
    assert.equal(roundMoney(1.5), 2);
    assert.equal(roundMoney(-1.5), -2);
  });

  it('uses a stable, sortable month index', () => {
    assert.equal(monthIndex(2027, 1) - monthIndex(2026, 1), 12);
    assert.throws(() => monthIndex(2026, 13));
  });

  it('converts annual rates to an equivalent monthly compound rate', () => {
    const annualRate = basisPoints(1_200);
    const monthlyRate = monthlyRateFromAnnualBps(annualRate);
    assert.ok(Math.abs(Math.pow(1 + monthlyRate, 12) - 1.12) < 1e-12);
    assert.equal(growMoney(yuan(100), annualRate, 12), yuan(112));
  });
});
