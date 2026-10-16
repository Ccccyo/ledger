import type { WorkspaceTab } from './workspace-types';

export const WORKSPACE_TABS: readonly WorkspaceTab[] = ['plan', 'analysis'];

export function resolveWorkspaceTab(value: string | null): WorkspaceTab {
  if (value === 'overview' || value === 'ledger') return 'analysis';
  return WORKSPACE_TABS.includes(value as WorkspaceTab)
    ? (value as WorkspaceTab)
    : 'plan';
}

export function createWorkspaceTabHref(
  currentSearch: string,
  tab: WorkspaceTab,
  pathname = '/plan'
) {
  const params = new URLSearchParams(currentSearch);
  params.set('tab', tab);
  return `${pathname}?${params.toString()}`;
}

export const PLAN_LEAVE_EVENT = 'life-ledger:before-plan-navigation';
export const PLAN_DIRTY_EVENT = 'life-ledger:plan-draft-changed';
const HISTORY_PUSH_EVENT = 'life-ledger:history-pushed';
const HISTORY_INDEX = '__lifeLedgerNavigation';

export function markPlanDraftChanged() {
  window.dispatchEvent(new Event(PLAN_DIRTY_EVENT));
}

export function pushWorkspaceHistory(href: string) {
  const index = Number(window.history.state?.[HISTORY_INDEX] ?? 0);
  window.history.pushState({ [HISTORY_INDEX]: index + 1 }, '', href);
  window.dispatchEvent(new Event(HISTORY_PUSH_EVENT));
}

/** Guard same-document traversal before the router consumes popstate. On
 * cancel, restore the existing history entry instead of adding a duplicate. */
export function installWorkspaceHistoryGuard(
  confirmNavigation = requestPlanNavigation,
  onNavigate = () => {}
) {
  let index = Number(window.history.state?.[HISTORY_INDEX] ?? 0);
  let restoring = false;
  window.history.replaceState(
    { ...window.history.state, [HISTORY_INDEX]: index },
    ''
  );
  const pushed = () => {
    index = Number(window.history.state?.[HISTORY_INDEX] ?? index);
    onNavigate();
  };
  const popped = (event: PopStateEvent) => {
    const target = event.state?.[HISTORY_INDEX];
    if (!Number.isSafeInteger(target)) return; // Cross-document exits use beforeunload.
    if (restoring) {
      event.stopImmediatePropagation();
      if (target === index) restoring = false;
      else window.history.go(index - target);
      return;
    }
    if (target !== index && !confirmNavigation()) {
      event.stopImmediatePropagation();
      restoring = true;
      window.history.go(index - target);
    } else {
      index = target;
      onNavigate();
    }
  };
  window.addEventListener(HISTORY_PUSH_EVENT, pushed);
  window.addEventListener('popstate', popped, true);
  return () => {
    window.removeEventListener(HISTORY_PUSH_EVENT, pushed);
    window.removeEventListener('popstate', popped, true);
  };
}

/** A cancelable local event lets the mounted editor protect an unsubmitted draft. */
export function requestPlanNavigation() {
  return window.dispatchEvent(
    new Event(PLAN_LEAVE_EVENT, { cancelable: true })
  );
}
