'use client';

import { useMemo } from 'react';
import { ArrowUpRight, Lightbulb } from 'lucide-react';

import { generateInsights } from '../../analysis/generate-insights';
import type { MonthlyCalculationResult } from '../../calculation';
import type { WorkspaceCopy } from '../workspace-types';

export function SystemAnalysis({
  result,
  copy,
  onNavigate,
}: {
  result: MonthlyCalculationResult;
  copy: WorkspaceCopy;
  onNavigate: (s: string) => void;
}) {
  const insights = useMemo(
    () => generateInsights(result.input, result),
    [result]
  );
  return (
    <section aria-labelledby="system-analysis-heading">
      <header className="flex items-center gap-2">
        <span className="bg-primary/10 text-primary inline-flex size-8 items-center justify-center rounded-lg">
          <Lightbulb className="size-4" aria-hidden="true" />
        </span>
        <h2 id="system-analysis-heading" className="text-xl font-semibold">
          {copy.analysis.title}
        </h2>
      </header>
      <ul className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {insights.map((insight) => (
          <li
            key={insight.ruleId}
            className="bg-muted/45 border-border flex min-w-0 flex-col rounded-lg border p-4"
          >
            <h3 className="text-base leading-snug font-semibold">
              {copy.analysis.rules[insight.ruleId].title}
            </h3>
            <p className="text-foreground mt-1.5 text-sm leading-relaxed">
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
              className="text-primary focus-visible:ring-primary/30 mt-2 inline-flex min-h-8 items-center gap-1 self-start rounded-md text-left text-xs font-medium underline-offset-4 hover:underline focus-visible:ring-4 focus-visible:outline-none"
            >
              {copy.analysis.review}
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-2 text-[11px]">
        {copy.analysis.basis}
      </p>
    </section>
  );
}
