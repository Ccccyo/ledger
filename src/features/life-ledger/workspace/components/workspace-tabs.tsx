'use client';

import type { KeyboardEvent } from 'react';
import { ChartNoAxesCombined, ListChecks } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

import { WORKSPACE_TABS } from '../navigation';
import type { WorkspaceCopy, WorkspaceTab } from '../workspace-types';

const icons = {
  plan: ListChecks,
  analysis: ChartNoAxesCombined,
};

export function WorkspaceTabs({
  copy,
  tab,
  onChange,
}: {
  copy: WorkspaceCopy;
  tab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
}) {
  return (
    <nav
      className="bg-background/90 sticky top-16 z-30 hidden py-2 backdrop-blur md:block"
      aria-label={copy.tabs.label}
    >
      <div
        className="bg-muted/40 relative mx-auto grid h-14 w-[calc(100%-2rem)] max-w-[1768px] grid-cols-2 rounded-2xl p-1.5 sm:w-[calc(100%-3rem)]"
        role="tablist"
        aria-label={copy.tabs.label}
      >
        <span
          aria-hidden="true"
          className={cn(
            'bg-background absolute top-1.5 bottom-1.5 left-1.5 w-[calc(50%-0.375rem)] rounded-xl shadow-[0_8px_24px_-18px_rgba(15,118,78,0.65)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
            tab === 'analysis' && 'translate-x-full'
          )}
        />
        {WORKSPACE_TABS.map((id) => {
          const Icon = icons[id];
          return (
            <button
              key={id}
              id={`workspace-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`workspace-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => onChange(id)}
              onKeyDown={(event) => handleTabKeyDown(event, id, onChange)}
              className={cn(
                'focus-visible:ring-primary/30 relative z-10 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors duration-200 focus-visible:ring-4 focus-visible:outline-none',
                tab === id
                  ? 'text-foreground [&_svg]:text-primary'
                  : 'text-muted-foreground hover:bg-muted/55 hover:text-foreground'
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {copy.tabs[id]}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function handleTabKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  current: WorkspaceTab,
  onChange: (tab: WorkspaceTab) => void
) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = WORKSPACE_TABS.indexOf(current);
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? WORKSPACE_TABS.length - 1
        : event.key === 'ArrowRight'
          ? (currentIndex + 1) % WORKSPACE_TABS.length
          : (currentIndex - 1 + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
  const next = WORKSPACE_TABS[nextIndex];
  onChange(next);
  const tabs =
    event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
      '[role="tab"]'
    );
  requestAnimationFrame(() => tabs?.[nextIndex]?.focus());
}
