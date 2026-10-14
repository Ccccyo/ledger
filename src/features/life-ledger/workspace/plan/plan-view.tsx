'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { ArrowRight, Check } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

import { extractLifeTrajectory } from '../../analysis/extract-life-trajectory';
import { PLAN_DIRTY_EVENT, PLAN_LEAVE_EVENT } from '../navigation';
import { useWorkspace } from '../workspace-provider';
import { PlanChangeFeedback } from './plan-change-feedback';
import { AssetsSection } from './sections/assets-section';
import { AssumptionsSection } from './sections/assumptions-section';
import { BasicsSection } from './sections/basics-section';
import { CareerSection } from './sections/career-section';
import { ChildSection } from './sections/child-section';
import { EventsSection } from './sections/events-section';
import { HousingSection } from './sections/housing-section';
import { IncomeSection } from './sections/income-section';
import { LivingSection } from './sections/living-section';
import { ParentsSection } from './sections/parents-section';
import { PartnerSection } from './sections/partner-section';
import { RetirementSection } from './sections/retirement-section';
import type { PlanSectionId, SectionProps } from './types';

const sections: Record<PlanSectionId, ComponentType<SectionProps>> = {
  basics: BasicsSection,
  assets: AssetsSection,
  income: IncomeSection,
  living: LivingSection,
  career: CareerSection,
  partner: PartnerSection,
  child: ChildSection,
  housing: HousingSection,
  parents: ParentsSection,
  retirement: RetirementSection,
  events: EventsSection,
  advanced: AssumptionsSection,
};
const currentSections: PlanSectionId[] = [
  'assets',
  'income',
  'living',
  'basics',
];
const navigation: PlanSectionId[] = [
  'assets',
  'career',
  'partner',
  'child',
  'housing',
  'parents',
  'retirement',
  'events',
  'advanced',
];
const button =
  'focus-visible:ring-primary/30 rounded-md text-sm transition-colors motion-reduce:transition-none focus-visible:ring-4 focus-visible:outline-none';

export function PlanView({
  openSection,
  onOpenSection,
  onOverview,
  ...props
}: SectionProps & {
  openSection: PlanSectionId | '';
  onOpenSection: (id: PlanSectionId | '') => void;
  onOverview: () => void;
}) {
  const active = openSection || 'assets';
  const group = currentSections.includes(active) ? 'assets' : active;
  const nodes = extractLifeTrajectory(props.plan);
  const dirty = useRef(false);
  const label = (id: PlanSectionId) =>
    id === 'assets'
      ? props.copy.trajectory.stages.now
      : props.copy.plan.sections[id];
  const navigate = (id: PlanSectionId) => {
    if (dirty.current && !window.confirm(props.copy.flow.discard)) return;
    dirty.current = false;
    onOpenSection(id);
  };
  useEffect(() => {
    const markDirty = () => {
      dirty.current = true;
    };
    const confirmNavigation = (event: Event) => {
      if (dirty.current && !window.confirm(props.copy.flow.discard)) {
        event.preventDefault();
        return;
      }
      dirty.current = false;
    };
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    window.addEventListener(PLAN_LEAVE_EVENT, confirmNavigation);
    window.addEventListener(PLAN_DIRTY_EVENT, markDirty);
    return () => {
      window.removeEventListener('beforeunload', guard);
      window.removeEventListener(PLAN_LEAVE_EVENT, confirmNavigation);
      window.removeEventListener(PLAN_DIRTY_EVENT, markDirty);
    };
  }, [props.copy.flow.discard]);
  const index = navigation.indexOf(group);
  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-7 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{props.copy.plan.title}</h1>
        <button
          type="button"
          onClick={() => {
            if (!dirty.current || window.confirm(props.copy.flow.discard)) {
              dirty.current = false;
              onOverview();
            }
          }}
          className={cn(
            button,
            'hover:bg-muted flex min-h-11 shrink-0 items-center gap-2 px-3'
          )}
        >
          {props.copy.editor.see_result}
          <ArrowRight aria-hidden="true" className="size-4" />
        </button>
      </header>
      <div className="grid items-start gap-5 md:grid-cols-[176px_minmax(0,1fr)] md:gap-10">
        <nav
          aria-label={props.copy.trajectory.title}
          className="md:sticky md:top-32"
        >
          <label className="grid gap-2 text-sm md:hidden">
            <span className="sr-only">{props.copy.flow.choose_stage}</span>
            <select
              value={group}
              onChange={(e) => navigate(e.target.value as PlanSectionId)}
              className="border-input bg-background h-11 w-full rounded-lg border px-3"
            >
              {navigation.map((id) => (
                <option key={id} value={id}>
                  {label(id)}
                </option>
              ))}
            </select>
          </label>
          <ol className="hidden space-y-1 md:block">
            {navigation.map((id, i) => {
              const node = nodes.find((n) => n.targetSection === id);
              return (
                <li
                  key={id}
                  className={i === 7 ? 'border-border mt-5 border-t pt-5' : ''}
                >
                  <button
                    type="button"
                    aria-current={group === id ? 'step' : undefined}
                    onClick={() => navigate(id)}
                    className={cn(
                      button,
                      'flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left',
                      group === id
                        ? 'bg-primary/10 text-foreground font-semibold'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {label(id)}
                    {node?.status === 'complete' && (
                      <Check
                        className="size-3.5 shrink-0"
                        aria-label={props.copy.trajectory.status.complete}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="min-w-0">
          <section
            className="bg-background border-border rounded-xl border px-5 py-6 sm:p-8"
            aria-labelledby="plan-stage-heading"
          >
            <header className="mb-7">
              <h2 id="plan-stage-heading" className="text-xl font-semibold">
                {label(group)}
              </h2>
              <p className="text-muted-foreground mt-2 max-w-[60ch] text-sm leading-relaxed">
                {props.copy.flow.hints[group]}
              </p>
            </header>
            {group === 'assets' && (
              <nav
                aria-label={props.copy.flow.baseline}
                className="border-border mb-6 flex flex-wrap gap-x-5 border-b"
              >
                {currentSections.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={active === id ? 'page' : undefined}
                    onClick={() => navigate(id)}
                    className={cn(
                      button,
                      'min-h-11 border-b-2 px-1',
                      active === id
                        ? 'border-primary text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground border-transparent'
                    )}
                  >
                    {props.copy.plan.sections[id]}
                  </button>
                ))}
              </nav>
            )}
            <Editor
              key={active}
              {...props}
              section={active}
              onDirty={(value) => {
                dirty.current = value;
              }}
            />
          </section>
          <footer className="mt-5 flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              {props.copy.flow.trust}
            </p>
            {index < 6 && (
              <button
                type="button"
                onClick={() => navigate(navigation[index + 1])}
                className={cn(
                  button,
                  'hover:bg-muted flex min-h-11 shrink-0 items-center gap-2 px-2'
                )}
              >
                {props.copy.flow.next} · {label(navigation[index + 1])}
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}

function Editor({
  section,
  onDirty,
  ...props
}: SectionProps & {
  section: PlanSectionId;
  onDirty: (value: boolean) => void;
}) {
  const {
    state: { result, resultChange, pendingChange, calculationStatus },
  } = useWorkspace();
  const [before, setBefore] = useState<typeof result>(null);
  const Component = sections[section];
  return (
    <div onChangeCapture={() => onDirty(true)}>
      <Component
        {...props}
        onChange={(updater) => {
          setBefore(result);
          onDirty(false);
          props.onChange(updater);
        }}
      />
      {before && result !== before && calculationStatus !== 'failed' && (
        <div className="mt-6">
          <PlanChangeFeedback
            change={resultChange}
            pending={pendingChange}
            copy={props.copy}
            locale={props.locale}
            compact
          />
        </div>
      )}
    </div>
  );
}
