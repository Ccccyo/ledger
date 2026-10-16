'use client';

import { ChartNoAxesCombined, ListChecks } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

import { WORKSPACE_TABS } from '../navigation';
import type { WorkspaceCopy, WorkspaceTab } from '../workspace-types';

const icons = {
  plan: ListChecks,
  analysis: ChartNoAxesCombined,
};

export function WorkspaceMobileNav({
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
      className="border-border bg-background fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label={copy.tabs.label}
    >
      {WORKSPACE_TABS.map((id) => {
        const Icon = icons[id];
        return (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => onChange(id)}
            className={cn(
              'focus-visible:ring-primary/30 flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium focus-visible:ring-4 focus-visible:outline-none',
              tab === id ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
            {copy.tabs[id]}
          </button>
        );
      })}
    </nav>
  );
}
