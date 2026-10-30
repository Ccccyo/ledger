import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import {
  isCityCostCandidate,
  parseCityCostLookupInput,
  type CityCostCandidate,
  type CityCostLookupInput,
} from '../workspace/agent/city-cost-types';
import { lookupDemoCityCosts } from './city-cost-provider';

const inputSchema = {
  fromCity: z.string().trim().min(2).max(40),
  toCity: z.string().trim().min(2).max(40),
  householdSize: z.number().int().min(1).max(8),
  housingMode: z.enum(['rent', 'own', 'unknown']),
};

const outputSchema = {
  kind: z.literal('city-cost-candidate'),
  fromCity: z.string(),
  toCity: z.string(),
  householdSize: z.number().int(),
  housingMode: z.enum(['rent', 'own', 'unknown']),
  currency: z.literal('CNY'),
  housingMonthlyChangeCents: z.number().int(),
  livingMonthlyChangeCents: z.number().int(),
  movingExpenseCandidateCents: z.number().int(),
  ranges: z.object({
    housingMonthlyChangeCents: z.tuple([z.number().int(), z.number().int()]),
    livingMonthlyChangeCents: z.tuple([z.number().int(), z.number().int()]),
    movingExpenseCents: z.tuple([z.number().int(), z.number().int()]),
  }),
  source: z.object({
    provider: z.string(),
    mode: z.enum(['demo', 'remote-mcp']),
    datasetVersion: z.string(),
    observedAt: z.string(),
    retrievedAt: z.string(),
    referenceUrl: z.string().nullable(),
    disclaimer: z.string(),
  }),
};

export function createCityCostMcpServer() {
  const server = new McpServer(
    { name: 'life-ledger-city-costs', version: '1.0.0' },
    {
      instructions:
        'Read-only city cost candidates. Results never authorize a plan write.',
    }
  );
  server.registerTool(
    'lookup_city_costs',
    {
      description:
        'Return a sourced city-cost candidate. The result is read-only and must be confirmed before entering a formal plan.',
      inputSchema,
      outputSchema,
    },
    async (rawInput) => {
      const input = parseCityCostLookupInput(rawInput);
      if (!input) {
        return {
          content: [{ type: 'text' as const, text: 'Invalid city lookup.' }],
          isError: true,
        };
      }
      try {
        const candidate = lookupDemoCityCosts(input);
        return {
          content: [
            {
              type: 'text' as const,
              text: `${candidate.fromCity} → ${candidate.toCity} demo candidate`,
            },
          ],
          structuredContent: candidate,
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: error instanceof Error ? error.message : 'Lookup failed.',
            },
          ],
          isError: true,
        };
      }
    }
  );
  return server;
}

const inProcessHandler = createMcpHandler(createCityCostMcpServer);

async function callOnce(
  input: CityCostLookupInput,
  url: URL,
  inProcess: boolean
): Promise<CityCostCandidate> {
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: inProcess
      ? (requestUrl, init) =>
          inProcessHandler.fetch(new Request(requestUrl, init))
      : undefined,
  });
  const client = new Client(
    { name: 'life-ledger-agent', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } }
  );
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'lookup_city_costs',
      arguments: { ...input },
    });
    if (result.isError) {
      const message = result.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join(' ');
      throw new Error(message || 'City MCP returned an error.');
    }
    if (!isCityCostCandidate(result.structuredContent)) {
      throw new Error('City MCP returned an invalid result.');
    }
    return {
      ...result.structuredContent,
      source: {
        ...result.structuredContent.source,
        mode: inProcess ? 'demo' : 'remote-mcp',
      },
    };
  } finally {
    await client.close().catch(() => {});
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('City MCP timed out.')),
      timeoutMs
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function lookupCityCostsViaMcp(
  rawInput: unknown,
  options: { timeoutMs?: number; endpoint?: string | null } = {}
): Promise<CityCostCandidate> {
  const input = parseCityCostLookupInput(rawInput);
  if (!input) throw new Error('Invalid city lookup input.');
  const endpoint = options.endpoint ?? process.env.CITY_DATA_MCP_URL ?? null;
  const inProcess = !endpoint;
  const url = new URL(endpoint ?? 'http://life-ledger.local/mcp');
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 2_500, 500), 10_000);
  const attempts = inProcess ? 1 : 2;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await withTimeout(callOnce(input, url, inProcess), timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('City MCP lookup failed.');
}
