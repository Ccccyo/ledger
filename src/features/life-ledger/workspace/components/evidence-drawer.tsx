'use client';

import { useState } from 'react';

import { ANALYSIS_VERSION } from '../../analysis/generate-insights';
import type { MonthlyCalculationResult } from '../../calculation';
import { formatMonth, resolveLifePlan } from '../../domain';
import { moneyFormatter } from '../plan/fields';
import type { WorkspaceCopy } from '../workspace-types';
import { WorkspaceDrawer } from './workspace-drawer';

export function EvidenceDrawer({
  result,
  copy,
  locale,
  onClose,
  inputIds,
}: {
  result: MonthlyCalculationResult;
  copy: WorkspaceCopy;
  locale: string;
  onClose: () => void;
  inputIds?: string[];
}) {
  const [month, setMonth] = useState(
    result.summary.firstGapMonth ?? result.input.baseMonth
  );
  const money = moneyFormatter(locale);
  const flows = resolveLifePlan(result.input).cashFlows;
  const inputs = [
    ...flows.map((f) => ({
      id: f.id,
      name: f.name,
      value: f.amountCents,
      source: f.source,
    })),
    ...result.input.assets.map((a) => ({
      id: a.id,
      name: a.name,
      value: a.openingBalanceCents,
      source: a.source,
    })),
    ...result.input.liabilities.map((l) => ({
      id: l.id,
      name: l.name,
      value: l.openingPrincipalCents,
      source: l.source,
    })),
  ];
  const chosen = inputIds?.length
    ? inputs.filter((i) => inputIds.includes(i.id))
    : inputs;
  const records = result.traces.filter(
    (t) =>
      t.month === month &&
      (!inputIds?.length || (t.inputId && inputIds.includes(t.inputId)))
  );
  return (
    <WorkspaceDrawer
      title={copy.evidence.title}
      description={copy.evidence.description}
      closeLabel={copy.common.close}
      onClose={onClose}
    >
      <p className="text-muted-foreground text-sm leading-relaxed">
        {copy.evidence.basis}
      </p>
      <dl className="border-border mt-5 space-y-3 border-y py-4 text-xs">
        <div>
          <dt className="text-muted-foreground">{copy.evidence.versions}</dt>
          <dd className="mt-1 break-all">
            {result.versions.calculation} · {result.versions.schema} ·{' '}
            {result.versions.data} · {ANALYSIS_VERSION}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{copy.evidence.date}</dt>
          <dd className="mt-1">{result.input.metadata.updatedAt}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{copy.plan.return_rate}</dt>
          <dd>{result.input.assumptions.annualLiquidReturnBps / 100}%</dd>
        </div>
      </dl>
      <h3 className="mt-6 font-medium">{copy.evidence.sources}</h3>
      <ul className="divide-border mt-2 divide-y">
        {chosen.map((i) => (
          <li key={i.id} className="py-3 text-sm">
            <div className="flex justify-between gap-3">
              <span>{i.name}</span>
              <span className="shrink-0 tabular-nums">{money(i.value)}</span>
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {copy.evidence[i.source.kind]} · {i.source.label}
              {i.source.effectiveMonth
                ? ` · ${formatMonth(i.source.effectiveMonth)}`
                : ''}
            </p>
          </li>
        ))}
      </ul>
      <h3 className="mt-6 font-medium">{copy.evidence.records}</h3>
      <label className="mt-3 grid gap-2 text-sm">
        {copy.evidence.month}
        <select
          className="border-input bg-background h-11 rounded-lg border px-3"
          value={month}
          onChange={(e) => setMonth(Number(e.target.value) as typeof month)}
        >
          {result.monthly.map((r) => (
            <option key={r.month} value={r.month}>
              {formatMonth(r.month)}
            </option>
          ))}
        </select>
      </label>
      <ul className="divide-border mt-3 divide-y">
        {records.map((r) => (
          <li key={r.id} className="py-3 text-xs">
            <div className="flex justify-between gap-3">
              <span>
                {inputs.find((i) => i.id === r.inputId)?.name ?? r.kind}
              </span>
              <span className="shrink-0 tabular-nums">
                {money(r.amountCents)}
              </span>
            </div>
            <details className="text-muted-foreground mt-2">
              <summary className="cursor-pointer">{copy.evidence.rule}</summary>
              <p className="mt-2 break-all">
                {r.rule}
                <br />
                {r.id}
              </p>
            </details>
          </li>
        ))}
      </ul>
      {!records.length && (
        <p className="text-muted-foreground mt-3 text-sm">
          {copy.evidence.no_records}
        </p>
      )}
    </WorkspaceDrawer>
  );
}
