import type { AgentTurnRequest } from './agent-types';

const DEFAULT_AUTONOMOUS_STEP_DEADLINE_MS = 5_500;

type FetchAgentTurnOptions = {
  fetchImpl?: typeof fetch;
  softDeadlineMs?: number;
};

/**
 * Gives an autonomous server step a bounded chance to finish, then retries
 * the same read-only planning request locally. The API only proposes actions;
 * tools and plan writes happen after the client receives and validates a
 * response, so this retry cannot duplicate a business write.
 */
export async function fetchAgentTurn(
  input: AgentTurnRequest,
  turnSignal: AbortSignal,
  options: FetchAgentTurnOptions = {}
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const softDeadlineMs =
    options.softDeadlineMs ?? DEFAULT_AUTONOMOUS_STEP_DEADLINE_MS;
  if (input.expressionMode !== 'autonomous') {
    return {
      response: await postTurn(input, turnSignal, fetchImpl),
      usedLocalRescue: false,
    };
  }

  const stepController = new AbortController();
  let softTimedOut = false;
  const abortStep = () => stepController.abort(turnSignal.reason);
  if (turnSignal.aborted) abortStep();
  else turnSignal.addEventListener('abort', abortStep, { once: true });
  const timer = setTimeout(() => {
    softTimedOut = true;
    stepController.abort('autonomous-step-deadline');
  }, softDeadlineMs);

  try {
    const response = await postTurn(input, stepController.signal, fetchImpl);
    return { response, usedLocalRescue: false };
  } catch (error) {
    if (!softTimedOut || turnSignal.aborted) throw error;
    const response = await postTurn(
      { ...input, expressionMode: 'strict' },
      turnSignal,
      fetchImpl
    );
    return { response, usedLocalRescue: true };
  } finally {
    clearTimeout(timer);
    turnSignal.removeEventListener('abort', abortStep);
  }
}

export async function warmAgentRoute(fetchImpl: typeof fetch = fetch) {
  try {
    await fetchImpl('/api/life-ledger/assistant', {
      method: 'GET',
      cache: 'no-store',
    });
  } catch {
    // Warm-up is opportunistic. A real turn still owns error reporting.
  }
}

function postTurn(
  input: AgentTurnRequest,
  signal: AbortSignal,
  fetchImpl: typeof fetch
) {
  return fetchImpl('/api/life-ledger/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
}
