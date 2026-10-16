'use client';

import { useState } from 'react';

import type { ActionCandidate } from '../../analysis/generate-actions';
import {
  simulateAction,
  type SimulationComparison,
} from '../../analysis/simulate-action';
import type { MonthlyCalculationResult } from '../../calculation';
import {
  formatMonth,
  moneyCents,
  monthIndex,
  type LifePlan,
} from '../../domain';
import { WorkspaceDrawer } from '../components/workspace-drawer';
import { moneyFormatter } from '../plan/fields';
import { useWorkspace } from '../workspace-provider';
import type { WorkspaceCopy } from '../workspace-types';

export function SimulationDrawer({
  action,
  baseline,
  copy,
  locale,
  onClose,
}: {
  action: ActionCandidate;
  baseline: MonthlyCalculationResult;
  copy: WorkspaceCopy;
  locale: string;
  onClose: () => void;
}) {
  const { state, applySimulation } = useWorkspace();
  const patch = action.patch;
  const initial =
    patch.type === 'shift-cash-flow'
      ? String(patch.monthDelta)
      : patch.type === 'change-retirement-month'
        ? formatMonth(patch.retirementMonth)
        : patch.type === 'change-cash-flow-amount'
          ? String(patch.amountCents / 100)
          : patch.type === 'change-liquid-opening-balance'
            ? String(patch.openingBalanceCents / 100)
            : '';
  const [value, setValue] = useState(initial);
  const [comparison, setComparison] = useState<SimulationComparison | null>(
    null
  );
  const [testedValue, setTestedValue] = useState('');
  const [error, setError] = useState(false);
  const stale =
    state.externalConflict ||
    state.plan !== baseline.input ||
    state.result?.inputHash !== baseline.inputHash ||
    state.calculationStatus !== 'idle';
  const money = moneyFormatter(locale);
  const buildPatch = () => {
    if (!value.trim()) throw new Error('Empty value');
    if (patch.type === 'shift-cash-flow')
      return { ...patch, monthDelta: Number(value) };
    if (patch.type === 'change-retirement-month') {
      const [y, m] = value.split('-').map(Number);
      return { ...patch, retirementMonth: monthIndex(y, m) };
    }
    const amount = moneyCents(Math.round(Number(value) * 100));
    if (patch.type === 'change-cash-flow-amount')
      return { ...patch, amountCents: amount };
    if (patch.type === 'change-liquid-opening-balance')
      return { ...patch, openingBalanceCents: amount };
    throw new Error('Unsupported action patch');
  };
  const gap = (n: number | null) =>
    n === null ? copy.overview.no_gap : formatMonth(n as LifePlan['baseMonth']);
  return (
    <WorkspaceDrawer
      title={copy.actions[action.kind].title}
      description={copy.simulation.description}
      closeLabel={copy.common.close}
      onClose={onClose}
    >
      {stale ? (
        <p role="alert" className="text-amber-800 dark:text-amber-300">
          {copy.simulation.stale}
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              setComparison(
                simulateAction(baseline.input, baseline, buildPatch())
              );
              setTestedValue(value);
              setError(false);
            } catch {
              setError(true);
            }
          }}
          className="space-y-4"
        >
          <label className="grid gap-2 text-sm">
            {copy.simulation.fields[patch.type]}
            <input
              className="border-input bg-background focus-visible:ring-primary/30 h-11 rounded-lg border px-3 focus-visible:ring-4 focus-visible:outline-none"
              type={
                patch.type === 'change-retirement-month' ? 'month' : 'number'
              }
              step={patch.type === 'shift-cash-flow' ? 1 : '0.01'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            className="border-border hover:bg-muted min-h-11 rounded-lg border px-4 text-sm"
          >
            {copy.simulation.calculate}
          </button>
        </form>
      )}
      {error && (
        <p className="text-destructive mt-3 text-sm" role="alert">
          {copy.simulation.error}
        </p>
      )}
      {comparison && (
        <div className="mt-6">
          <h3 className="font-medium">{copy.simulation.comparison}</h3>
          <dl className="divide-border mt-2 divide-y text-sm">
            {[
              [
                copy.overview.first_gap,
                gap(comparison.change.before.firstGapMonth),
                gap(comparison.change.after.firstGapMonth),
              ],
              [
                copy.overview.minimum,
                money(comparison.change.before.minimumAvailableCents),
                money(comparison.change.after.minimumAvailableCents),
              ],
              [
                copy.simulation.ending,
                money(comparison.change.before.endingAvailableCents),
                money(comparison.change.after.endingAvailableCents),
              ],
            ].map(([label, before, after]) => (
              <div key={label} className="py-3">
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="mt-1 tabular-nums">
                  {before} → {after}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            {copy.actions[action.kind].tradeoff}
          </p>
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            {copy.simulation.exclusions}
          </p>
        </div>
      )}
      <div className="mt-7 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!comparison || stale || error || value !== testedValue}
          onClick={() => {
            if (comparison && !stale && value === testedValue) {
              applySimulation(
                comparison.baselineHash,
                comparison.candidatePlan
              );
              onClose();
            }
          }}
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary/30 min-h-11 rounded-lg px-4 text-sm font-medium focus-visible:ring-4 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copy.simulation.apply}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="hover:bg-muted min-h-11 rounded-lg px-4 text-sm"
        >
          {copy.simulation.discard}
        </button>
      </div>
    </WorkspaceDrawer>
  );
}
