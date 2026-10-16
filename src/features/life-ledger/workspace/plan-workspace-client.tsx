'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import type { MonthlyCalculationResult } from '@/features/life-ledger/calculation';
import type { LifePlan } from '@/features/life-ledger/domain';
import { downloadPlanBackup } from '@/features/life-ledger/storage';
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronDown,
  CircleDollarSign,
  Database,
  Ellipsis,
  FileUp,
  Landmark,
  LoaderCircle,
  Menu,
  PencilLine,
  RotateCcw,
  ShieldCheck,
  Trash2,
  WalletCards,
} from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { LocaleSelector, ThemeToggler } from '@/shared/blocks/common';
import { cn } from '@/shared/lib/utils';

import { AgentPanel } from './agent/agent-panel';
import { EvidenceDrawer } from './components/evidence-drawer';
import { WorkspaceMobileNav } from './components/workspace-mobile-nav';
import { WorkspaceTabs } from './components/workspace-tabs';
import {
  createWorkspaceTabHref,
  installWorkspaceHistoryGuard,
  pushWorkspaceHistory,
  requestPlanNavigation,
  resolveWorkspaceTab,
} from './navigation';
import { AnnualSnapshotExplorer } from './overview/annual-snapshot';
import { LifeStageExpenses } from './overview/life-stage-expenses';
import { LifeTrajectory } from './overview/life-trajectory';
import { ScenarioChart } from './overview/scenario-chart';
import { SystemAnalysis } from './overview/system-analysis';
import { PlanView } from './plan/plan-view';
import { resolvePlanSection } from './plan/types';
import { useWorkspace, WorkspaceProvider } from './workspace-provider';
import type { WorkspaceCopy, WorkspaceTab } from './workspace-types';

export function PlanWorkspaceClient({
  locale,
  copy,
}: {
  locale: string;
  copy: WorkspaceCopy;
}) {
  return (
    <WorkspaceProvider copy={copy}>
      <PlanWorkspaceSurface locale={locale} copy={copy} />
    </WorkspaceProvider>
  );
}

function PlanWorkspaceSurface({
  locale,
  copy,
}: {
  locale: string;
  copy: WorkspaceCopy;
}) {
  const routeSearch = useSearchParams();
  // The router observes popstate before our confirmation. Keep the editor on
  // the last accepted view so a canceled traversal cannot unmount its draft.
  const [acceptedSearch, setAcceptedSearch] = useState(() =>
    routeSearch.toString()
  );
  const searchParams = new URLSearchParams(acceptedSearch);
  useEffect(
    () =>
      installWorkspaceHistoryGuard(requestPlanNavigation, () =>
        setAcceptedSearch(window.location.search)
      ),
    []
  );
  const {
    state: { boot, plan, result, saveStatus, calculationError, storageError },
    initialize,
    updatePlan,
    persistPlan,
    importBackup,
    restoreLatestSnapshot,
    deleteAndRestart,
  } = useWorkspace();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const openSection = resolvePlanSection(searchParams.get('section'));
  const openPlanSection = (section: string) => {
    if (!requestPlanNavigation()) return;
    const params = new URLSearchParams(searchParams.toString());
    const relocationPrefix = 'housing:relocation:';
    if (section.startsWith(relocationPrefix)) {
      params.set('section', 'housing');
      params.set('housing', 'relocation');
      params.set('relocation', section.slice(relocationPrefix.length));
    } else {
      params.set('section', section);
      params.delete('housing');
      params.delete('relocation');
    }
    pushWorkspaceHistory(
      createWorkspaceTabHref(
        params.toString(),
        'plan',
        window.location.pathname
      )
    );
  };
  const importInput = useRef<HTMLInputElement>(null);
  const tab = resolveWorkspaceTab(searchParams.get('tab'));

  const switchTab = (next: WorkspaceTab) => {
    if (next === tab || !requestPlanNavigation()) return;
    pushWorkspaceHistory(
      createWorkspaceTabHref(
        searchParams.toString(),
        next,
        window.location.pathname
      )
    );
  };

  const importBackupFromInput = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (file) await importBackup(file);
    event.target.value = '';
  };

  if (boot.status === 'loading') {
    return <WorkspaceSkeleton copy={copy} />;
  }

  if (boot.status === 'empty' || boot.status === 'error') {
    return (
      <EmptyWorkspace
        copy={copy}
        error={boot.status === 'error' ? boot.message : undefined}
        onImport={() => importInput.current?.click()}
        onRetry={() => void initialize()}
        onRestore={() => void restoreLatestSnapshot()}
      >
        <input
          ref={importInput}
          type="file"
          accept="application/json"
          hidden
          onChange={importBackupFromInput}
        />
      </EmptyWorkspace>
    );
  }

  if (!plan || !result) return <WorkspaceSkeleton copy={copy} />;

  return (
    <div
      data-life-ledger
      className="text-foreground min-h-screen pb-20 md:pb-0"
    >
      <WorkspaceHeader
        copy={copy}
        plan={plan}
        onEvidence={() => setEvidenceOpen(true)}
        saveStatus={saveStatus}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        onExport={() => downloadPlanBackup(plan)}
        onImport={() => importInput.current?.click()}
        onRestore={() => {
          setMenuOpen(false);
          void restoreLatestSnapshot();
        }}
        onDelete={() => {
          setMenuOpen(false);
          void deleteAndRestart();
        }}
        onRename={(name) =>
          updatePlan((current) => ({
            ...current,
            name,
            metadata: {
              ...current.metadata,
              updatedAt: new Date().toISOString(),
            },
          }))
        }
      />
      <WorkspaceTabs copy={copy} tab={tab} onChange={switchTab} />
      {(calculationError || storageError) && (
        <div className="container pt-4" role="status">
          <div className="border-border bg-background flex items-start gap-3 rounded-xl border px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>{calculationError || storageError}</p>
              {saveStatus === 'failed' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(copy.errors.reload_confirm))
                        void initialize();
                    }}
                    className="min-h-9 rounded-md border border-current/20 px-3 text-xs"
                  >
                    {copy.errors.reload}
                  </button>
                  <button
                    type="button"
                    onClick={() => void persistPlan(plan)}
                    className="hover:bg-muted min-h-9 rounded-md border border-current/20 px-3 text-xs font-semibold"
                  >
                    {copy.common.retry}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadPlanBackup(plan)}
                    className="hover:bg-muted min-h-9 rounded-md border border-current/20 px-3 text-xs font-semibold"
                  >
                    {copy.shell.export_current}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <main className="mx-auto w-full max-w-[1800px] px-4 pt-2 pb-4 sm:px-6">
        {tab === 'plan' && (
          <section
            id="workspace-panel-plan"
            role="tabpanel"
            aria-labelledby="workspace-tab-plan"
            className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-2 motion-safe:duration-200"
          >
            <div className="grid items-start gap-5 xl:h-[calc(100dvh-10rem)] xl:min-h-[640px] xl:grid-cols-[minmax(0,1.08fr)_minmax(540px,0.92fr)] xl:overflow-hidden">
              <section
                className="border-border bg-background min-w-0 rounded-xl border xl:h-full xl:overflow-y-auto"
                aria-labelledby="planning-editor-heading"
              >
                <div className="bg-background sticky top-0 z-20 px-4 pt-4 sm:px-5">
                  <PaneHeading
                    id="planning-editor-heading"
                    label={copy.workspace_pages.plan_title}
                  />
                </div>
                <div className="px-4 pb-5 sm:px-5">
                  <PlanView
                    embedded
                    locale={locale}
                    copy={copy}
                    plan={plan}
                    openSection={openSection}
                    onOpenSection={openPlanSection}
                    onOverview={() => switchTab('analysis')}
                    onChange={updatePlan}
                  />
                </div>
              </section>
              <section
                className="border-border bg-muted/20 min-w-0 rounded-xl border xl:h-full xl:overflow-y-auto xl:overscroll-contain"
                aria-labelledby="planning-preview-heading"
              >
                <div className="bg-background/95 sticky top-0 z-20 px-4 pt-4 backdrop-blur sm:px-5">
                  <PaneHeading
                    id="planning-preview-heading"
                    label={copy.workspace_pages.preview}
                  />
                </div>
                <div className="px-4 pb-5 sm:px-5">
                  <OverviewView
                    compact
                    locale={locale}
                    copy={copy}
                    result={result}
                    onEdit={() => switchTab('plan')}
                    onNavigate={openPlanSection}
                  />
                </div>
              </section>
            </div>
          </section>
        )}
        {tab === 'analysis' && (
          <section
            id="workspace-panel-analysis"
            role="tabpanel"
            aria-labelledby="workspace-tab-analysis"
            className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-200"
          >
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
              <OverviewView
                locale={locale}
                copy={copy}
                result={result}
                onEdit={() => switchTab('plan')}
                onNavigate={openPlanSection}
              />
              <AgentPanel copy={copy} locale={locale} result={result} />
            </div>
          </section>
        )}
      </main>
      {evidenceOpen && (
        <EvidenceDrawer
          result={result}
          copy={copy}
          locale={locale}
          onClose={() => setEvidenceOpen(false)}
        />
      )}
      <WorkspaceMobileNav copy={copy} tab={tab} onChange={switchTab} />
      <input
        ref={importInput}
        type="file"
        accept="application/json"
        hidden
        onChange={importBackupFromInput}
      />
    </div>
  );
}

function WorkspaceHeader({
  copy,
  plan,
  saveStatus,
  menuOpen,
  setMenuOpen,
  onExport,
  onImport,
  onRestore,
  onDelete,
  onRename,
  onEvidence,
}: {
  copy: WorkspaceCopy;
  plan: LifePlan;
  saveStatus: string;
  menuOpen: boolean;
  setMenuOpen: (value: boolean) => void;
  onExport: () => void;
  onImport: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onEvidence: () => void;
}) {
  const saveCopy = copy.save[saveStatus] ?? copy.save.saved;
  const requestRename = () => {
    const name = window.prompt(copy.shell.rename_prompt, plan.name);
    if (name?.trim()) onRename(name.trim());
  };
  return (
    <header className="border-border bg-background/95 sticky top-0 z-40 border-b backdrop-blur">
      <div className="container flex h-16 items-center gap-3">
        <Link
          href="/"
          onClick={(event) => {
            if (
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            if (!requestPlanNavigation()) event.preventDefault();
          }}
          aria-label={copy.shell.brand}
          className="focus-visible:ring-primary/30 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-md font-semibold tracking-tight focus-visible:ring-4 focus-visible:outline-none"
        >
          <Landmark aria-hidden="true" className="text-primary size-5" />
          <span className="hidden sm:inline">{copy.shell.brand}</span>
        </Link>
        <span className="bg-border mx-1 hidden h-5 w-px sm:block" />
        <button
          type="button"
          className="hover:bg-muted min-w-0 truncate rounded-md px-2 py-1 text-sm font-medium"
          onClick={requestRename}
        >
          {plan.name}
        </button>
        <span
          className={cn(
            'ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs',
            saveStatus === 'failed'
              ? 'text-red-700 dark:text-red-300'
              : saveStatus === 'stale'
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-muted-foreground'
          )}
          aria-live="polite"
        >
          {saveStatus === 'saving' ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : saveStatus === 'saved' ? (
            <Check className="size-3.5" />
          ) : (
            <AlertTriangle className="size-3.5" />
          )}
          <span className="hidden min-[520px]:inline">{saveCopy}</span>
        </span>
        <button
          type="button"
          onClick={onEvidence}
          className="text-muted-foreground hidden min-h-11 rounded-md px-2 text-xs underline-offset-4 hover:underline lg:inline"
        >
          {copy.shell.basis}
        </button>
        <ThemeToggler />
        <LocaleSelector type="button" onBeforeChange={requestPlanNavigation} />
        <div className="relative">
          <button
            type="button"
            aria-label={copy.shell.more}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
            className="hover:bg-muted focus-visible:ring-primary/30 flex size-9 items-center justify-center rounded-lg focus-visible:ring-4 focus-visible:outline-none"
          >
            <Ellipsis className="size-5" />
          </button>
          {menuOpen && (
            <div className="border-border bg-popover absolute top-11 right-0 z-50 w-48 rounded-xl border p-1.5 shadow-lg">
              <MenuButton
                icon={ShieldCheck}
                onClick={() => {
                  setMenuOpen(false);
                  onEvidence();
                }}
              >
                {copy.evidence.open}
              </MenuButton>
              <MenuButton icon={PencilLine} onClick={requestRename}>
                {copy.shell.rename}
              </MenuButton>
              <MenuButton icon={ArrowDownToLine} onClick={onExport}>
                {copy.shell.export}
              </MenuButton>
              <MenuButton icon={FileUp} onClick={onImport}>
                {copy.shell.import}
              </MenuButton>
              <MenuButton icon={RotateCcw} onClick={onRestore}>
                {copy.shell.restore}
              </MenuButton>
              <MenuButton icon={Trash2} onClick={onDelete} destructive>
                {copy.shell.delete}
              </MenuButton>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuButton({ icon: Icon, onClick, children, destructive }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'hover:bg-muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
        destructive && 'text-destructive'
      )}
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}

function PaneHeading({ id, label }: { id: string; label: string }) {
  return (
    <h2
      id={id}
      className="border-border text-foreground mb-4 border-b pb-3 text-xl font-bold tracking-tight"
    >
      {label}
    </h2>
  );
}

function OverviewView({
  locale,
  copy,
  result,
  onEdit,
  onNavigate,
  compact = false,
}: {
  locale: string;
  copy: WorkspaceCopy;
  result: MonthlyCalculationResult;
  onEdit: () => void;
  onNavigate: (section: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={cn('space-y-6', !compact && 'mx-auto max-w-6xl')}>
      <AnnualSnapshotExplorer
        key={result.inputHash}
        result={result}
        copy={copy}
        locale={locale}
        plan={result.input}
        condensed={compact}
        initialMode={compact ? 'trend' : 'snapshot'}
      />
      {!compact && (
        <>
          <LifeTrajectory
            plan={result.input}
            copy={copy}
            locale={locale}
            onNavigate={onNavigate}
          />
          <LifeStageExpenses result={result} copy={copy} locale={locale} />
          <ScenarioChart result={result} copy={copy} locale={locale} />
          <SystemAnalysis result={result} copy={copy} onNavigate={onNavigate} />
          <section className="border-border flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">
                {copy.overview.completeness_basic}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {copy.overview.completeness_hint}
              </p>
            </div>
            <button
              type="button"
              onClick={onEdit}
              className="border-border bg-background hover:bg-muted inline-flex min-h-10 items-center justify-center rounded-lg border px-3.5 text-sm font-medium active:scale-[0.98]"
            >
              {copy.overview.complete_plan}
            </button>
          </section>
        </>
      )}
    </div>
  );
}

function WorkspaceSkeleton({ copy }: any) {
  return (
    <div className="min-h-screen">
      <div className="border-border bg-background h-16 border-b" />
      <main className="container py-10">
        <div className="bg-muted h-8 w-2/3 animate-pulse rounded-md" />
        <div className="bg-muted mt-4 h-4 w-1/2 animate-pulse rounded" />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="border-border bg-background h-24 animate-pulse rounded-xl border"
            />
          ))}
        </div>
        <p className="text-muted-foreground mt-8 text-sm" role="status">
          {copy.bootstrap.loading}
        </p>
      </main>
    </div>
  );
}

function EmptyWorkspace({
  copy,
  error,
  onImport,
  onRetry,
  onRestore,
  children,
}: any) {
  return (
    <main className="container flex min-h-[100dvh] items-center justify-center py-16">
      <section className="border-border bg-background w-full max-w-xl rounded-2xl border p-7 sm:p-10">
        <div
          className={cn(
            'flex size-10 items-center justify-center rounded-xl',
            error
              ? 'bg-destructive/10 text-destructive'
              : 'bg-primary/10 text-primary'
          )}
        >
          {error ? (
            <AlertTriangle className="size-5" />
          ) : (
            <Database className="size-5" />
          )}
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          {error ? copy.bootstrap.error_title : copy.bootstrap.empty_title}
        </h1>
        <p className="text-muted-foreground mt-3 max-w-[60ch] text-sm leading-relaxed">
          {error || copy.bootstrap.empty_description}
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/#calculator"
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold"
          >
            {copy.bootstrap.start}
          </Link>
          <button
            type="button"
            onClick={onImport}
            className="border-border hover:bg-muted inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium"
          >
            <FileUp className="size-4" />
            {copy.shell.import}
          </button>
          {error && (
            <button
              type="button"
              onClick={onRestore}
              className="border-border hover:bg-muted min-h-11 rounded-lg border px-4 text-sm"
            >
              {copy.shell.restore}
            </button>
          )}
          {error && (
            <button
              type="button"
              onClick={onRetry}
              className="border-border hover:bg-muted inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium"
            >
              <RotateCcw className="size-4" />
              {copy.common.retry}
            </button>
          )}
        </div>
        {children}
      </section>
    </main>
  );
}
