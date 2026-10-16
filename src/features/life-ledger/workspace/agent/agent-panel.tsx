'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronRight,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
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
  type SimulationComparison,
} from '../../analysis/simulate-action';
import type { MonthlyCalculationResult } from '../../calculation';
import { formatMonth } from '../../domain';
import { moneyFormatter } from '../plan/fields';
import { useWorkspace } from '../workspace-provider';
import type { WorkspaceCopy } from '../workspace-types';
import { buildAgentContext, runReadOnlyAgentTool } from './agent-context';
import type {
  AgentDecision,
  AgentHistoryMessage,
  AgentObservation,
  AgentTurnRequest,
} from './agent-types';

const MAX_STEPS = 5;
const ENHANCED_SESSION_KEY = 'life-ledger:agent-enhanced-session';

type EnhancementScope = 'off' | 'once' | 'session';

interface ConversationMessage extends AgentHistoryMessage {
  id: string;
  evidence?: string[];
  caveats?: string[];
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
  const [showConsent, setShowConsent] = useState(false);
  const [enhancementScope, setEnhancementScope] =
    useState<EnhancementScope>('off');
  const [proposal, setProposal] = useState<SimulationComparison | null>(null);
  const messagesRef = useRef<ConversationMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    if (sessionStorage.getItem(ENHANCED_SESSION_KEY) === 'yes') {
      setEnhancementScope('session');
    }
  }, []);
  const context = useMemo(() => buildAgentContext(result), [result]);
  const proposalStale = Boolean(
    proposal &&
      (state.externalConflict ||
        state.result?.inputHash !== proposal.baselineHash ||
        state.calculationStatus !== 'idle')
  );

  function updateMessages(
    updater: (current: ConversationMessage[]) => ConversationMessage[]
  ) {
    const next = updater(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
  }

  async function startTurn(value: string) {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    const expressionMode = enhancementScope === 'off' ? 'strict' : 'enhanced';
    if (enhancementScope === 'once') {
      setEnhancementScope('off');
    }
    await runTurn(trimmed, expressionMode);
  }

  async function runTurn(value: string, expressionMode: 'strict' | 'enhanced') {
    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: value,
    };
    const priorHistory = messagesRef.current
      .slice(-6)
      .map(({ role, content }) => ({
        role,
        content,
      }));
    updateMessages((current) => [...current, userMessage]);
    setQuestion('');
    setError('');
    setProposal(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const observations: AgentObservation[] = [];
    const seenCalls = new Set<string>();

    try {
      for (let step = 0; step < MAX_STEPS; step += 1) {
        const request: AgentTurnRequest = {
          question: value,
          locale,
          context,
          history: priorHistory,
          observations,
          step,
          expressionMode,
        };
        const response = await fetch('/api/life-ledger/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(copy.agent_panel.errors.request);
        const payload = (await response.json()) as {
          decision?: AgentDecision;
          enhancement?: 'applied' | 'unavailable' | 'not-requested';
        };
        if (!payload.decision)
          throw new Error(copy.agent_panel.errors.response);
        const decision = payload.decision;

        if (decision.type === 'answer') {
          updateMessages((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: decision.answer,
              evidence: decision.evidence,
              caveats:
                expressionMode === 'enhanced' &&
                payload.enhancement === 'unavailable'
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
          updateMessages((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: decision.question,
            },
          ]);
          return;
        }

        setRunningReason(decision.reason);
        const callKey = JSON.stringify(decision.tool);
        if (seenCalls.has(callKey)) {
          observations.push({
            tool: decision.tool.name,
            ok: false,
            error: 'Guardrail stopped a repeated tool call.',
          });
          continue;
        }
        seenCalls.add(callKey);

        if (decision.tool.name !== 'simulate_patch') {
          observations.push(runReadOnlyAgentTool(result, decision.tool));
          continue;
        }

        try {
          const comparison = simulateAction(
            result.input,
            result,
            decision.tool.arguments.patch
          );
          setProposal(comparison);
          updateMessages((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: copy.agent_panel.proposal_intro,
              evidence: [decision.reason],
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
        }
      }
      throw new Error(copy.agent_panel.errors.step_limit);
    } catch (turnError) {
      if ((turnError as Error).name !== 'AbortError') {
        setError(
          turnError instanceof Error
            ? turnError.message
            : copy.agent_panel.errors.request
        );
      }
    } finally {
      setBusy(false);
      setRunningReason('');
      abortRef.current = null;
    }
  }

  const gap = (month: number | null) =>
    month === null ? copy.agent_panel.no_gap : formatMonth(month as never);

  return (
    <aside
      className="border-primary/30 bg-background overflow-hidden rounded-xl border shadow-[0_18px_50px_-24px_rgba(15,118,78,0.38)] xl:sticky xl:top-32 xl:max-h-[calc(100dvh-9rem)]"
      aria-labelledby="agent-panel-title"
    >
      <header className="border-border flex items-start justify-between gap-3 border-b p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="agent-panel-title" className="font-semibold">
              {copy.agent_panel.title}
            </h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {copy.agent_panel.subtitle}
            </p>
          </div>
        </div>
        <span className="border-primary/25 bg-primary/5 text-primary shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium">
          {copy.agent_panel.status}
        </span>
      </header>

      <div
        className="xl:max-h-[calc(100dvh-22rem)] xl:overflow-y-auto"
        aria-live="polite"
      >
        <div className="space-y-4 p-4 sm:p-5">
          {messages.length === 0 ? (
            <AgentWelcome copy={copy} result={result} money={money} />
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
                    updateMessages((current) => [
                      ...current,
                      {
                        id: crypto.randomUUID(),
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
                  onClick={() => setProposal(null)}
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

          {messages.length > 0 && !busy && (
            <button
              type="button"
              onClick={() => {
                updateMessages(() => []);
                setProposal(null);
                setError('');
              }}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs"
            >
              <RotateCcw className="size-3" />
              {copy.agent_panel.new_conversation}
            </button>
          )}
        </div>
      </div>

      <Dialog open={showConsent} onOpenChange={setShowConsent}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-md">
          <DialogHeader className="pr-7 text-left">
            <span className="bg-primary/10 text-primary mb-1 flex size-9 items-center justify-center rounded-lg">
              <ShieldCheck className="size-4" aria-hidden="true" />
            </span>
            <DialogTitle>{copy.agent_panel.consent_title}</DialogTitle>
            <DialogDescription className="leading-relaxed">
              {copy.agent_panel.consent_description}
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
                <dd className="leading-relaxed">{value}</dd>
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
                sessionStorage.removeItem(ENHANCED_SESSION_KEY);
                setEnhancementScope('once');
                setShowConsent(false);
              }}
              className="border-primary/35 text-primary hover:bg-primary/5 min-h-10 rounded-lg border px-3 text-xs font-medium"
            >
              {copy.agent_panel.consent_once}
            </button>
            <button
              type="button"
              onClick={() => {
                sessionStorage.setItem(ENHANCED_SESSION_KEY, 'yes');
                setEnhancementScope('session');
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
        className="border-border bg-muted/25 border-t p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void startTurn(question);
        }}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            {enhancementScope === 'off' ? (
              <LockKeyhole
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden="true"
              />
            ) : (
              <Sparkles
                className="text-primary size-3.5 shrink-0"
                aria-hidden="true"
              />
            )}
            <span className="truncate font-medium">
              {enhancementScope === 'off'
                ? copy.agent_panel.mode_strict
                : enhancementScope === 'once'
                  ? copy.agent_panel.mode_enhanced_once
                  : copy.agent_panel.mode_enhanced_session}
            </span>
          </div>
          {enhancementScope === 'off' ? (
            <button
              type="button"
              onClick={() => setShowConsent(true)}
              className="text-primary hover:text-primary/80 shrink-0 text-xs font-medium"
            >
              {copy.agent_panel.enable_enhancement}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem(ENHANCED_SESSION_KEY);
                setEnhancementScope('off');
              }}
              className="text-muted-foreground hover:text-foreground shrink-0 text-xs"
            >
              {copy.agent_panel.disable_enhancement}
            </button>
          )}
        </div>
        {messages.length === 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {examples.slice(0, 2).map((example) => (
              <button
                type="button"
                key={example}
                onClick={() => void startTurn(example)}
                className="border-border bg-background hover:border-primary/40 rounded-full border px-3 py-1.5 text-left text-[11px]"
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
        <p className="text-muted-foreground mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed">
          <LockKeyhole className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          {enhancementScope === 'off'
            ? copy.agent_panel.privacy_strict
            : copy.agent_panel.privacy_enhanced}
        </p>
      </form>
    </aside>
  );
}

function AgentWelcome({
  copy,
  result,
  money,
}: {
  copy: WorkspaceCopy;
  result: MonthlyCalculationResult;
  money: (cents: number) => string;
}) {
  return (
    <>
      <div className="bg-muted/55 rounded-xl p-4">
        <p className="text-sm leading-relaxed">
          {copy.agent_panel.description}
        </p>
        <dl className="border-border mt-4 grid grid-cols-2 gap-3 border-t pt-4">
          <div>
            <dt className="text-muted-foreground text-[11px]">
              {copy.agent_panel.ending}
            </dt>
            <dd className="mt-1 truncate text-sm font-semibold tabular-nums">
              {money(result.summary.endingAvailableCents)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-[11px]">
              {copy.agent_panel.first_gap}
            </dt>
            <dd className="mt-1 text-sm font-semibold">
              {result.summary.firstGapMonth
                ? copy.agent_panel.has_gap
                : copy.agent_panel.no_gap}
            </dd>
          </div>
        </dl>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
        {copy.agent_panel.capabilities.map((item: string) => (
          <div
            key={item}
            className="border-border bg-background rounded-lg border px-2 py-2 leading-tight"
          >
            {item}
          </div>
        ))}
      </div>
    </>
  );
}

function patchLabel(
  patch: SimulationComparison['patch'],
  context: ReturnType<typeof buildAgentContext>,
  locale: string
) {
  const zh = locale.startsWith('zh');
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
