'use client';

import type { KeyboardEvent } from 'react';
import { BookOpen, LayoutDashboard, ListChecks } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

import { WORKSPACE_TABS } from '../navigation';
import type { WorkspaceCopy, WorkspaceTab } from '../workspace-types';

const icons = {
  overview: LayoutDashboard,
  plan: ListChecks,
  ledger: BookOpen,
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
      className="border-border bg-background sticky top-16 z-30 hidden border-b md:block"
      aria-label={copy.tabs.label}
    >
      <div
        className="container flex h-12 items-end gap-7"
        role="tablist"
        aria-label={copy.tabs.label}
      >
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
                'focus-visible:ring-primary/30 relative inline-flex h-12 items-center gap-2 text-sm font-medium transition-colors focus-visible:ring-4 focus-visible:outline-none',
                tab === id
                  ? 'text-foreground after:bg-primary after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5'
                  : 'text-muted-foreground hover:text-foreground'
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
