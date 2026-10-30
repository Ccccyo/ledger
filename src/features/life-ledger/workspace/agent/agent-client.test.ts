import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fetchAgentTurn } from './agent-client';
import type { AgentTurnRequest } from './agent-types';

const baseRequest = {
  question: '我想去上海',
  locale: 'zh-CN',
  context: { planHash: 'test-plan' },
  history: [],
  observations: [],
  step: 0,
  expressionMode: 'autonomous',
} as unknown as AgentTurnRequest;

describe('Agent client fallback', () => {
  it('retries an autonomous timeout in explicit local mode', async () => {
    const modes: Array<AgentTurnRequest['expressionMode']> = [];
    const fetchImpl = (async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as AgentTurnRequest;
      modes.push(request.expressionMode);
      if (request.expressionMode === 'autonomous') {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        });
      }
      return Response.json({ decision: { type: 'clarify' } });
    }) as typeof fetch;

    const result = await fetchAgentTurn(
      baseRequest,
      new AbortController().signal,
      { fetchImpl, softDeadlineMs: 5 }
    );

    assert.equal(result.usedLocalRescue, true);
    assert.equal(result.response.status, 200);
    assert.deepEqual(modes, ['autonomous', 'strict']);
  });

  it('does not retry after the whole turn is cancelled', async () => {
    const turnController = new AbortController();
    let calls = 0;
    const fetchImpl = (async (_url, init) => {
      calls += 1;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        );
      });
    }) as typeof fetch;
    const pending = fetchAgentTurn(baseRequest, turnController.signal, {
      fetchImpl,
      softDeadlineMs: 50,
    });
    turnController.abort();

    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(calls, 1);
  });
});
