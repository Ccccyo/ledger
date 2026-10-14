import { ArrowRight, Check, Circle, Minus } from 'lucide-react';

import { extractLifeTrajectory } from '../../analysis/extract-life-trajectory';
import type { LifePlan } from '../../domain';
import { sectionSummary } from '../plan/section-summary';
import type { PlanSectionId } from '../plan/types';
import type { WorkspaceCopy } from '../workspace-types';

export function LifeTrajectory({
  plan,
  copy,
  locale,
  onNavigate,
}: {
  plan: LifePlan;
  copy: WorkspaceCopy;
  locale: string;
  onNavigate: (section: string) => void;
}) {
  const nodes = extractLifeTrajectory(plan);
  return (
    <section aria-labelledby="life-trajectory-heading">
      <h2 id="life-trajectory-heading" className="text-lg font-semibold">
        {copy.trajectory.title}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {copy.trajectory.hint}
      </p>
      <ol className="border-border mt-5 grid border-y sm:grid-cols-3 xl:grid-cols-7">
        {nodes.map((node) => {
          const Icon =
            node.status === 'complete'
              ? Check
              : node.status === 'not-applicable'
                ? Minus
                : Circle;
          return (
            <li key={node.stage} className="min-w-0">
              <button
                type="button"
                onClick={() => onNavigate(node.targetSection)}
                className="hover:bg-muted focus-visible:ring-primary/30 flex min-h-24 w-full items-center gap-3 px-3 py-4 text-left focus-visible:ring-4 focus-visible:outline-none sm:min-h-36 sm:flex-col sm:items-start"
              >
                <Icon
                  aria-hidden="true"
                  className="text-primary size-5 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm">
                    {copy.trajectory.stages[node.stage]}
                  </strong>
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {node.age === null
                      ? copy.trajectory.status[node.status]
                      : `${node.age} ${copy.common.age} · ${copy.trajectory.status[node.status]}`}
                  </span>
                  {node.status === 'complete' && (
                    <span className="text-muted-foreground mt-2 block text-xs leading-relaxed break-words">
                      {sectionSummary(
                        node.targetSection as PlanSectionId,
                        plan,
                        copy,
                        locale
                      )}
                    </span>
                  )}
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="text-muted-foreground size-4 sm:hidden"
                />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
