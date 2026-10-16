'use client';

import { ArrowRight, MapPin } from 'lucide-react';

import {
  createWorkspaceTabHref,
  pushWorkspaceHistory,
  requestPlanNavigation,
} from '../../navigation';
import { StageEditor } from '../stage-editor';
import type { SectionProps } from '../types';

export function EventsSection(props: SectionProps) {
  const openRelocation = () => {
    if (!requestPlanNavigation()) return;
    const params = new URLSearchParams(window.location.search);
    params.set('section', 'housing');
    params.set('housing', 'relocation');
    params.delete('relocation');
    pushWorkspaceHistory(
      createWorkspaceTabHref(params.toString(), 'plan', window.location.pathname)
    );
  };
  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={openRelocation}
        className="border-border bg-muted/25 hover:bg-muted focus-visible:ring-primary/30 flex min-h-11 w-full items-center gap-3 rounded-lg border px-4 py-3 text-left focus-visible:ring-4 focus-visible:outline-none"
      >
        <MapPin className="text-primary size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <strong className="block text-sm">
            {props.copy.relocation.events_entry}
          </strong>
          <span className="text-muted-foreground mt-0.5 block text-xs">
            {props.copy.relocation.events_hint}
          </span>
        </span>
        <ArrowRight
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden="true"
        />
      </button>
      <StageEditor {...props} stage="events" />
    </div>
  );
}
