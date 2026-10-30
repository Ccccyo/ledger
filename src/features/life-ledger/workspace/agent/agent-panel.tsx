'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronRight,
  LoaderCircle,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Wrench,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import {
  simulateAction,
  simulateScenario,
  type ScenarioComparison,
  type SimulationComparison,
} from '../../analysis/simulate-action';
import type { MonthlyCalculationResult } from '../../calculation';
import { addMonths, createLocalId, formatMonth } from '../../domain';
import {
  deleteAgentMemory,
  deleteAgentTask,
  listAgentMemories,
  loadAgentTask,
  saveAgentMemory,
  saveAgentTask,
  type StoredAgentMemory,
} from '../../storage/agent-state';
import { moneyFormatter } from '../plan/fields';
import { useWorkspace } from '../workspace-provider';
import type { WorkspaceCopy } from '../workspace-types';
import { fetchAgentTurn, warmAgentRoute } from './agent-client';
import { buildAgentContext } from './agent-context';
import { summarizeAgentQuality } from './agent-metrics';
import {
  executeReadOnlyAgentTool,
  simulateRelocationCandidate,
  type RelocationCandidateComparison,
} from './agent-tool-runtime';
import type {
  AgentDecision,
  AgentFeedbackReason,
  AgentHistoryMessage,
  AgentMessageFeedback,
  AgentObservation,
  AgentPerception,
  AgentPlan,
  AgentShortTermState,
  AgentTurnRequest,
  AgentTurnTrace,
} from './agent-types';
import { inferMemoryKind, queryAgentMemories } from './memory-query';
import { resolveAgentQuery } from './query-resolution';
import { updateWorkingMemory } from './working-memory';

const MAX_STEPS = 5;
const TURN_DEADLINE_MS = 12_000;
const ENHANCED_SESSION_KEY = 'life-ledger:agent-enhanced-session';
const FEEDBACK_REASONS: AgentFeedbackReason[] = [
  'misunderstood',
  'incorrect',
  'unclear',
  'slow',
  'other',
];

type EnhancementScope =
  | 'off'
  | 'once'
  | 'session'
  | 'agent-once'
  | 'agent-session';

interface ConversationMessage extends AgentHistoryMessage {
  id: string;
  evidence?: string[];
  caveats?: string[];
  trace?: AgentTurnTrace;
  feedback?: AgentMessageFeedback;
}

export function AgentPanel({
  copy,
  locale,
  result,
}: {
  copy: WorkspaceCopy;
  locale: string;
  result: MonthlyCalculationResult;
}) {
  const { state, applySimulation } = useWorkspace();
  const money = moneyFormatter(locale);
  const examples = copy.agent_panel.examples as string[];
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [runningReason, setRunningReason] = useState('');
  const [error, setError] = useState('');
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [consentPurpose, setConsentPurpose] = useState<'expression' | 'skills'>(
    'expression'
  );
  const [memories, setMemories] = useState<StoredAgentMemory[]>([]);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [taskHydrated, setTaskHydrated] = useState(false);
  const [taskStep, setTaskStep] = useState(0);
  const [taskObservations, setTaskObservations] = useState<AgentObservation[]>(
    []
  );
  const [taskTraces, setTaskTraces] = useState<AgentTurnTrace[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [enhancementScope, setEnhancementScope] =
    useState<EnhancementScope>('agent-session');
  const [proposal, setProposal] = useState<
    | SimulationComparison
    | ScenarioComparison
    | RelocationCandidateComparison
    | null
  >(null);
  const [sessionState, setSessionState] = useState<AgentShortTermState | null>(
    null
  );
  const messagesRef = useRef<ConversationMessage[]>([]);
  const taskSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    const savedScope = sessionStorage.getItem(ENHANCED_SESSION_KEY);
    if (savedScope === 'off') setEnhancementScope('off');
    else if (savedScope === 'yes') setEnhancementScope('session');
    else setEnhancementScope('agent-session');
  }, []);
  useEffect(() => {
    void warmAgentRoute();
  }, []);
  const context = useMemo(() => buildAgentContext(result), [result]);
  const planId = result.input.id;
  const taskStorageError = copy.agent_panel.task_storage_error as string;
  useEffect(() => {
    let active = true;
    setTaskHydrated(false);
    Promise.all([loadAgentTask(planId), listAgentMemories(planId)])
      .then(([task, savedMemories]) => {
        if (!active) return;
        const restored = task?.planHash === context.planHash ? task : null;
        updateMessages(() => restored?.messages ?? []);
        setActiveQuestion(
          restored?.status === 'running' || restored?.status === 'interrupted'
            ? restored.activeQuestion
            : null
        );
        setTaskStep(restored?.step ?? 0);
        setTaskObservations(restored?.observations ?? []);
        setTaskTraces(restored?.traceSteps ?? []);
        setSessionState(
          restored?.sessionState ?? createShortTermState(context.planHash)
        );
        setMemories(savedMemories);
        setTaskHydrated(true);
      })
      .catch(() => {
        if (active) {
          setTaskHydrated(true);
          setError(taskStorageError);
        }
      });
    return () => {
      active = false;
    };
  }, [planId, context.planHash, taskStorageError]);
  useEffect(() => {
    if (!taskHydrated || (messages.length === 0 && !activeQuestion)) return;
    const task = {
      planId,
      planHash: context.planHash,
      messages: messages.slice(-20),
      activeQuestion,
      step: taskStep,
      observations: taskObservations.slice(-5),
      traceSteps: taskTraces.slice(-20),
      sessionState: sessionState ?? createShortTermState(context.planHash),
      status: (busy ? 'running' : activeQuestion ? 'interrupted' : 'idle') as
        | 'running'
        | 'interrupted'
        | 'idle',
      updatedAt: new Date().toISOString(),
    };
    taskSaveQueueRef.current = taskSaveQueueRef.current
      .catch(() => {})
      .then(() => saveAgentTask(task))
      .catch(() => setError(taskStorageError));
  }, [
    planId,
    context.planHash,
    messages,
    activeQuestion,
    taskStep,
    taskObservations,
    taskTraces,
    sessionState,
    busy,
    taskHydrated,
    taskStorageError,
  ]);
  const proposalStale = Boolean(
    proposal &&
      (state.externalConflict ||
        state.result?.inputHash !== proposal.baselineHash ||
        state.calculationStatus !== 'idle')
  );
  const qualitySummary = useMemo(
    () => summarizeAgentQuality(taskTraces, messages),
    [taskTraces, messages]
  );

  function updateMessages(
    updater: (current: ConversationMessage[]) => ConversationMessage[]
  ) {
    const next = updater(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
  }

  function setMessageFeedback(
    messageId: string,
    rating: AgentMessageFeedback['rating'],
    reason: AgentFeedbackReason | null = null
  ) {
    updateMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              feedback: {
                rating,
                reason,
                createdAt: new Date().toISOString(),
              },
            }
          : message
      )
    );
  }

  async function startTurn(value: string, forceLocal = false) {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    const interactionStartedAt = performance.now();

    // The first suggested question has one deterministic ledger operation.
    // Run it in-process so a common first interaction never waits for a model
    // or even a network round trip.
    if (trimmed === examples[0]) {
      const retirementMonth = addMonths(result.input.retirementMonth, 24);
      if (retirementMonth < result.input.endMonthExclusive) {
        try {
          const comparison = simulateAction(result.input, result, {
            type: 'change-retirement-month',
            retirementMonth,
          });
          updateMessages((current) => [
            ...current,
            {
              id: createLocalId('message'),
              role: 'user',
              content: trimmed,
            },
          ]);
          setQuestion('');
          setError('');
          setFallbackUsed(false);
          setTaskObservations([]);
          setTaskStep(0);
          setProposal(comparison);
          setActiveQuestion(null);
          const durationMs = Math.round(
            performance.now() - interactionStartedAt
          );
          const trace: AgentTurnTrace = {
            id: createLocalId('trace'),
            totalMs: durationMs,
            perceptionMs: 0,
            planningMs: 0,
            perceptionSource: 'rule',
            intent: 'plan_change',
            confidence: 'high',
            skillId: 'scenario-planning',
            decisionType: 'tool',
            tool: 'simulate_patch',
            fallbackReason: null,
            endToEndMs: durationMs,
            stepCount: 1,
            toolCallCount: 1,
            outcome: 'proposal',
          };
          setTaskTraces((current) => [...current, trace].slice(-20));
          updateMessages((current) => [
            ...current,
            {
              id: createLocalId('message'),
              role: 'assistant',
              content: copy.agent_panel.proposal_intro,
              evidence: [
                locale.startsWith('zh')
                  ? '已用当前账本在本地完成试算。'
                  : 'Calculated locally from the current ledger.',
              ],
              trace,
            },
          ]);
          return;
        } catch {
          // Fall through to the guarded local route for uncommon plan bounds.
        }
      }
    }

    const expressionMode = forceLocal
      ? 'strict'
      : enhancementScope.startsWith('agent-')
        ? 'autonomous'
        : enhancementScope === 'off'
          ? 'strict'
          : 'enhanced';
    if (
      !forceLocal &&
      (enhancementScope === 'once' || enhancementScope === 'agent-once')
    ) {
      setEnhancementScope('off');
    }
    await runTurn(trimmed, expressionMode);
  }

  async function runTurn(
    value: string,
    expressionMode: 'strict' | 'enhanced' | 'autonomous',
    resume = false
  ) {
    const turnStartedAt = performance.now();
    let toolCallCount = 0;
    let attemptedSteps = 0;
    let lastTrace: AgentTurnTrace | null = null;
    const priorHistory = messagesRef.current
      .slice(-6)
      .map(({ role, content }) => ({
        role,
        content,
      }));
    if (!resume)
      updateMessages((current) => [
        ...current,
        {
          id: createLocalId('message'),
          role: 'user',
          content: value,
        },
      ]);
    setQuestion('');
    setError('');
    setFallbackUsed(false);
    if (!resume) {
      setProposal(null);
      setTaskObservations([]);
    }
    setBusy(true);
    setActiveQuestion(value);
    if (!resume) setTaskStep(0);
    const controller = new AbortController();
    abortRef.current = controller;
    const observations: AgentObservation[] = resume
      ? [...taskObservations]
      : [];
    let workingSessionState =
      sessionState?.planHash === context.planHash
        ? sessionState
        : createShortTermState(context.planHash);
    const resolution = resolveAgentQuery({
      question: value,
      history: priorHistory,
      sessionState: workingSessionState,
    });
    workingSessionState = {
      ...workingSessionState,
      activeIntent: resolution.intent,
      referencedEntity:
        resolution.referencedEntity ?? workingSessionState.referencedEntity,
      referencedYear: resolution.resolvedQuestion.match(
        /(?:19|20|21)\d{2}/
      )?.[0]
        ? Number(resolution.resolvedQuestion.match(/(?:19|20|21)\d{2}/)?.[0])
        : workingSessionState.referencedYear,
      lastToolFingerprints: resume
        ? workingSessionState.lastToolFingerprints
        : [],
      updatedAt: new Date().toISOString(),
    };
    setSessionState(workingSessionState);
    const relevantMemories = queryAgentMemories(memories, value);
    const seenCalls = new Set<string>(
      resume ? workingSessionState.lastToolFingerprints : []
    );
    const completeTrace = (
      outcome: NonNullable<AgentTurnTrace['outcome']>,
      base: AgentTurnTrace | null = lastTrace
    ): AgentTurnTrace => {
      const endToEndMs = Math.round(performance.now() - turnStartedAt);
      return {
        ...(base ?? {
          id: createLocalId('trace'),
          totalMs: 0,
          perceptionMs: 0,
          planningMs: 0,
          perceptionSource: 'fallback' as const,
          intent: 'unknown' as const,
          confidence: 'low' as const,
          skillId: null,
          decisionType: 'answer' as const,
          tool: null,
          fallbackReason: 'No server trace was available.',
        }),
        endToEndMs,
        stepCount: attemptedSteps,
        toolCallCount,
        outcome,
      };
    };
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TURN_DEADLINE_MS);

    try {
      for (let step = resume ? taskStep : 0; step < MAX_STEPS; step += 1) {
        attemptedSteps = step + 1;
        setTaskStep(step);
        const request: AgentTurnRequest = {
          question: value,
          locale,
          context,
          history: priorHistory,
          observations,
          memories: relevantMemories,
          sessionState: workingSessionState,
          step,
          expressionMode,
        };
        const { response, usedLocalRescue } = await fetchAgentTurn(
          request,
          controller.signal
        );
        if (!response.ok) throw new Error(copy.agent_panel.errors.request);
        const payload = (await response.json()) as {
          decision?: AgentDecision;
          perception?: AgentPerception;
          plan?: AgentPlan;
          trace?: AgentTurnTrace;
          enhancement?: 'applied' | 'unavailable' | 'not-requested';
        };
        if (!payload.decision)
          throw new Error(copy.agent_panel.errors.response);
        const turnTrace = payload.trace
          ? {
              ...payload.trace,
              fallbackReason: usedLocalRescue
                ? 'Autonomous step exceeded its soft deadline; retried locally.'
                : payload.trace.fallbackReason,
            }
          : undefined;
        if (turnTrace) lastTrace = turnTrace;
        if (
          expressionMode !== 'strict' &&
          (payload.enhancement === 'unavailable' || usedLocalRescue)
        ) {
          setFallbackUsed(true);
        }
        if (payload.perception && payload.plan) {
          workingSessionState = {
            ...workingSessionState,
            workingMemory: updateWorkingMemory(
              workingSessionState.workingMemory,
              context.planHash,
              payload.perception,
              payload.plan
            ),
            updatedAt: new Date().toISOString(),
          };
          setSessionState(workingSessionState);
        }
        const decision = payload.decision;

        if (decision.type === 'answer') {
          const completedTrace = completeTrace('answer', turnTrace ?? null);
          setTaskTraces((current) => [...current, completedTrace].slice(-20));
          const answerYear = decision.answer.match(/(?:19|20|21)\d{2}/)?.[0];
          if (answerYear) {
            workingSessionState = {
              ...workingSessionState,
              referencedYear: Number(answerYear),
              updatedAt: new Date().toISOString(),
            };
            setSessionState(workingSessionState);
          }
          setActiveQuestion(null);
          updateMessages((current) => [
            ...current,
            {
              id: createLocalId('message'),
              role: 'assistant',
              content: decision.answer,
              evidence: decision.evidence,
              trace: completedTrace,
              caveats:
                expressionMode !== 'strict' &&
                (payload.enhancement === 'unavailable' || usedLocalRescue)
                  ? [
                      ...decision.caveats,
                      copy.agent_panel.enhancement_unavailable,
                    ]
                  : decision.caveats,
            },
          ]);
          return;
        }
        if (decision.type === 'clarify') {
          const completedTrace = completeTrace('clarify', turnTrace ?? null);
          setTaskTraces((current) => [...current, completedTrace].slice(-20));
          setActiveQuestion(null);
          updateMessages((current) => [
            ...current,
            {
              id: createLocalId('message'),
              role: 'assistant',
              content: decision.question,
              trace: completedTrace,
              caveats:
                expressionMode !== 'strict' &&
                (payload.enhancement === 'unavailable' || usedLocalRescue)
                  ? [copy.agent_panel.enhancement_unavailable]
                  : undefined,
            },
          ]);
          return;
        }

        setRunningReason(decision.reason);
        const callKey = JSON.stringify(decision.tool);
        if (seenCalls.has(callKey)) {
          if (turnTrace) {
            setTaskTraces((current) => [...current, turnTrace].slice(-20));
          }
          observations.push({
            tool: decision.tool.name,
            ok: false,
            error: 'Guardrail stopped a repeated tool call.',
          });
          setTaskObservations([...observations]);
          continue;
        }
        seenCalls.add(callKey);
        toolCallCount += 1;
        workingSessionState = {
          ...workingSessionState,
          lastToolFingerprints: [...seenCalls].slice(-5),
          updatedAt: new Date().toISOString(),
        };
        setSessionState(workingSessionState);

        if (
          decision.tool.name !== 'simulate_patch' &&
          decision.tool.name !== 'simulate_scenario' &&
          decision.tool.name !== 'simulate_relocation_candidate'
        ) {
          const observation = await executeReadOnlyAgentTool(
            result,
            decision.tool,
            controller.signal
          );
          observations.push(observation);
          if (
            observation.tool === 'lookup_city_costs' &&
            observation.ok &&
            observation.result &&
            typeof observation.result === 'object' &&
            (observation.result as { kind?: unknown }).kind ===
              'city-cost-candidate'
          ) {
            workingSessionState = {
              ...workingSessionState,
              pendingCityCandidate:
                observation.result as AgentShortTermState['pendingCityCandidate'],
              updatedAt: new Date().toISOString(),
            };
            setSessionState(workingSessionState);
          }
          setTaskObservations([...observations]);
          setTaskStep(step + 1);
          if (turnTrace) {
            setTaskTraces((current) => [...current, turnTrace].slice(-20));
          }
          continue;
        }

        try {
          const comparison =
            decision.tool.name === 'simulate_relocation_candidate'
              ? workingSessionState.pendingCityCandidate
                ? simulateRelocationCandidate(
                    result,
                    decision.tool.arguments.relocationId,
                    workingSessionState.pendingCityCandidate
                  )
                : (() => {
                    throw new Error(
                      'No verified city candidate is available for simulation.'
                    );
                  })()
              : decision.tool.name === 'simulate_scenario'
                ? simulateScenario(
                    result.input,
                    result,
                    decision.tool.arguments.patches
                  )
                : simulateAction(
                    result.input,
                    result,
                    decision.tool.arguments.patch
                  );
          setProposal(comparison);
          setActiveQuestion(null);
          const completedTrace = completeTrace('proposal', turnTrace ?? null);
          setTaskTraces((current) => [...current, completedTrace].slice(-20));
          updateMessages((current) => [
            ...current,
            {
              id: createLocalId('message'),
              role: 'assistant',
              content: copy.agent_panel.proposal_intro,
              evidence: [decision.reason],
              trace: completedTrace,
            },
          ]);
          return;
        } catch (toolError) {
          observations.push({
            tool: decision.tool.name,
            ok: false,
            error:
              toolError instanceof Error
                ? toolError.message
                : 'Simulation failed.',
          });
          setTaskObservations([...observations]);
          setTaskStep(step + 1);
          if (turnTrace) {
            setTaskTraces((current) => [...current, turnTrace].slice(-20));
          }
        }
      }
      throw new Error(copy.agent_panel.errors.step_limit);
    } catch (turnError) {
      const failureTrace = completeTrace(timedOut ? 'timeout' : 'error');
      setTaskTraces((current) => [...current, failureTrace].slice(-20));
      if (timedOut) {
        setError(
          locale.startsWith('zh')
            ? '本轮任务超过 12 秒，已停止执行；正式计划没有改变。'
            : 'This turn exceeded 12 seconds and was stopped; the formal plan was not changed.'
        );
      } else if ((turnError as Error).name !== 'AbortError') {
        setError(
          turnError instanceof Error
            ? turnError.message
            : copy.agent_panel.errors.request
        );
      }
    } finally {
      window.clearTimeout(deadline);
      setBusy(false);
      setRunningReason('');
      abortRef.current = null;
    }
  }

  const gap = (month: number | null) =>
    month === null ? copy.agent_panel.no_gap : formatMonth(month as never);
  const currentMode = enhancementScope.startsWith('agent-')
    ? enhancementScope === 'agent-once'
      ? copy.agent_panel.mode_agent_once
      : copy.agent_panel.mode_agent_session
    : enhancementScope === 'once'
      ? copy.agent_panel.mode_enhanced_once
      : enhancementScope === 'session'
        ? copy.agent_panel.mode_enhanced_session
        : copy.agent_panel.mode_strict;
  const currentPrivacy = enhancementScope.startsWith('agent-')
    ? copy.agent_panel.privacy_agent
    : enhancementScope === 'off'
      ? copy.agent_panel.privacy_strict
      : copy.agent_panel.privacy_enhanced;

  return (
    <aside
      className="bg-background ring-border/40 flex flex-col overflow-hidden rounded-[1.75rem] shadow-[0_28px_65px_-46px_rgba(15,118,78,0.5)] ring-1 xl:sticky xl:top-36 xl:h-[calc(100dvh-10rem)] xl:min-h-[600px]"
      aria-labelledby="agent-panel-title"
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-5 sm:px-6 sm:pt-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="agent-panel-title" className="font-semibold">
              {copy.agent_panel.title}
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">
              {copy.agent_panel.subtitle}
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label={copy.agent_panel.settings}
          title={copy.agent_panel.settings}
          onClick={() => setShowSettings(true)}
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-primary/25 relative flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:ring-4 focus-visible:outline-none"
        >
          <Settings2 className="size-4.5" aria-hidden="true" />
          {enhancementScope !== 'off' && (
            <span
              className="bg-primary absolute top-2 right-2 size-1.5 rounded-full"
              aria-hidden="true"
            />
          )}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        <div className="space-y-4 p-4 sm:p-6">
          {messages.length === 0 ? (
            <AgentWelcome copy={copy} />
          ) : (
            <div className="space-y-3">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground ml-8 rounded-xl rounded-br-sm px-3.5 py-3 text-sm'
                      : 'bg-muted/55 mr-3 rounded-xl rounded-bl-sm px-3.5 py-3 text-sm'
                  }
                >
                  {message.content.split('\n').map((line, index) => (
                    <p
                      key={`${message.id}-${index}`}
                      className={
                        message.role === 'assistant' && index > 0
                          ? 'text-muted-foreground mt-1.5 text-xs leading-relaxed'
                          : 'leading-relaxed'
                      }
                    >
                      {line}
                    </p>
                  ))}
                  {message.evidence && message.evidence.length > 0 && (
                    <ul className="border-border/70 mt-3 space-y-1.5 border-t pt-3 text-xs leading-relaxed">
                      {message.evidence.map((item) => (
                        <li key={item} className="flex gap-1.5">
                          <Check className="mt-0.5 size-3 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {message.caveats?.map((item) => (
                    <p
                      key={item}
                      className="text-muted-foreground mt-2 text-[11px] leading-relaxed"
                    >
                      {item}
                    </p>
                  ))}
                  {message.role === 'assistant' && message.trace && (
                    <p className="text-muted-foreground/75 border-border/50 mt-2 border-t pt-2 font-mono text-[10px] leading-relaxed">
                      {message.trace.intent}
                      {message.trace.skillId
                        ? ` · ${message.trace.skillId}`
                        : ''}
                      {` · ${message.trace.perceptionSource} · ${message.trace.totalMs}ms`}
                      {typeof message.trace.endToEndMs === 'number'
                        ? ` · E2E ${message.trace.endToEndMs}ms`
                        : ''}
                    </p>
                  )}
                  {message.role === 'assistant' && message.trace && (
                    <div className="border-border/50 mt-2 border-t pt-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground mr-1 text-[11px]">
                          {copy.agent_panel.feedback_prompt}
                        </span>
                        <button
                          type="button"
                          aria-label={copy.agent_panel.feedback_helpful}
                          aria-pressed={message.feedback?.rating === 'helpful'}
                          title={copy.agent_panel.feedback_helpful}
                          onClick={() =>
                            setMessageFeedback(message.id, 'helpful')
                          }
                          className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                            message.feedback?.rating === 'helpful'
                              ? 'bg-primary/15 text-primary'
                              : 'text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          <ThumbsUp className="size-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={copy.agent_panel.feedback_not_helpful}
                          aria-pressed={
                            message.feedback?.rating === 'not_helpful'
                          }
                          title={copy.agent_panel.feedback_not_helpful}
                          onClick={() =>
                            setMessageFeedback(message.id, 'not_helpful')
                          }
                          className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                            message.feedback?.rating === 'not_helpful'
                              ? 'bg-destructive/10 text-destructive'
                              : 'text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          <ThumbsDown className="size-3.5" aria-hidden="true" />
                        </button>
                        {message.feedback?.rating === 'helpful' && (
                          <span className="text-muted-foreground text-[11px]">
                            {copy.agent_panel.feedback_thanks}
                          </span>
                        )}
                      </div>
                      {message.feedback?.rating === 'not_helpful' && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="text-muted-foreground w-full text-[11px]">
                            {copy.agent_panel.feedback_reason_prompt}
                          </span>
                          {FEEDBACK_REASONS.map((reason) => (
                            <button
                              type="button"
                              key={reason}
                              aria-pressed={message.feedback?.reason === reason}
                              onClick={() =>
                                setMessageFeedback(
                                  message.id,
                                  'not_helpful',
                                  reason
                                )
                              }
                              className={`rounded-full border px-2 py-1 text-[10px] ${
                                message.feedback?.reason === reason
                                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                                  : 'border-border text-muted-foreground'
                              }`}
                            >
                              {copy.agent_panel[`feedback_reason_${reason}`]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          {busy && (
            <div className="border-primary/20 bg-primary/5 flex items-start gap-2.5 rounded-xl border p-3 text-sm">
              <LoaderCircle
                className="text-primary mt-0.5 size-4 shrink-0 animate-spin"
                aria-hidden="true"
              />
              <div>
                <p className="font-medium">{copy.agent_panel.running}</p>
                {runningReason && (
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    {runningReason}
                  </p>
                )}
              </div>
            </div>
          )}

          {proposal && (
            <section className="rounded-xl border border-amber-300/70 bg-amber-50/70 p-3.5 dark:border-amber-700/60 dark:bg-amber-950/25">
              <div className="flex items-start gap-2">
                <Wrench className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
                <div>
                  <h3 className="text-sm font-semibold">
                    {copy.agent_panel.proposal_title}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    {patchLabel(proposal.patch, context, locale)}
                  </p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-amber-200/70 pt-3 text-xs dark:border-amber-800/60">
                <div>
                  <dt className="text-muted-foreground">
                    {copy.agent_panel.ending}
                  </dt>
                  <dd className="mt-1 font-semibold tabular-nums">
                    {money(proposal.change.before.endingAvailableCents)}
                    <ChevronRight className="mx-1 inline size-3" />
                    {money(proposal.change.after.endingAvailableCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {copy.agent_panel.first_gap}
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {gap(proposal.change.before.firstGapMonth)}
                    <ChevronRight className="mx-1 inline size-3" />
                    {gap(proposal.change.after.firstGapMonth)}
                  </dd>
                </div>
              </dl>
              {proposalStale && (
                <p className="mt-3 flex gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  {copy.agent_panel.proposal_stale}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={proposalStale}
                  onClick={() => {
                    applySimulation(
                      proposal.baselineHash,
                      proposal.candidatePlan
                    );
                    setProposal(null);
                    setSessionState((current) =>
                      current
                        ? {
                            ...current,
                            pendingCityCandidate: null,
                            lastToolFingerprints: [],
                            updatedAt: new Date().toISOString(),
                          }
                        : current
                    );
                    updateMessages((current) => [
                      ...current,
                      {
                        id: createLocalId('message'),
                        role: 'assistant',
                        content: copy.agent_panel.applied,
                      },
                    ]);
                  }}
                  className="bg-primary text-primary-foreground min-h-10 rounded-lg px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {copy.agent_panel.apply}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProposal(null);
                    setSessionState((current) =>
                      current
                        ? {
                            ...current,
                            pendingCityCandidate: null,
                            lastToolFingerprints: [],
                            updatedAt: new Date().toISOString(),
                          }
                        : current
                    );
                  }}
                  className="border-border bg-background min-h-10 rounded-lg border px-3 text-xs"
                >
                  {copy.agent_panel.discard}
                </button>
              </div>
            </section>
          )}

          {error && (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/5 text-destructive flex gap-2 rounded-xl border p-3 text-xs leading-relaxed"
            >
              <AlertTriangle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {fallbackUsed && !error && (
            <p
              role="status"
              className="text-muted-foreground text-xs leading-relaxed"
            >
              {copy.agent_panel.model_fallback_notice}
            </p>
          )}

          {activeQuestion && !busy && taskHydrated && (
            <button
              type="button"
              className="border-primary/30 text-primary min-h-10 rounded-lg border px-3 text-xs font-medium"
              onClick={() => {
                const mode = enhancementScope.startsWith('agent-')
                  ? 'autonomous'
                  : enhancementScope === 'off'
                    ? 'strict'
                    : 'enhanced';
                void runTurn(activeQuestion, mode, true);
              }}
            >
              {copy.agent_panel.resume_task}
            </button>
          )}

          {messages.length > 0 && !busy && (
            <button
              type="button"
              onClick={() => {
                updateMessages(() => []);
                setProposal(null);
                setSessionState(createShortTermState(context.planHash));
                setTaskTraces([]);
                setError('');
                setTaskHydrated(false);
                taskSaveQueueRef.current = taskSaveQueueRef.current
                  .catch(() => {})
                  .then(() => deleteAgentTask(planId))
                  .finally(() => setTaskHydrated(true));
              }}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs"
            >
              <RotateCcw className="size-3" />
              {copy.agent_panel.new_conversation}
            </button>
          )}
        </div>
      </div>

      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto sm:max-w-md">
          <DialogHeader className="pr-7 text-left">
            <DialogTitle>{copy.agent_panel.settings}</DialogTitle>
            <DialogDescription className="leading-relaxed">
              {copy.agent_panel.settings_description}
            </DialogDescription>
          </DialogHeader>

          <section className="mt-5" aria-labelledby="assistant-mode-heading">
            <div className="flex items-center justify-between gap-3">
              <h3 id="assistant-mode-heading" className="text-sm font-semibold">
                {copy.agent_panel.analysis_mode}
              </h3>
              <span className="text-muted-foreground text-xs">
                {copy.agent_panel.current_mode} · {currentMode}
              </span>
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {currentPrivacy}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {enhancementScope === 'off' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettings(false);
                      setConsentPurpose('expression');
                      setShowConsent(true);
                    }}
                    className="border-border bg-background hover:bg-muted min-h-10 rounded-lg border px-3 text-xs font-medium"
                  >
                    {copy.agent_panel.enable_enhancement}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettings(false);
                      setConsentPurpose('skills');
                      setShowConsent(true);
                    }}
                    className="bg-primary text-primary-foreground min-h-10 rounded-lg px-3 text-xs font-medium"
                  >
                    {copy.agent_panel.enable_agent}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    sessionStorage.setItem(ENHANCED_SESSION_KEY, 'off');
                    setEnhancementScope('off');
                  }}
                  className="border-border bg-background hover:bg-muted min-h-10 rounded-lg border px-3 text-xs font-medium"
                >
                  {copy.agent_panel.disable_enhancement}
                </button>
              )}
            </div>
          </section>

          <section
            className="border-border mt-5 border-t pt-5"
            aria-labelledby="assistant-quality-heading"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3
                id="assistant-quality-heading"
                className="text-sm font-semibold"
              >
                {copy.agent_panel.quality_title}
              </h3>
              <span className="text-muted-foreground text-xs tabular-nums">
                n={qualitySummary.completedSampleSize}
              </span>
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {copy.agent_panel.quality_description}
            </p>
            {qualitySummary.completedSampleSize === 0 ? (
              <p className="text-muted-foreground mt-3 text-xs">
                {copy.agent_panel.quality_no_data}
              </p>
            ) : (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <QualityMetric
                  label={copy.agent_panel.quality_p50}
                  value={`${qualitySummary.medianEndToEndMs ?? 0} ms`}
                />
                <QualityMetric
                  label={copy.agent_panel.quality_p95}
                  value={`${qualitySummary.p95EndToEndMs ?? 0} ms`}
                />
                <QualityMetric
                  label={copy.agent_panel.quality_helpful_rate}
                  value={
                    qualitySummary.helpfulRatePercent === null
                      ? `— (n=${qualitySummary.feedbackSampleSize})`
                      : `${qualitySummary.helpfulRatePercent}% (n=${qualitySummary.feedbackSampleSize})`
                  }
                />
                <QualityMetric
                  label={copy.agent_panel.quality_fallback_rate}
                  value={`${qualitySummary.fallbackRatePercent ?? 0}%`}
                />
                <QualityMetric
                  label={copy.agent_panel.quality_clarification_rate}
                  value={`${qualitySummary.clarificationRatePercent ?? 0}%`}
                />
                <QualityMetric
                  label={copy.agent_panel.quality_failure_rate}
                  value={`${qualitySummary.failureRatePercent ?? 0}%`}
                />
              </dl>
            )}
            <p className="text-muted-foreground mt-3 text-[11px] leading-relaxed">
              {copy.agent_panel.quality_caveat}
            </p>
          </section>

          <section
            className="border-border mt-5 border-t pt-5"
            aria-labelledby="assistant-preferences-heading"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3
                id="assistant-preferences-heading"
                className="text-sm font-semibold"
              >
                {copy.agent_panel.memory_title}
              </h3>
              <span className="text-muted-foreground text-xs tabular-nums">
                {memories.length}/5
              </span>
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {copy.agent_panel.memory_description}
            </p>
            {memories.length > 0 && (
              <ul className="mt-3 space-y-2 text-xs">
                {memories.map((memory) => (
                  <li
                    key={memory.id}
                    className="bg-muted/40 flex items-start justify-between gap-3 rounded-lg px-3 py-2.5"
                  >
                    <span className="min-w-0 leading-relaxed break-words">
                      {memory.text}
                    </span>
                    <button
                      type="button"
                      className="text-destructive shrink-0 underline underline-offset-2"
                      onClick={() => {
                        void deleteAgentMemory(memory.id)
                          .then(() =>
                            setMemories((current) =>
                              current.filter((item) => item.id !== memory.id)
                            )
                          )
                          .catch(() => setError(copy.agent_panel.memory_error));
                      }}
                    >
                      {copy.agent_panel.memory_delete}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const text = memoryDraft.trim();
                if (!text || memories.length >= 5) return;
                const memory = {
                  id: createLocalId('agent-memory'),
                  planId,
                  text,
                  createdAt: new Date().toISOString(),
                  kind: inferMemoryKind(text),
                  source: 'user_confirmed' as const,
                  status: 'active' as const,
                  effectiveFrom: new Date().toISOString(),
                  expiresAt: null,
                };
                void saveAgentMemory(memory)
                  .then(() => {
                    setMemories((current) => [...current, memory]);
                    setMemoryDraft('');
                  })
                  .catch(() => setError(copy.agent_panel.memory_error));
              }}
            >
              <input
                value={memoryDraft}
                maxLength={160}
                onChange={(event) => setMemoryDraft(event.target.value)}
                placeholder={copy.agent_panel.memory_placeholder}
                aria-label={copy.agent_panel.memory_placeholder}
                className="border-input bg-background min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs"
              />
              <button
                type="submit"
                disabled={!memoryDraft.trim() || memories.length >= 5}
                className="border-primary/30 text-primary min-h-10 shrink-0 rounded-lg border px-3 text-xs font-medium disabled:opacity-45"
              >
                {copy.agent_panel.memory_add}
              </button>
            </form>
          </section>
        </DialogContent>
      </Dialog>

      <Dialog open={showConsent} onOpenChange={setShowConsent}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-md">
          <DialogHeader className="pr-7 text-left">
            <span className="bg-primary/10 text-primary mb-1 flex size-9 items-center justify-center rounded-lg">
              <ShieldCheck className="size-4" aria-hidden="true" />
            </span>
            <DialogTitle>
              {consentPurpose === 'skills'
                ? copy.agent_panel.skill_consent_title
                : copy.agent_panel.consent_title}
            </DialogTitle>
            <DialogDescription className="leading-relaxed">
              {consentPurpose === 'skills'
                ? copy.agent_panel.skill_consent_description
                : copy.agent_panel.consent_description}
            </DialogDescription>
          </DialogHeader>

          <dl className="border-border divide-border overflow-hidden rounded-xl border text-xs">
            {(
              [
                ['fields', copy.agent_panel.consent_fields],
                ['service', copy.agent_panel.consent_service],
                ['storage', copy.agent_panel.consent_storage],
                ['scope', copy.agent_panel.consent_scope],
              ] as const
            ).map(([key, value]) => (
              <div
                key={key}
                className="grid gap-1 border-b px-3.5 py-3 last:border-b-0 sm:grid-cols-[6rem_1fr] sm:gap-3"
              >
                <dt className="text-muted-foreground">
                  {copy.agent_panel[`consent_${key}_label`]}
                </dt>
                <dd className="leading-relaxed">
                  {consentPurpose === 'skills'
                    ? copy.agent_panel[`skill_consent_${key}`]
                    : value}
                </dd>
              </div>
            ))}
          </dl>

          <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {copy.agent_panel.consent_warning}
          </p>

          <DialogFooter className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                sessionStorage.setItem(ENHANCED_SESSION_KEY, 'off');
                setEnhancementScope(
                  consentPurpose === 'skills' ? 'agent-once' : 'once'
                );
                setShowConsent(false);
              }}
              className="border-primary/35 text-primary hover:bg-primary/5 min-h-10 rounded-lg border px-3 text-xs font-medium"
            >
              {copy.agent_panel.consent_once}
            </button>
            <button
              type="button"
              onClick={() => {
                sessionStorage.setItem(
                  ENHANCED_SESSION_KEY,
                  consentPurpose === 'skills' ? 'agent' : 'yes'
                );
                setEnhancementScope(
                  consentPurpose === 'skills' ? 'agent-session' : 'session'
                );
                setShowConsent(false);
              }}
              className="bg-primary text-primary-foreground min-h-10 rounded-lg px-3 text-xs font-medium"
            >
              {copy.agent_panel.consent_session}
            </button>
            <button
              type="button"
              onClick={() => setShowConsent(false)}
              className="text-muted-foreground hover:text-foreground min-h-9 text-xs sm:col-span-2"
            >
              {copy.agent_panel.consent_cancel}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <form
        className="bg-muted/30 m-3 mt-0 shrink-0 rounded-xl p-4 sm:m-4 sm:mt-0"
        onSubmit={(event) => {
          event.preventDefault();
          void startTurn(question);
        }}
      >
        {messages.length === 0 && (
          <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {examples.slice(0, 6).map((example) => (
              <button
                type="button"
                key={example}
                onClick={() => void startTurn(example, true)}
                className="border-border bg-background hover:border-primary/40 hover:bg-primary/[0.025] focus-visible:ring-primary/20 min-h-11 rounded-xl border px-3 py-2.5 text-left text-[11px] leading-snug transition-colors focus-visible:ring-4 focus-visible:outline-none"
              >
                {example}
              </button>
            ))}
          </div>
        )}
        <label htmlFor="agent-question" className="sr-only">
          {copy.agent_panel.placeholder}
        </label>
        <div className="border-input bg-background focus-within:ring-primary/20 flex items-end gap-2 rounded-xl border p-2 focus-within:ring-4">
          <textarea
            id="agent-question"
            rows={2}
            value={question}
            disabled={busy}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void startTurn(question);
              }
            }}
            placeholder={copy.agent_panel.placeholder}
            className="placeholder:text-muted-foreground/80 min-h-12 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none disabled:cursor-not-allowed"
          />
          <button
            type={busy ? 'button' : 'submit'}
            onClick={busy ? () => abortRef.current?.abort() : undefined}
            disabled={!busy && !question.trim()}
            aria-label={busy ? copy.agent_panel.stop : copy.agent_panel.send}
            className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? (
              <span className="size-3 rounded-sm bg-current" />
            ) : (
              <ArrowUp className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </form>
    </aside>
  );
}

function AgentWelcome({ copy }: { copy: WorkspaceCopy }) {
  return (
    <p className="text-muted-foreground max-w-[62ch] text-sm leading-relaxed">
      {copy.agent_panel.description}
    </p>
  );
}

function QualityMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/45 rounded-lg px-3 py-2.5">
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function patchLabel(
  patch: (
    | SimulationComparison
    | ScenarioComparison
    | RelocationCandidateComparison
  )['patch'],
  context: ReturnType<typeof buildAgentContext>,
  locale: string
): string {
  const zh = locale.startsWith('zh');
  if (patch.type === 'city-relocation-candidate') {
    return zh
      ? `${patch.fromCity} → ${patch.toCity}：采用 ${patch.sourceLabel} 候选试算`
      : `${patch.fromCity} → ${patch.toCity}: simulate ${patch.sourceLabel}`;
  }
  if (patch.type === 'scenario') {
    return patch.patches
      .map((item) => patchLabel(item, context, locale))
      .join(zh ? '；' : '; ');
  }
  if (patch.type === 'change-retirement-month') {
    return `${zh ? '退休时间' : 'Retirement month'} → ${formatMonth(patch.retirementMonth)}`;
  }
  if (patch.type === 'shift-purchase') {
    const purchase = context.assets.find(
      (item) => item.id === patch.purchaseId
    );
    return `${purchase?.name ?? patch.purchaseId}: ${patch.monthDelta > 0 ? '+' : ''}${patch.monthDelta} ${zh ? '个月' : 'months'}`;
  }
  if (patch.type === 'remove-purchase') {
    const purchase = context.assets.find(
      (item) => item.id === patch.purchaseId
    );
    return `${zh ? '移除' : 'Remove'} ${purchase?.name ?? patch.purchaseId}`;
  }
  if (patch.type === 'shift-relocation') {
    const relocation = context.relocations.find(
      (item) => item.id === patch.relocationId
    );
    return `${relocation?.targetCity ?? patch.relocationId}: ${patch.monthDelta > 0 ? '+' : ''}${patch.monthDelta} ${zh ? '个月' : 'months'}`;
  }
  if (patch.type === 'remove-relocation') {
    const relocation = context.relocations.find(
      (item) => item.id === patch.relocationId
    );
    return `${zh ? '移除迁居' : 'Remove relocation'}: ${relocation?.targetCity ?? patch.relocationId}`;
  }
  const id =
    patch.type === 'change-liquid-opening-balance'
      ? patch.assetId
      : patch.cashFlowId;
  const label = context.editableTargets.find(
    (target) => target.id === id
  )?.label;
  if (patch.type === 'shift-cash-flow') {
    return `${label ?? id}: ${patch.monthDelta > 0 ? '+' : ''}${patch.monthDelta} ${zh ? '个月' : 'months'}`;
  }
  const amount =
    patch.type === 'change-cash-flow-amount'
      ? patch.amountCents
      : patch.openingBalanceCents;
  return `${label ?? id}: ${new Intl.NumberFormat(locale).format(amount / 100)}`;
}

function createShortTermState(planHash: string): AgentShortTermState {
  return {
    version: '1.0.0',
    planHash,
    activeIntent: null,
    referencedEntity: null,
    referencedYear: null,
    pendingCityCandidate: null,
    lastToolFingerprints: [],
    workingMemory: null,
    updatedAt: new Date().toISOString(),
  };
}
