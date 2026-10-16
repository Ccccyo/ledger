import { Check, Circle, Minus } from 'lucide-react';

import { extractLifeTrajectory } from '../../analysis/extract-life-trajectory';
import type { LifePlan } from '../../domain';
import type { WorkspaceCopy } from '../workspace-types';

export function LifeTrajectory({
  plan,
  copy,
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
      <h2 id="life-trajectory-heading" className="text-sm font-semibold">
        {copy.trajectory.title}
      </h2>
      <ol className="mt-2 flex flex-wrap gap-2">
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
                className="border-border hover:bg-muted focus-visible:ring-primary/30 flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-left focus-visible:ring-4 focus-visible:outline-none"
              >
                <Icon
                  aria-hidden="true"
                  className="text-primary size-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm">
                    {copy.trajectory.stages[node.stage]}
                  </strong>
                  <span className="sr-only">
                    {node.age === null
                      ? copy.trajectory.status[node.status]
                      : `${node.age} ${copy.common.age} · ${copy.trajectory.status[node.status]}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
