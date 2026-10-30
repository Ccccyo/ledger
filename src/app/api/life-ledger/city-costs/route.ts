import { NextResponse } from 'next/server';
import { lookupCityCostsViaMcp } from '@/features/life-ledger/server/city-cost-mcp';
import { parseCityCostLookupInput } from '@/features/life-ledger/workspace/agent/city-cost-types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const parsed = parseCityCostLookupInput(input);
  if (!parsed) {
    return NextResponse.json(
      { error: 'Invalid city lookup input.' },
      { status: 400 }
    );
  }
  try {
    const candidate = await lookupCityCostsViaMcp(parsed);
    return NextResponse.json({ candidate });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'City lookup unavailable.',
      },
      { status: 503 }
    );
  }
}
