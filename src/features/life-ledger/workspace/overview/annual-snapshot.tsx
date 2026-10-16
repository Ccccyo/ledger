'use client';

import { useMemo, useState } from 'react';
import {
  buildAnnualSnapshots,
  selectInitialSnapshotYear,
  type AnnualFlowCategory,
  type AnnualFlowNode,
  type AnnualFlowNodeTone,
} from '@/features/life-ledger/analysis/annual-snapshot';
import type { MonthlyCalculationResult } from '@/features/life-ledger/calculation';
import type { LifePlan } from '@/features/life-ledger/domain';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ResponsiveContainer, Sankey } from 'recharts';

import { cn } from '@/shared/lib/utils';

import { moneyFormatter } from '../plan/fields';
import type { WorkspaceCopy } from '../workspace-types';
import { PlanCharts } from './plan-charts';

type SnapshotMode = 'snapshot' | 'trend';

type FlowNodePayload = AnnualFlowNode & {
  name: string;
  value: number;
};

type FlowNodeProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  payload: FlowNodePayload;
};

type FlowLinkProps = {
  sourceX: number;
  sourceY: number;
  sourceControlX: number;
  targetX: number;
  targetY: number;
  targetControlX: number;
  linkWidth: number;
  payload: {
    source: FlowNodePayload;
    target: FlowNodePayload;
  };
};

const toneColors: Record<AnnualFlowNodeTone, string> = {
  income: '#4f846b',
  neutral: '#7d8780',
  expense: '#b56f54',
  risk: '#b7791f',
  surplus: '#6677ad',
};

export function AnnualSnapshotExplorer({
  result,
  copy,
  locale,
  plan,
  condensed = false,
  initialMode = 'snapshot',
}: {
  result: MonthlyCalculationResult;
  copy: WorkspaceCopy;
  locale: string;
  plan?: LifePlan;
  condensed?: boolean;
  initialMode?: SnapshotMode;
}) {
  const snapshots = useMemo(() => buildAnnualSnapshots(result), [result]);
  const initialYear = selectInitialSnapshotYear(result);
  const [mode, setMode] = useState<SnapshotMode>(initialMode);
  const [selectedYear, setSelectedYear] = useState(
    initialYear ?? snapshots[0]?.year ?? 0
  );
  const selectedIndex = Math.max(
    0,
    snapshots.findIndex((snapshot) => snapshot.year === selectedYear)
  );
  const snapshot = snapshots[selectedIndex];
  const money = moneyFormatter(locale);
  const compact = compactMoneyFormatter(locale);

  if (!snapshot) return null;

  const selectIndex = (index: number) => {
    const next = snapshots[Math.max(0, Math.min(snapshots.length - 1, index))];
    if (next) setSelectedYear(next.year);
  };
  const age = formatAge(snapshot.ageStart, snapshot.ageEnd, locale, copy);
  const phase =
    snapshot.phase === 'transition'
      ? copy.ledger.transition
      : snapshot.phase === 'retired'
        ? copy.ledger.retired
        : copy.ledger.working;
  const metrics = [
    {
      label: copy.annual_snapshot.metrics.income,
      value: money(snapshot.incomeCents),
    },
    {
      label: copy.annual_snapshot.metrics.expense,
      value: money(snapshot.expenseCents),
    },
    {
      label: copy.annual_snapshot.metrics.available,
      value: money(snapshot.closingAvailableCents),
      detail: formatDelta(
        snapshot.annualAvailableChangeCents,
        money,
        copy.annual_snapshot.change
      ),
      risk: snapshot.closingAvailableCents < 0,
    },
    {
      label: copy.annual_snapshot.metrics.net_worth,
      value: money(snapshot.closingNetWorthCents),
    },
  ];

  return (
    <section
      className="border-border bg-background overflow-hidden rounded-xl border"
      aria-labelledby="annual-snapshot-title"
    >
      <div className="border-border flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <h2 id="annual-snapshot-title" className="text-lg font-semibold">
          {copy.annual_snapshot.title}
        </h2>
        <div
          className="bg-muted grid shrink-0 grid-cols-2 rounded-lg p-1"
          role="group"
          aria-label={copy.annual_snapshot.view_label}
        >
          {(['snapshot', 'trend'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                'focus-visible:ring-primary/30 min-h-10 rounded-md px-3 text-sm transition-colors focus-visible:ring-4 focus-visible:outline-none',
                mode === value
                  ? 'bg-background text-foreground font-medium shadow-sm'
                  : 'text-foreground hover:bg-background/60'
              )}
            >
              {copy.annual_snapshot[value]}
            </button>
          ))}
        </div>
      </div>

      {mode === 'trend' ? (
        <div className="bg-muted/20 p-4 sm:p-5">
          <PlanCharts result={result} copy={copy} locale={locale} />
        </div>
      ) : (
        <div>
          <div className="p-4 sm:p-5">
            <div
              className={cn(
                'border-border grid grid-cols-2 border-y',
                !condensed && 'lg:grid-cols-[1.15fr_repeat(4,minmax(0,1fr))]'
              )}
            >
              <div
                className={cn(
                  'border-border col-span-2 flex min-w-0 items-center justify-between gap-3 border-b py-3',
                  !condensed &&
                    'lg:col-span-1 lg:border-r lg:border-b-0 lg:pr-4'
                )}
              >
                <div className="min-w-0">
                  <p className="text-muted-foreground truncate text-[11px] font-medium">
                    {phase}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <h3 className="text-2xl font-semibold tracking-tight tabular-nums">
                      {snapshot.year}
                      <span className="ml-1 text-sm font-medium tracking-normal">
                        {copy.annual_snapshot.year_suffix}
                      </span>
                    </h3>
                    <span className="text-muted-foreground text-xs">{age}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => selectIndex(selectedIndex - 1)}
                    disabled={selectedIndex === 0}
                    aria-label={copy.annual_snapshot.previous_year}
                    className="border-border hover:bg-muted focus-visible:ring-primary/30 flex size-10 items-center justify-center rounded-lg border focus-visible:ring-4 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronLeft className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => selectIndex(selectedIndex + 1)}
                    disabled={selectedIndex === snapshots.length - 1}
                    aria-label={copy.annual_snapshot.next_year}
                    className="border-border hover:bg-muted focus-visible:ring-primary/30 flex size-10 items-center justify-center rounded-lg border focus-visible:ring-4 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {metrics.map((metric, index) => (
                <dl
                  key={metric.label}
                  className={cn(
                    'min-w-0 py-3',
                    index % 2 === 0 ? 'pr-3' : 'border-border border-l pl-3',
                    index >= 2 && 'border-border border-t lg:border-t-0',
                    !condensed && 'lg:border-l lg:px-4'
                  )}
                >
                  <dt className="text-muted-foreground truncate text-[11px]">
                    {metric.label}
                  </dt>
                  <dd
                    className={cn(
                      'mt-1 truncate text-sm font-semibold tabular-nums sm:text-base',
                      metric.risk && 'text-amber-800 dark:text-amber-300'
                    )}
                    title={metric.value}
                  >
                    {metric.value}
                  </dd>
                  {metric.detail && (
                    <dd className="text-muted-foreground mt-0.5 truncate text-[10px] tabular-nums">
                      {metric.detail}
                    </dd>
                  )}
                </dl>
              ))}
            </div>

            <div className="mt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <label
                  htmlFor="annual-snapshot-year"
                  className="text-xs font-medium"
                >
                  {plan
                    ? copy.annual_snapshot.timeline_label
                    : copy.annual_snapshot.slider_label}
                </label>
                {plan && (
                  <span className="text-muted-foreground text-[11px]">
                    {copy.annual_snapshot.timeline_hint}
                  </span>
                )}
              </div>
              <input
                id="annual-snapshot-year"
                type="range"
                min={0}
                max={Math.max(0, snapshots.length - 1)}
                step={1}
                value={selectedIndex}
                disabled={snapshots.length <= 1}
                onChange={(event) => selectIndex(Number(event.target.value))}
                className="accent-primary mt-2 h-2 w-full cursor-pointer disabled:cursor-not-allowed"
              />
              <div className="text-muted-foreground mt-1.5 flex justify-between text-[11px] tabular-nums">
                <span>{formatEndpoint(snapshots[0], locale, copy)}</span>
                <span>{formatEndpoint(snapshots.at(-1)!, locale, copy)}</span>
              </div>
              <p className="sr-only" aria-live="polite">
                {copy.annual_snapshot.live_status
                  .replace('{year}', String(snapshot.year))
                  .replace('{age}', age)}
              </p>
            </div>
          </div>

          <div className="border-border bg-muted/20 border-t p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="font-semibold">
                  {copy.annual_snapshot.flow_title}
                </h3>
                <p className="text-muted-foreground mt-1 max-w-[64ch] text-xs leading-relaxed">
                  {copy.annual_snapshot.flow_hint}
                </p>
              </div>
              {snapshot.flow.sourceTotalCents > 0 && (
                <p className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {copy.annual_snapshot.flow_total.replace(
                    '{amount}',
                    compact(snapshot.flow.sourceTotalCents)
                  )}
                </p>
              )}
            </div>

            {snapshot.flow.sourceTotalCents === 0 ? (
              <p className="text-muted-foreground border-border mt-5 border-y py-10 text-center text-sm">
                {copy.annual_snapshot.empty_flow}
              </p>
            ) : (
              <AnnualFlowChart
                nodes={snapshot.flow.nodes}
                links={snapshot.flow.links}
                copy={copy}
                money={compact}
                condensed={condensed}
              />
            )}

            <FlowTable nodes={snapshot.flow.nodes} copy={copy} money={money} />
          </div>
        </div>
      )}
    </section>
  );
}

function AnnualFlowChart({
  nodes,
  links,
  copy,
  money,
  condensed,
}: {
  nodes: AnnualFlowNode[];
  links: { source: string; target: string; amountCents: number }[];
  copy: WorkspaceCopy;
  money: (amountCents: number) => string;
  condensed: boolean;
}) {
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const data = {
    nodes: nodes.map((node) => ({
      ...node,
      name: flowLabel(node.category, copy),
      value: node.amountCents,
    })),
    links: links.map((link) => ({
      source: indexById.get(link.source)!,
      target: indexById.get(link.target)!,
      value: link.amountCents,
    })),
  };
  const sourceNodes = nodes.filter((node) => node.side === 'source');
  const useNodes = nodes.filter((node) => node.side === 'use');
  const total =
    nodes.find((node) => node.side === 'center')?.amountCents ??
    sourceNodes.reduce((sum, node) => sum + node.amountCents, 0);

  return (
    <>
      <div className="mt-5 grid grid-cols-2 sm:hidden" aria-hidden="true">
        <MobileFlowColumn
          label={copy.annual_snapshot.source}
          nodes={sourceNodes}
          total={total}
          copy={copy}
          money={money}
        />
        <MobileFlowColumn
          label={copy.annual_snapshot.use}
          nodes={useNodes}
          total={total}
          copy={copy}
          money={money}
          trailing
        />
      </div>
      <div className="mt-2 hidden max-w-full overflow-x-auto sm:block">
        <div
          className={cn('h-64', !condensed && 'min-w-[760px]')}
          aria-hidden="true"
        >
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              key={nodes.map((node) => node.id).join('|')}
              data={data}
              nameKey="name"
              dataKey="value"
              nodePadding={12}
              nodeWidth={10}
              linkCurvature={0.55}
              iterations={48}
              sort
              margin={
                condensed
                  ? { top: 28, right: 96, bottom: 8, left: 96 }
                  : { top: 28, right: 170, bottom: 8, left: 170 }
              }
              node={(props: unknown) => (
                <FlowNode {...(props as FlowNodeProps)} money={money} />
              )}
              link={(props: unknown) => (
                <FlowLink {...(props as FlowLinkProps)} />
              )}
            />
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

function MobileFlowColumn({
  label,
  nodes,
  total,
  copy,
  money,
  trailing = false,
}: {
  label: string;
  nodes: AnnualFlowNode[];
  total: number;
  copy: WorkspaceCopy;
  money: (amountCents: number) => string;
  trailing?: boolean;
}) {
  return (
    <div
      className={cn('min-w-0 py-1', trailing && 'border-border border-l pl-4')}
    >
      <p className="text-muted-foreground text-[11px] font-medium">{label}</p>
      <div className="mt-3 space-y-4">
        {nodes.map((node) => (
          <div key={node.id} className={trailing ? undefined : 'pr-4'}>
            <p className="truncate text-xs font-medium">
              {flowLabel(node.category, copy)}
            </p>
            <p className="text-muted-foreground mt-0.5 text-[11px] tabular-nums">
              {money(node.amountCents)}
            </p>
            <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
              <span
                className="block h-full min-w-px rounded-full"
                style={{
                  width: `${total > 0 ? Math.max(1, (node.amountCents / total) * 100) : 0}%`,
                  backgroundColor: toneColors[node.tone],
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowNode({
  x,
  y,
  width,
  height,
  payload,
  money,
}: FlowNodeProps & { money: (amountCents: number) => string }) {
  const color = toneColors[payload.tone];
  const isSource = payload.side === 'source';
  const isCenter = payload.side === 'center';
  const labelX = isCenter ? x + width / 2 : isSource ? x - 10 : x + width + 10;
  const labelY = isCenter ? Math.max(18, y - 12) : y + height / 2 - 7;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={Math.max(height, 2)}
        rx={3}
        fill={color}
      />
      <text
        x={labelX}
        y={labelY}
        textAnchor={isCenter ? 'middle' : isSource ? 'end' : 'start'}
        fill="var(--foreground)"
        fontSize={11}
      >
        <tspan x={labelX} fontWeight={600}>
          {payload.name}
        </tspan>
        <tspan
          x={labelX}
          dy={16}
          fill="var(--muted-foreground)"
          fontVariant="tabular-nums"
        >
          {money(payload.amountCents)}
        </tspan>
      </text>
    </g>
  );
}

function FlowLink({
  sourceX,
  sourceY,
  sourceControlX,
  targetX,
  targetY,
  targetControlX,
  linkWidth,
  payload,
}: FlowLinkProps) {
  const tone =
    payload.target.side === 'center'
      ? payload.source.tone
      : payload.target.tone;
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={toneColors[tone]}
      strokeWidth={Math.max(1, linkWidth)}
      strokeOpacity={0.28}
    />
  );
}

function FlowTable({
  nodes,
  copy,
  money,
}: {
  nodes: AnnualFlowNode[];
  copy: WorkspaceCopy;
  money: (amountCents: number) => string;
}) {
  const rows = nodes.filter((node) => node.side !== 'center');
  return (
    <details className="border-border mt-4 border-t pt-3 text-sm">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer focus-visible:outline-none">
        {copy.annual_snapshot.table_alternative}
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">
            {copy.annual_snapshot.table_alternative}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="p-2 font-medium">
                {copy.annual_snapshot.direction}
              </th>
              <th scope="col" className="p-2 font-medium">
                {copy.annual_snapshot.category}
              </th>
              <th scope="col" className="p-2 text-right font-medium">
                {copy.annual_snapshot.amount}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((node) => (
              <tr key={node.id} className="border-border border-t">
                <td className="p-2">
                  {node.side === 'source'
                    ? copy.annual_snapshot.source
                    : copy.annual_snapshot.use}
                </td>
                <th scope="row" className="p-2 font-normal">
                  {flowLabel(node.category, copy)}
                </th>
                <td className="p-2 text-right tabular-nums">
                  {money(node.amountCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function flowLabel(category: AnnualFlowCategory, copy: WorkspaceCopy) {
  return (
    copy.annual_snapshot.flow_categories[category] ??
    copy.categories[category] ??
    category
  );
}

function formatAge(
  ageStart: number | null,
  ageEnd: number | null,
  locale: string,
  copy: WorkspaceCopy
) {
  if (ageStart === null && ageEnd === null)
    return copy.annual_snapshot.age_unknown;
  const start = ageStart ?? ageEnd!;
  const end = ageEnd ?? ageStart!;
  if (start === end)
    return locale.startsWith('zh')
      ? `${start} ${copy.common.age}`
      : `${copy.common.age} ${start}`;
  return locale.startsWith('zh')
    ? `${start}–${end} ${copy.common.age}`
    : `${copy.common.age} ${start}–${end}`;
}

function formatEndpoint(
  snapshot: { year: number; ageEnd: number | null },
  locale: string,
  copy: WorkspaceCopy
) {
  if (snapshot.ageEnd === null) return String(snapshot.year);
  return locale.startsWith('zh')
    ? `${snapshot.ageEnd} ${copy.common.age}`
    : `${copy.common.age} ${snapshot.ageEnd}`;
}

function formatDelta(
  cents: number,
  money: (amountCents: number) => string,
  template: string
) {
  const formatted = `${cents > 0 ? '+' : ''}${money(cents)}`;
  return template.replace('{amount}', formatted);
}

function compactMoneyFormatter(locale: string) {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return (cents: number) => {
    const yuan = cents / 100;
    if (locale.startsWith('zh'))
      return `${formatter.format(yuan / 10_000)} 万元`;
    if (Math.abs(yuan) >= 1_000_000)
      return `${formatter.format(yuan / 1_000_000)}m CNY`;
    if (Math.abs(yuan) >= 1_000)
      return `${formatter.format(yuan / 1_000)}k CNY`;
    return `${formatter.format(yuan)} CNY`;
  };
}
