'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';

import { safeCalculateMonthlyLifePlan } from '../calculation';
import { createLocalId, migrateLifePlan, type LifePlan } from '../domain';
import {
  clearQuickPlanHandoff,
  clearQuickPlanHandoffV2,
  createWriterId,
  deleteActivePlan,
  getActivePlan,
  getLatestPlanSnapshot,
  openLifeLedgerDatabase,
  parsePlanBackup,
  PlanIntegrityError,
  PlanRevisionConflictError,
  replaceActivePlan,
  savePlan,
  type StoredPlanRecord,
} from '../storage';
import { decideWorkspaceBootstrap } from './bootstrap';
import { commitPlanEdit } from './commit-plan-edit';
import { initialWorkspaceState, workspaceReducer } from './workspace-reducer';
import type { WorkspaceCopy, WorkspaceState } from './workspace-types';

interface WorkspaceController {
  state: WorkspaceState;
  initialize: () => Promise<void>;
  updatePlan: (updater: (current: LifePlan) => LifePlan) => void;
  persistPlan: (plan: LifePlan) => Promise<void>;
  importBackup: (file: File) => Promise<void>;
  restoreLatestSnapshot: () => Promise<void>;
  deleteAndRestart: () => Promise<void>;
  applySimulation: (baselineHash: string, candidatePlan: LifePlan) => void;
  undoSimulation: () => void;
}

const WorkspaceContext = createContext<WorkspaceController | null>(null);

export function WorkspaceProvider({
  copy,
  children,
}: {
  copy: WorkspaceCopy;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  const currentPlanRef = useRef(state.plan);
  useEffect(() => {
    currentPlanRef.current = state.plan;
  }, [state.plan]);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const databaseRef = useRef<IDBDatabase | null>(null);
  const revisionRef = useRef(0);
  const persistedPlanRef = useRef<LifePlan | null>(null);
  const writerIdRef = useRef('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const calculationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialize = useCallback(async () => {
    if (calculationTimer.current) clearTimeout(calculationTimer.current);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await saveQueue.current;
    dispatch({ type: 'boot/loading' });
    try {
      writerIdRef.current = createWriterId();
      databaseRef.current?.close();
      const database = await openLifeLedgerDatabase();
      databaseRef.current = database;
      const current = await getActivePlan(database);
      const decision = decideWorkspaceBootstrap({
        sessionStorage: window.sessionStorage,
        localStorage: window.localStorage,
        current,
      });

      if (decision.source === 'handoff-v2') {
        const saved = await replaceActivePlan(
          database,
          decision.plan,
          writerIdRef.current
        );
        clearQuickPlanHandoffV2(window.sessionStorage);
        revisionRef.current = saved.revision;
        persistedPlanRef.current = saved.plan;
        dispatch({ type: 'plan/ready', record: saved });
        broadcastPlanSaved(saved, writerIdRef.current);
        return;
      }

      if (decision.source === 'handoff-v1') {
        const migrated = migrateLifePlan(decision.input, {
          planId: createLocalId('plan'),
          now: new Date().toISOString(),
        }).plan;
        const saved = await replaceActivePlan(
          database,
          migrated,
          writerIdRef.current
        );
        clearQuickPlanHandoff(window.sessionStorage);
        revisionRef.current = saved.revision;
        persistedPlanRef.current = saved.plan;
        dispatch({ type: 'plan/ready', record: saved });
        broadcastPlanSaved(saved, writerIdRef.current);
        return;
      }

      if (decision.source === 'stored-plan') {
        revisionRef.current = decision.record.revision;
        persistedPlanRef.current = decision.record.plan;
        dispatch({ type: 'plan/ready', record: decision.record });
        return;
      }

      if (decision.source === 'legacy-draft') {
        const migrated = migrateLifePlan(decision.draft.input, {
          planId: decision.draft.id,
          now: new Date().toISOString(),
        }).plan;
        const saved = await savePlan(
          database,
          migrated,
          writerIdRef.current,
          null
        );
        window.localStorage.removeItem(decision.draft.key);
        revisionRef.current = saved.revision;
        persistedPlanRef.current = saved.plan;
        dispatch({ type: 'plan/ready', record: saved });
        broadcastPlanSaved(saved, writerIdRef.current);
        return;
      }

      dispatch({ type: 'boot/empty' });
    } catch (error) {
      dispatch({
        type: 'boot/error',
        message:
          error instanceof PlanIntegrityError
            ? copy.errors.corrupt
            : copy.errors.storage,
      });
    }
  }, [copy.errors.storage, copy.errors.corrupt]);

  useEffect(() => {
    void initialize();
    return () => {
      if (calculationTimer.current) clearTimeout(calculationTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      databaseRef.current?.close();
    };
  }, [initialize]);

  useEffect(() => {
    const plan = state.plan;
    if (!plan) return;
    if (calculationTimer.current) clearTimeout(calculationTimer.current);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    dispatch({ type: 'calculation/stale' });
    calculationTimer.current = setTimeout(() => {
      const calculated = safeCalculateMonthlyLifePlan(plan);
      if (!calculated.ok) {
        dispatch({
          type: 'calculation/failure',
          message: copy.errors.invalid_plan,
        });
        return;
      }
      dispatch({ type: 'calculation/success', result: calculated.result });
      if (!databaseRef.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveQueue.current = saveQueue.current.then(async () => {
          if (currentPlanRef.current !== plan || !databaseRef.current) return;
          // Check after earlier queued writes, including a just-undone trial.
          if (persistedPlanRef.current === plan) {
            dispatch({ type: 'save/status', status: 'saved' });
            return;
          }
          dispatch({ type: 'save/status', status: 'saving' });
          try {
            const saved = await savePlan(
              databaseRef.current!,
              plan,
              writerIdRef.current,
              revisionRef.current
            );
            revisionRef.current = saved.revision;
            persistedPlanRef.current = saved.plan;
            if (currentPlanRef.current === plan) {
              dispatch({ type: 'save/status', status: 'saved' });
              dispatch({ type: 'error/clear' });
            }
            broadcastPlanSaved(saved, writerIdRef.current);
          } catch (error) {
            dispatch({ type: 'save/status', status: 'failed' });
            dispatch({
              type:
                error instanceof PlanRevisionConflictError
                  ? 'storage/conflict'
                  : 'error/set',
              message:
                error instanceof PlanRevisionConflictError
                  ? copy.errors.conflict
                  : copy.errors.save,
            });
          }
        });
      }, 500);
    }, 400);
    return () => {
      if (calculationTimer.current) clearTimeout(calculationTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [
    copy.errors.conflict,
    copy.errors.invalid_plan,
    copy.errors.save,
    state.plan,
    state.boot,
  ]);

  useEffect(() => {
    if (!state.plan || state.result) return;
    const calculated = safeCalculateMonthlyLifePlan(state.plan);
    if (calculated.ok) {
      dispatch({ type: 'calculation/success', result: calculated.result });
    }
  }, [state.plan, state.result]);

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('life-ledger');
    channel.onmessage = (event) => {
      if (
        event.data?.type === 'plan-saved' &&
        event.data.writerId !== writerIdRef.current &&
        (event.data.planId !== currentPlanRef.current?.id ||
          event.data.revision > revisionRef.current)
      ) {
        dispatch({ type: 'save/status', status: 'failed' });
        dispatch({ type: 'storage/conflict', message: copy.errors.conflict });
      }
    };
    return () => channel.close();
  }, [copy.errors.conflict]);

  const updatePlan = useCallback((updater: (current: LifePlan) => LifePlan) => {
    const updatedAt = new Date().toISOString();
    dispatch({
      type: 'plan/edit',
      updater: (current) =>
        commitPlanEdit(current, updater(current), updatedAt),
    });
  }, []);

  const persistPlan = useCallback(
    async (nextPlan: LifePlan) => {
      if (!databaseRef.current) return;
      if (!safeCalculateMonthlyLifePlan(nextPlan).ok) {
        dispatch({ type: 'error/set', message: copy.errors.invalid_plan });
        return;
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // Retry participates in the same queue as autosave. Repeated clicks must
      // not race or persist an older plan after a newer edit.
      saveQueue.current = saveQueue.current.then(async () => {
        if (!databaseRef.current || currentPlanRef.current !== nextPlan) return;
        if (persistedPlanRef.current === nextPlan) return;
        dispatch({ type: 'save/status', status: 'saving' });
        try {
          const saved = await savePlan(
            databaseRef.current,
            nextPlan,
            writerIdRef.current,
            revisionRef.current
          );
          revisionRef.current = saved.revision;
          persistedPlanRef.current = saved.plan;
          if (currentPlanRef.current === nextPlan) {
            dispatch({ type: 'save/status', status: 'saved' });
            dispatch({ type: 'error/clear' });
          }
          broadcastPlanSaved(saved, writerIdRef.current);
        } catch (error) {
          dispatch({ type: 'save/status', status: 'failed' });
          dispatch({
            type:
              error instanceof PlanRevisionConflictError
                ? 'storage/conflict'
                : 'error/set',
            message:
              error instanceof PlanRevisionConflictError
                ? copy.errors.conflict
                : copy.errors.save,
          });
        }
      });
      await saveQueue.current;
    },
    [copy.errors.conflict, copy.errors.invalid_plan, copy.errors.save]
  );

  const importBackup = useCallback(
    async (file: File) => {
      if (!databaseRef.current) return;
      try {
        const backup = parsePlanBackup(await file.text());
        const checked = safeCalculateMonthlyLifePlan(backup.plan);
        if (!checked.ok) throw new Error('Invalid calculation');
        if (saveTimer.current) clearTimeout(saveTimer.current);
        if (calculationTimer.current) clearTimeout(calculationTimer.current);
        await saveQueue.current;
        const saved = await replaceActivePlan(
          databaseRef.current,
          backup.plan,
          writerIdRef.current
        );
        revisionRef.current = saved.revision;
        persistedPlanRef.current = saved.plan;
        dispatch({ type: 'plan/ready', record: saved });
        broadcastPlanSaved(saved, writerIdRef.current);
      } catch (error) {
        dispatch({ type: 'error/set', message: copy.errors.import });
      }
    },
    [copy.errors.import]
  );

  const restoreLatestSnapshot = useCallback(async () => {
    if (!databaseRef.current) return;
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (calculationTimer.current) clearTimeout(calculationTimer.current);
      await saveQueue.current;
      const snapshot = await getLatestPlanSnapshot(databaseRef.current);
      if (!snapshot) {
        window.alert(copy.shell.no_snapshot);
        return;
      }
      const saved = await replaceActivePlan(
        databaseRef.current,
        snapshot.record.plan,
        writerIdRef.current
      );
      revisionRef.current = saved.revision;
      persistedPlanRef.current = saved.plan;
      dispatch({ type: 'plan/ready', record: saved });
      broadcastPlanSaved(saved, writerIdRef.current);
    } catch (error) {
      dispatch({ type: 'save/status', status: 'failed' });
      dispatch({
        type: 'error/set',
        message: error instanceof Error ? error.message : copy.errors.storage,
      });
    }
  }, [copy.errors.storage, copy.shell.no_snapshot]);

  const deleteAndRestart = useCallback(async () => {
    if (!databaseRef.current || !window.confirm(copy.shell.delete_confirm)) {
      return;
    }
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (calculationTimer.current) clearTimeout(calculationTimer.current);
      await saveQueue.current;
      await deleteActivePlan(databaseRef.current);
      revisionRef.current = 0;
      dispatch({ type: 'workspace/clear' });
    } catch (error) {
      dispatch({ type: 'save/status', status: 'failed' });
      dispatch({
        type: 'error/set',
        message: error instanceof Error ? error.message : copy.errors.storage,
      });
    }
  }, [copy.errors.storage, copy.shell.delete_confirm]);

  const controller = useMemo<WorkspaceController>(
    () => ({
      state,
      initialize,
      updatePlan,
      persistPlan,
      importBackup,
      restoreLatestSnapshot,
      deleteAndRestart,
      applySimulation: (baselineHash, candidatePlan) =>
        dispatch({
          type: 'simulation/apply',
          baselineHash,
          candidatePlan: state.plan
            ? commitPlanEdit(
                state.plan,
                candidatePlan,
                new Date().toISOString()
              )
            : candidatePlan,
        }),
      undoSimulation: () => dispatch({ type: 'simulation/undo' }),
    }),
    [
      deleteAndRestart,
      importBackup,
      initialize,
      persistPlan,
      restoreLatestSnapshot,
      state,
      updatePlan,
    ]
  );

  return (
    <WorkspaceContext.Provider value={controller}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error('useWorkspace must be used inside WorkspaceProvider.');
  }
  return value;
}

function broadcastPlanSaved(record: StoredPlanRecord, writerId: string) {
  if (!('BroadcastChannel' in window)) return;
  const channel = new BroadcastChannel('life-ledger');
  channel.postMessage({
    type: 'plan-saved',
    planId: record.id,
    revision: record.revision,
    writerId,
  });
  channel.close();
}
