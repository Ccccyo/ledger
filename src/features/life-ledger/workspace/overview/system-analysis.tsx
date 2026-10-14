'use client';

import { useMemo, useState } from 'react';

import {
  generateActions,
  type ActionCandidate,
} from '../../analysis/generate-actions';
import { generateInsights } from '../../analysis/generate-insights';
import type { MonthlyCalculationResult } from '../../calculation';
import { EvidenceDrawer } from '../components/evidence-drawer';
import { SimulationDrawer } from '../simulation/simulation-drawer';
import { useWorkspace } from '../workspace-provider';
import type { WorkspaceCopy } from '../workspace-types';

export function SystemAnalysis({
  result,
  copy,
  locale,
  onNavigate,
}: {
  result: MonthlyCalculationResult;
  copy: WorkspaceCopy;
  locale: string;
  onNavigate: (s: string) => void;
}) {
  const insights = useMemo(
    () => generateInsights(result.input, result),
    [result]
  );
  const actions = useMemo(
    () => generateActions(result.input, result, insights),
    [result, insights]
  );
  const [trial, setTrial] = useState<{
    action: ActionCandidate;
    baseline: MonthlyCalculationResult;
  } | null>(null);
  const [evidence, setEvidence] = useState<string[] | null>(null);
  const { state, undoSimulation } = useWorkspace();
  return (
    <>
      <section aria-labelledby="system-analysis-heading">
        <header>
          <h2 id="system-analysis-heading" className="text-lg font-semibold">
            {copy.analysis.title}
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {copy.analysis.basis}
          </p>
        </header>
        <ul className="divide-border mt-4 divide-y">
          {insights.map((insight) => (
            <li key={insight.ruleId} className="py-5">
              <h3 className="text-sm font-semibold">
                {copy.analysis.rules[insight.ruleId].title}
              </h3>
              <p className="text-muted-foreground mt-2 max-w-[70ch] text-sm leading-relaxed">
                {copy.analysis.rules[insight.ruleId].body}
              </p>
              {insight.verifiedCause && (
                <p className="text-muted-foreground mt-2 text-xs">
                  {copy.analysis.cause_verified}
                </p>
              )}
              <button
                type="button"
                onClick={() => onNavigate(insight.target)}
                className="text-primary focus-visible:ring-primary/30 mt-2 min-h-11 rounded-md text-sm underline-offset-4 hover:underline focus-visible:ring-4 focus-visible:outline-none"
              >
                {copy.analysis.review}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="actions-heading">
        <h2 id="actions-heading" className="text-lg font-semibold">
          {copy.analysis.actions}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {copy.analysis.actions_hint}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {actions.map((action) => (
            <button
              type="button"
              key={action.id}
              onClick={() => setTrial({ action, baseline: result })}
              className="border-border hover:bg-muted focus-visible:ring-primary/30 min-h-11 rounded-lg border px-4 py-2 text-left text-sm focus-visible:ring-4 focus-visible:outline-none"
            >
              {copy.actions[action.kind].title}
            </button>
          ))}
        </div>
        {state.appliedSnapshot && (
          <button
            type="button"
            onClick={undoSimulation}
            className="text-primary mt-4 min-h-11 text-sm underline-offset-4 hover:underline"
          >
            {copy.simulation.undo}
          </button>
        )}
      </section>
      <button
        type="button"
        className="text-muted-foreground min-h-11 text-sm underline-offset-4 hover:underline"
        onClick={() => setEvidence([])}
      >
        {copy.evidence.open}
      </button>
      {evidence && (
        <EvidenceDrawer
          result={result}
          copy={copy}
          locale={locale}
          inputIds={evidence}
          onClose={() => setEvidence(null)}
        />
      )}
      {trial && (
        <SimulationDrawer
          action={trial.action}
          baseline={trial.baseline}
          copy={copy}
          locale={locale}
          onClose={() => setTrial(null)}
        />
      )}
    </>
  );
}
