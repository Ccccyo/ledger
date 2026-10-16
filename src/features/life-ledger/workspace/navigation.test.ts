import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createWorkspaceTabHref,
  installWorkspaceHistoryGuard,
  pushWorkspaceHistory,
  resolveWorkspaceTab,
  WORKSPACE_TABS,
} from './navigation';

describe('P2.1 workspace navigation', () => {
  it('recognizes the two public workspace tabs and migrates legacy tabs', () => {
    assert.deepEqual(WORKSPACE_TABS, ['plan', 'analysis']);
    assert.equal(resolveWorkspaceTab('overview'), 'analysis');
    assert.equal(resolveWorkspaceTab('plan'), 'plan');
    assert.equal(resolveWorkspaceTab('analysis'), 'analysis');
    assert.equal(resolveWorkspaceTab('ledger'), 'analysis');
    assert.equal(resolveWorkspaceTab('unknown'), 'plan');
    assert.equal(resolveWorkspaceTab(null), 'plan');
  });

  it('changes only the tab query and preserves safe view state', () => {
    assert.equal(
      createWorkspaceTabHref('tab=plan&section=housing&year=2048', 'analysis'),
      '/plan?tab=analysis&section=housing&year=2048'
    );
  });
  it('preserves the current localized route for client-only offline navigation', () => {
    assert.equal(
      createWorkspaceTabHref('tab=analysis', 'plan', '/en/plan'),
      '/en/plan?tab=plan'
    );
    assert.equal(
      createWorkspaceTabHref('section=career', 'analysis', '/plan'),
      '/plan?section=career&tab=analysis'
    );
  });
});

it('cancelled history traversal restores the same entry without discarding forward history', () => {
  const events = new EventTarget();
  const entries: object[] = [{ router: 'preserved' }];
  let position = 0;
  let allowed = false;
  let confirmations = 0;
  const history = {
    get state() {
      return entries[position];
    },
    replaceState(state: object) {
      entries[position] = state;
    },
    pushState(state: object) {
      entries.splice(position + 1);
      entries.push(state);
      position++;
    },
    go(delta: number) {
      position += delta;
      const event = new Event('popstate');
      Object.assign(event, { state: entries[position] });
      events.dispatchEvent(event);
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      history,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    },
  });
  try {
    const cleanup = installWorkspaceHistoryGuard(() => {
      confirmations++;
      return allowed;
    });
    assert.equal((history.state as { router: string }).router, 'preserved');
    pushWorkspaceHistory('/plan?tab=plan');
    pushWorkspaceHistory('/plan?tab=analysis');
    history.go(-2);
    assert.equal(position, 2);
    assert.equal(entries.length, 3);
    assert.equal(confirmations, 1);
    allowed = true;
    history.go(-1);
    assert.equal(position, 1);
    allowed = false;
    history.go(1);
    assert.equal(position, 1);
    assert.equal(entries.length, 3);
    allowed = true;
    history.go(1);
    assert.equal(position, 2);
    cleanup();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
