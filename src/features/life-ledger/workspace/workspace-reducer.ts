import { compareResults } from '../analysis/digest-result';
import type { WorkspaceAction, WorkspaceState } from './workspace-types';

export const initialWorkspaceState: WorkspaceState = {
  boot: { status: 'loading' },
  plan: null,
  result: null,
  saveStatus: 'saved',
  calculationStatus: 'idle',
  calculationError: null,
  storageError: null,
  externalConflict: false,
  pendingChange: false,
  resultChange: null,
  appliedSnapshot: null,
};

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction
): WorkspaceState {
  switch (action.type) {
    case 'boot/loading':
      return { ...state, boot: { status: 'loading' } };
    case 'boot/empty':
      return {
        ...initialWorkspaceState,
        boot: { status: 'empty', reason: action.reason },
      };
    case 'boot/error':
      return {
        ...state,
        boot: { status: 'error', message: action.message },
      };
    case 'plan/ready':
      return {
        ...state,
        boot: { status: 'ready', record: action.record },
        plan: action.record.plan,
        result: null,
        pendingChange: false,
        resultChange: null,
        appliedSnapshot: null,
        saveStatus: 'saved',
        calculationStatus: 'calculating',
        calculationError: null,
        storageError: null,
        externalConflict: false,
      };
    case 'plan/update':
      return {
        ...state,
        plan: action.plan,
        appliedSnapshot: null,
        pendingChange: true,
        saveStatus: state.externalConflict ? 'failed' : 'stale',
        calculationStatus: 'calculating',
      };
    case 'plan/edit': {
      if (!state.plan) return state;
      const plan = action.updater(state.plan);
      if (plan === state.plan) return state;
      return workspaceReducer(state, { type: 'plan/update', plan });
    }
    case 'simulation/apply': {
      if (
        !state.plan ||
        state.externalConflict ||
        state.result?.inputHash !== action.baselineHash ||
        state.result.input !== state.plan ||
        state.calculationStatus !== 'idle'
      )
        return state;
      return {
        ...workspaceReducer(state, {
          type: 'plan/update',
          plan: action.candidatePlan,
        }),
        appliedSnapshot: { before: state.plan, applied: action.candidatePlan },
      };
    }
    case 'simulation/undo': {
      if (
        !state.appliedSnapshot ||
        state.plan !== state.appliedSnapshot.applied
      )
        return state;
      return workspaceReducer(state, {
        type: 'plan/update',
        plan: state.appliedSnapshot.before,
      });
    }
    case 'calculation/stale':
      return {
        ...state,
        saveStatus: state.externalConflict ? 'failed' : 'stale',
        calculationStatus: 'calculating',
      };
    case 'calculation/success':
      return {
        ...state,
        resultChange:
          state.pendingChange && state.result
            ? compareResults(state.result, action.result)
            : state.resultChange,
        pendingChange: false,
        result: action.result,
        calculationStatus: 'idle',
        calculationError: null,
      };
    case 'calculation/failure':
      return {
        ...state,
        calculationStatus: 'failed',
        calculationError: action.message,
      };
    case 'save/status':
      if (state.externalConflict) return state;
      return { ...state, saveStatus: action.status };
    case 'error/set':
      return { ...state, storageError: action.message };
    case 'storage/conflict':
      return {
        ...state,
        externalConflict: true,
        storageError: action.message,
        saveStatus: 'failed',
      };
    case 'error/clear':
      if (state.externalConflict) return state;
      return { ...state, storageError: null };
    case 'workspace/clear':
      return {
        ...initialWorkspaceState,
        boot: { status: 'empty' },
      };
  }
}
