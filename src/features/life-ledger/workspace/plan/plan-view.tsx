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
import { InvestmentSection } from './sections/investment-section';
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
  investment: InvestmentSection,
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
  'parents',
  'housing',
  'investment',
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
  onInvestmentAnalysis,
  embedded = false,
  ...props
}: SectionProps & {
  openSection: PlanSectionId | '';
  onOpenSection: (id: PlanSectionId | '') => void;
  onOverview: () => void;
  onInvestmentAnalysis: () => void;
  embedded?: boolean;
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
    <div className={cn('mx-auto', !embedded && 'max-w-6xl')}>
      {!embedded && (
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
      )}
      <div className="grid items-start gap-5 md:grid-cols-[164px_minmax(0,1fr)] md:gap-6">
        <nav
          aria-label={props.copy.trajectory.title}
          className={cn('md:sticky', embedded ? 'md:top-16' : 'md:top-32')}
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
          <ol className="hidden space-y-2 md:block">
            {navigation.map((id) => {
              const node = nodes.find((n) => n.targetSection === id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-current={group === id ? 'step' : undefined}
                    onClick={() => navigate(id)}
                    className={cn(
                      button,
                      'bg-background/60 flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left shadow-[0_10px_28px_-26px_rgba(15,23,42,0.7)]',
                      group === id
                        ? 'bg-background text-primary ring-primary/15 font-semibold shadow-sm ring-1'
                        : 'text-muted-foreground hover:bg-background hover:text-foreground'
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
            className="bg-background rounded-2xl p-4 shadow-[0_24px_55px_-42px_rgba(15,23,42,0.75)] sm:p-6"
            aria-labelledby="plan-stage-heading"
          >
            <header className="mb-5">
              <h2 id="plan-stage-heading" className="text-xl font-semibold">
                {label(group)}
              </h2>
            </header>
            {group === 'assets' && (
              <nav
                aria-label={props.copy.flow.baseline}
                className="bg-muted/55 mb-6 grid grid-cols-2 gap-1 rounded-xl p-1 sm:grid-cols-4"
              >
                {currentSections.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={active === id ? 'page' : undefined}
                    onClick={() => navigate(id)}
                    className={cn(
                      button,
                      'min-h-10 rounded-lg px-2',
                      active === id
                        ? 'bg-background text-primary font-medium shadow-sm'
                        : 'text-muted-foreground hover:bg-background/65 hover:text-foreground'
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
              onInvestmentAnalysis={onInvestmentAnalysis}
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
  onInvestmentAnalysis,
  ...props
}: SectionProps & {
  section: PlanSectionId;
  onDirty: (value: boolean) => void;
  onInvestmentAnalysis: () => void;
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
        onInvestmentAnalysis={onInvestmentAnalysis}
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
