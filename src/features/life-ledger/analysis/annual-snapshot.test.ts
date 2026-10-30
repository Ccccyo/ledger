import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateMonthlyLifePlan, type AnnualLedgerRow } from '../calculation';
import { createQuickLifePlan, moneyCents, monthParts } from '../domain';
import {
  buildAnnualFlowDiagram,
  buildAnnualSnapshot,
  compactAnnualFlowDiagram,
  selectInitialSnapshotYear,
} from './annual-snapshot';

function annualRow(patch: Partial<AnnualLedgerRow> = {}): AnnualLedgerRow {
  return {
    year: 2030,
    ageStart: 34,
    ageEnd: 35,
    phase: 'working',
    openingAvailableCents: moneyCents(0),
    openingReservedInvestmentCents: moneyCents(0),
    incomeCents: moneyCents(1000),
    expenseCents: moneyCents(600),
    liquidReturnCents: moneyCents(100),
    investmentAllocatedCents: moneyCents(0),
    investmentReleasedCents: moneyCents(0),
    netCashFlowCents: moneyCents(400),
    closingAvailableCents: moneyCents(500),
    closingReservedInvestmentCents: moneyCents(0),
    minimumAvailableCents: moneyCents(0),
    closingNonLiquidAssetsCents: moneyCents(0),
    closingDebtBalanceCents: moneyCents(0),
    closingNetWorthCents: moneyCents(500),
    incomeByCategory: { salary: moneyCents(1000) },
    expenseByCategory: { living: moneyCents(600) },
    ...patch,
  };
}

describe('annual snapshot adapter', () => {
  it('balances a positive year with an explicit annual surplus', () => {
    const diagram = buildAnnualFlowDiagram(annualRow());
    assert.equal(diagram.sourceTotalCents, 1100);
    assert.equal(diagram.useTotalCents, 1100);
    assert.equal(
      diagram.nodes.find((node) => node.category === 'annual-surplus')
        ?.amountCents,
      500
    );
    assert.equal(
      diagram.nodes.find((node) => node.category === 'liquid-return')
        ?.amountCents,
      100
    );
  });

  it('separates opening drawdown from a newly formed funding gap', () => {
    const diagram = buildAnnualFlowDiagram(
      annualRow({
        openingAvailableCents: moneyCents(200),
        incomeCents: moneyCents(500),
        expenseCents: moneyCents(1000),
        liquidReturnCents: moneyCents(0),
        netCashFlowCents: moneyCents(-500),
        closingAvailableCents: moneyCents(-300),
        minimumAvailableCents: moneyCents(-300),
        incomeByCategory: { salary: moneyCents(500) },
        expenseByCategory: { living: moneyCents(1000) },
      })
    );
    assert.equal(diagram.sourceTotalCents, diagram.useTotalCents);
    assert.equal(
      diagram.nodes.find((node) => node.category === 'opening-drawdown')
        ?.amountCents,
      200
    );
    assert.equal(
      diagram.nodes.find((node) => node.category === 'new-gap')?.amountCents,
      300
    );
  });

  it('treats a negative liquid return as a use of funds', () => {
    const diagram = buildAnnualFlowDiagram(
      annualRow({
        liquidReturnCents: moneyCents(-100),
        netCashFlowCents: moneyCents(400),
        closingAvailableCents: moneyCents(300),
      })
    );
    assert.equal(diagram.sourceTotalCents, diagram.useTotalCents);
    assert.equal(
      diagram.nodes.find((node) => node.category === 'liquid-loss')
        ?.amountCents,
      100
    );
    assert.equal(
      diagram.nodes.find((node) => node.category === 'annual-surplus')
        ?.amountCents,
      300
    );
  });

  it('shows reserved investment principal as a use of funds', () => {
    const diagram = buildAnnualFlowDiagram(
      annualRow({
        investmentAllocatedCents: moneyCents(300),
        closingAvailableCents: moneyCents(200),
        closingReservedInvestmentCents: moneyCents(300),
      })
    );
    assert.equal(diagram.sourceTotalCents, diagram.useTotalCents);
    assert.equal(
      diagram.nodes.find((node) => node.category === 'investment-allocation')
        ?.amountCents,
      300
    );
    assert.equal(
      diagram.nodes.find((node) => node.category === 'annual-surplus')
        ?.amountCents,
      200
    );
  });

  it('carries held investment principal through every intervening year', () => {
    const diagram = buildAnnualFlowDiagram(
      annualRow({
        openingReservedInvestmentCents: moneyCents(300),
        closingReservedInvestmentCents: moneyCents(300),
      })
    );
    assert.equal(diagram.sourceTotalCents, diagram.useTotalCents);
    assert.equal(
      diagram.nodes.find((node) => node.category === 'investment-carried-in')
        ?.amountCents,
      300
    );
    assert.equal(
      diagram.nodes.find((node) => node.category === 'investment-held')
        ?.amountCents,
      300
    );
  });

  it('groups small categories without losing cents', () => {
    const diagram = buildAnnualFlowDiagram(
      annualRow({
        incomeCents: moneyCents(1000),
        expenseCents: moneyCents(1000),
        liquidReturnCents: moneyCents(0),
        netCashFlowCents: moneyCents(0),
        closingAvailableCents: moneyCents(0),
        incomeByCategory: {
          salary: moneyCents(970),
          side_income: moneyCents(20),
          other: moneyCents(10),
        },
        expenseByCategory: { living: moneyCents(1000) },
      })
    );
    assert.equal(
      diagram.nodes.find((node) => node.category === 'other-income')
        ?.amountCents,
      30
    );
    assert.equal(diagram.sourceTotalCents, 1000);
    assert.equal(diagram.useTotalCents, 1000);
  });

  it('compacts a crowded chart without changing either side total', () => {
    const full = buildAnnualFlowDiagram(
      annualRow({
        incomeCents: moneyCents(198_000),
        expenseCents: moneyCents(105_000),
        liquidReturnCents: moneyCents(0),
        netCashFlowCents: moneyCents(93_000),
        closingAvailableCents: moneyCents(93_000),
        incomeByCategory: {
          salary: moneyCents(180_000),
          other: moneyCents(18_000),
        },
        expenseByCategory: {
          self_wellness: moneyCents(54_000),
          self_hobbies: moneyCents(27_000),
          retirement: moneyCents(10_000),
          living: moneyCents(6_000),
          self_travel: moneyCents(5_000),
          self_learning: moneyCents(3_000),
        },
      })
    );
    const compacted = compactAnnualFlowDiagram(full, 4);
    const uses = compacted.nodes.filter((node) => node.side === 'use');

    assert.equal(uses.length, 4);
    assert.equal(
      uses.find((node) => node.category === 'other-expense')?.amountCents,
      moneyCents(24_000)
    );
    assert.equal(
      uses.reduce((sum, node) => sum + node.amountCents, 0),
      full.useTotalCents
    );
    assert.equal(compacted.sourceTotalCents, compacted.useTotalCents);
  });

  it('keeps structural flow nodes visible when compacting categories', () => {
    const full = buildAnnualFlowDiagram(
      annualRow({
        incomeCents: moneyCents(500),
        expenseCents: moneyCents(1000),
        liquidReturnCents: moneyCents(0),
        openingAvailableCents: moneyCents(100),
        netCashFlowCents: moneyCents(-500),
        closingAvailableCents: moneyCents(-400),
        minimumAvailableCents: moneyCents(-400),
        incomeByCategory: {
          salary: moneyCents(350),
          side_income: moneyCents(100),
          other: moneyCents(50),
        },
        expenseByCategory: { living: moneyCents(1000) },
      })
    );
    const compacted = compactAnnualFlowDiagram(full, 2);

    assert.ok(
      compacted.nodes.some((node) => node.category === 'opening-drawdown')
    );
    assert.ok(compacted.nodes.some((node) => node.category === 'new-gap'));
  });

  it('copies annual ledger facts without recalculating page values', () => {
    const snapshot = buildAnnualSnapshot(annualRow());
    assert.equal(snapshot.annualAvailableChangeCents, 500);
    assert.equal(snapshot.closingAvailableCents, 500);
    assert.equal(snapshot.closingNetWorthCents, 500);
    assert.equal(snapshot.minimumAvailableCents, 0);
  });

  it('rejects category totals that exceed the declared ledger total', () => {
    assert.throws(() =>
      buildAnnualFlowDiagram(
        annualRow({
          incomeCents: moneyCents(500),
          incomeByCategory: { salary: moneyCents(600) },
        })
      )
    );
  });
});

describe('initial snapshot selection', () => {
  it('uses a valid remembered year', () => {
    const result = calculateMonthlyLifePlan(
      createQuickLifePlan({
        baseYear: 2026,
        currentAge: 30,
        retirementAge: 60,
        endAge: 65,
      })
    );
    const preferred = result.annual[2].year;
    assert.equal(selectInitialSnapshotYear(result, preferred), preferred);
  });

  it('uses the first gap year when a gap exists', () => {
    const result = calculateMonthlyLifePlan(
      createQuickLifePlan({
        baseYear: 2026,
        currentAge: 30,
        retirementAge: 60,
        endAge: 65,
        currentSavingsYuan: 0,
        monthlyIncomeYuan: 0,
        monthlyWorkingExpensesYuan: 1000,
        monthlyRetirementSelfFundedYuan: 1000,
      })
    );
    assert.notEqual(result.summary.firstGapYear, null);
    assert.equal(
      selectInitialSnapshotYear(result),
      result.summary.firstGapYear
    );
  });

  it('uses retirement when the opening balance remains the minimum', () => {
    const result = calculateMonthlyLifePlan(
      createQuickLifePlan({
        baseYear: 2026,
        currentAge: 30,
        retirementAge: 60,
        endAge: 65,
        currentSavingsYuan: 0,
        monthlyIncomeYuan: 10000,
        monthlyWorkingExpensesYuan: 1000,
        monthlyRetirementSelfFundedYuan: 0,
      })
    );
    assert.equal(result.summary.hasAnyGap, false);
    assert.equal(
      selectInitialSnapshotYear(result),
      monthParts(result.input.retirementMonth).year
    );
  });
});
