import type { AnnualLedgerRow, MonthlyCalculationResult } from '../calculation';
import { monthParts, type CashFlowCategory } from '../domain';

export type AnnualFlowNodeSide = 'source' | 'center' | 'use';
export type AnnualFlowNodeTone =
  | 'income'
  | 'neutral'
  | 'expense'
  | 'risk'
  | 'surplus';

export type AnnualFlowCategory =
  | CashFlowCategory
  | 'liquid-return'
  | 'liquid-loss'
  | 'investment-allocation'
  | 'investment-release'
  | 'investment-carried-in'
  | 'investment-held'
  | 'opening-drawdown'
  | 'new-gap'
  | 'annual-surplus'
  | 'available-funds'
  | 'other-income'
  | 'other-expense'
  | 'unallocated-income'
  | 'unallocated-expense';

export interface AnnualFlowNode {
  id: string;
  side: AnnualFlowNodeSide;
  category: AnnualFlowCategory;
  /** Stable copy key. The UI localizes it before rendering. */
  label: string;
  amountCents: number;
  tone: AnnualFlowNodeTone;
}

export interface AnnualFlowLink {
  source: string;
  target: string;
  amountCents: number;
}

export interface AnnualFlowDiagram {
  nodes: AnnualFlowNode[];
  links: AnnualFlowLink[];
  sourceTotalCents: number;
  useTotalCents: number;
}

export interface AnnualSnapshotViewModel {
  year: number;
  ageStart: number | null;
  ageEnd: number | null;
  phase: AnnualLedgerRow['phase'];
  incomeCents: number;
  expenseCents: number;
  liquidReturnCents: number;
  annualAvailableChangeCents: number;
  closingAvailableCents: number;
  closingNetWorthCents: number;
  minimumAvailableCents: number;
  flow: AnnualFlowDiagram;
}

const CENTER_ID = 'center:available-funds';
const DEFAULT_SMALL_CATEGORY_RATIO = 0.03;
const COMPACTABLE_CATEGORIES = new Set<AnnualFlowCategory>([
  'salary',
  'side_income',
  'pension',
  'housing',
  'living',
  'self_travel',
  'self_hobbies',
  'self_learning',
  'self_wellness',
  'self_social',
  'child',
  'parent',
  'retirement',
  'healthcare',
  'tax',
  'other',
  'other-income',
  'other-expense',
  'unallocated-income',
  'unallocated-expense',
]);

type CategoryAmount = {
  category: CashFlowCategory;
  amountCents: number;
};

function positiveCategoryAmounts(
  values: AnnualLedgerRow['incomeByCategory']
): CategoryAmount[] {
  return (Object.entries(values) as [CashFlowCategory, number][])
    .filter(([, amount]) => Number.isSafeInteger(amount) && amount > 0)
    .map(([category, amountCents]) => ({ category, amountCents }))
    .sort(
      (a, b) =>
        b.amountCents - a.amountCents || a.category.localeCompare(b.category)
    );
}

function reconcileCategories(
  values: AnnualLedgerRow['incomeByCategory'],
  declaredTotalCents: number,
  unallocatedCategory: 'unallocated-income' | 'unallocated-expense'
): Array<{ category: AnnualFlowCategory; amountCents: number }> {
  const categories = positiveCategoryAmounts(values);
  const categorized = categories.reduce(
    (sum, item) => sum + item.amountCents,
    0
  );
  if (categorized > declaredTotalCents) {
    throw new Error(
      `Annual flow categories exceed declared total: ${categorized} > ${declaredTotalCents}`
    );
  }
  const remainder = declaredTotalCents - categorized;
  return remainder > 0
    ? [...categories, { category: unallocatedCategory, amountCents: remainder }]
    : categories;
}

function groupSmallCategories(
  items: Array<{
    category: AnnualFlowCategory;
    amountCents: number;
    tone: AnnualFlowNodeTone;
  }>,
  sideTotalCents: number,
  groupedCategory: 'other-income' | 'other-expense',
  groupedTone: 'income' | 'expense',
  smallCategoryRatio: number
): Array<{
  category: AnnualFlowCategory;
  amountCents: number;
  tone: AnnualFlowNodeTone;
}> {
  const threshold = sideTotalCents * smallCategoryRatio;
  const groupedKinds = new Set<AnnualFlowCategory>([
    'salary',
    'side_income',
    'pension',
    'housing',
    'living',
    'child',
    'parent',
    'retirement',
    'healthcare',
    'tax',
    'other',
    'unallocated-income',
    'unallocated-expense',
  ]);
  const small = items.filter(
    (item) =>
      groupedKinds.has(item.category) &&
      item.amountCents > 0 &&
      item.amountCents < threshold
  );
  if (small.length === 0) return items;
  const smallIds = new Set(small.map((item) => item.category));
  return [
    ...items.filter((item) => !smallIds.has(item.category)),
    {
      category: groupedCategory,
      amountCents: small.reduce((sum, item) => sum + item.amountCents, 0),
      tone: groupedTone,
    },
  ];
}

function node(
  side: AnnualFlowNodeSide,
  category: AnnualFlowCategory,
  amountCents: number,
  tone: AnnualFlowNodeTone
): AnnualFlowNode {
  return {
    id: `${side}:${category}`,
    side,
    category,
    label: category,
    amountCents,
    tone,
  };
}

export function buildAnnualFlowDiagram(
  row: AnnualLedgerRow,
  smallCategoryRatio = DEFAULT_SMALL_CATEGORY_RATIO
): AnnualFlowDiagram {
  if (
    !Number.isFinite(smallCategoryRatio) ||
    smallCategoryRatio < 0 ||
    smallCategoryRatio >= 1
  ) {
    throw new Error('Invalid small category ratio');
  }
  for (const amount of [
    row.openingAvailableCents,
    row.openingReservedInvestmentCents,
    row.incomeCents,
    row.expenseCents,
    row.liquidReturnCents,
    row.investmentAllocatedCents,
    row.investmentReleasedCents,
    row.closingReservedInvestmentCents,
  ]) {
    if (!Number.isSafeInteger(amount))
      throw new Error('Annual flow amounts must be safe integers');
  }
  if (row.incomeCents < 0 || row.expenseCents < 0)
    throw new Error('Income and expense totals cannot be negative');

  const sources: Array<{
    category: AnnualFlowCategory;
    amountCents: number;
    tone: AnnualFlowNodeTone;
  }> = reconcileCategories(
    row.incomeByCategory,
    row.incomeCents,
    'unallocated-income'
  ).map((item) => ({ ...item, tone: 'income' as const }));
  const uses: Array<{
    category: AnnualFlowCategory;
    amountCents: number;
    tone: AnnualFlowNodeTone;
  }> = reconcileCategories(
    row.expenseByCategory,
    row.expenseCents,
    'unallocated-expense'
  ).map((item) => ({ ...item, tone: 'expense' as const }));

  if (row.liquidReturnCents > 0) {
    sources.push({
      category: 'liquid-return',
      amountCents: row.liquidReturnCents,
      tone: 'income',
    });
  } else if (row.liquidReturnCents < 0) {
    uses.push({
      category: 'liquid-loss',
      amountCents: -row.liquidReturnCents,
      tone: 'expense',
    });
  }

  if (row.investmentReleasedCents > 0) {
    sources.push({
      category: 'investment-release',
      amountCents: row.investmentReleasedCents,
      tone: 'income',
    });
  }
  if (row.investmentAllocatedCents > 0) {
    uses.push({
      category: 'investment-allocation',
      amountCents: row.investmentAllocatedCents,
      tone: 'surplus',
    });
  }

  const carriedInvestmentCents = Math.min(
    row.openingReservedInvestmentCents,
    row.closingReservedInvestmentCents
  );
  if (carriedInvestmentCents > 0) {
    sources.push({
      category: 'investment-carried-in',
      amountCents: carriedInvestmentCents,
      tone: 'neutral',
    });
    uses.push({
      category: 'investment-held',
      amountCents: carriedInvestmentCents,
      tone: 'surplus',
    });
  }

  const recurringSources = sources.reduce(
    (sum, item) => sum + item.amountCents,
    0
  );
  const recurringUses = uses.reduce((sum, item) => sum + item.amountCents, 0);
  const annualChange = recurringSources - recurringUses;

  if (annualChange >= 0) {
    if (annualChange > 0) {
      uses.push({
        category: 'annual-surplus',
        amountCents: annualChange,
        tone: 'surplus',
      });
    }
  } else {
    const shortage = -annualChange;
    const openingDrawdown = Math.min(
      Math.max(0, row.openingAvailableCents),
      shortage
    );
    if (openingDrawdown > 0) {
      sources.push({
        category: 'opening-drawdown',
        amountCents: openingDrawdown,
        tone: 'neutral',
      });
    }
    const newGap = shortage - openingDrawdown;
    if (newGap > 0) {
      sources.push({
        category: 'new-gap',
        amountCents: newGap,
        tone: 'risk',
      });
    }
  }

  const sourceTotalCents = sources.reduce(
    (sum, item) => sum + item.amountCents,
    0
  );
  const useTotalCents = uses.reduce((sum, item) => sum + item.amountCents, 0);
  if (sourceTotalCents !== useTotalCents) {
    throw new Error(
      `Annual flow is not balanced: ${sourceTotalCents} !== ${useTotalCents}`
    );
  }

  const groupedSources = groupSmallCategories(
    sources,
    sourceTotalCents,
    'other-income',
    'income',
    smallCategoryRatio
  );
  const groupedUses = groupSmallCategories(
    uses,
    useTotalCents,
    'other-expense',
    'expense',
    smallCategoryRatio
  );
  const sourceNodes = groupedSources.map((item) =>
    node('source', item.category, item.amountCents, item.tone)
  );
  const useNodes = groupedUses.map((item) =>
    node('use', item.category, item.amountCents, item.tone)
  );
  const center = node('center', 'available-funds', sourceTotalCents, 'neutral');

  return {
    nodes: [...sourceNodes, center, ...useNodes],
    links: [
      ...sourceNodes.map((source) => ({
        source: source.id,
        target: CENTER_ID,
        amountCents: source.amountCents,
      })),
      ...useNodes.map((use) => ({
        source: CENTER_ID,
        target: use.id,
        amountCents: use.amountCents,
      })),
    ],
    sourceTotalCents,
    useTotalCents,
  };
}

/**
 * Reduces label density for the visual chart without changing the underlying
 * annual ledger data. Structural items such as a funding gap, held investment
 * principal, and the annual surplus always remain individually visible.
 */
export function compactAnnualFlowDiagram(
  diagram: AnnualFlowDiagram,
  maxNodesPerSide = 4
): AnnualFlowDiagram {
  if (!Number.isSafeInteger(maxNodesPerSide) || maxNodesPerSide < 2) {
    throw new Error(
      'Annual flow compact limit must be an integer of at least 2'
    );
  }

  const compactSide = (
    side: 'source' | 'use',
    groupedCategory: 'other-income' | 'other-expense',
    groupedTone: 'income' | 'expense'
  ) => {
    const sideNodes = diagram.nodes.filter((item) => item.side === side);
    if (sideNodes.length <= maxNodesPerSide) return sideNodes;

    const fixed = sideNodes.filter(
      (item) => !COMPACTABLE_CATEGORIES.has(item.category)
    );
    const candidates = sideNodes
      .filter((item) => COMPACTABLE_CATEGORIES.has(item.category))
      .sort(
        (a, b) =>
          b.amountCents - a.amountCents || a.category.localeCompare(b.category)
      );
    const visibleCandidateCount = Math.max(
      0,
      maxNodesPerSide - fixed.length - 1
    );
    const visible = candidates.slice(0, visibleCandidateCount);
    const grouped = candidates.slice(visibleCandidateCount);

    if (grouped.length < 2) return sideNodes;

    return [
      ...fixed,
      ...visible,
      node(
        side,
        groupedCategory,
        grouped.reduce((sum, item) => sum + item.amountCents, 0),
        groupedTone
      ),
    ].sort(
      (a, b) =>
        b.amountCents - a.amountCents || a.category.localeCompare(b.category)
    );
  };

  const sourceNodes = compactSide('source', 'other-income', 'income');
  const useNodes = compactSide('use', 'other-expense', 'expense');
  const center = diagram.nodes.find((item) => item.side === 'center');
  if (!center)
    throw new Error('Annual flow diagram is missing its center node');

  return {
    nodes: [...sourceNodes, center, ...useNodes],
    links: [
      ...sourceNodes.map((source) => ({
        source: source.id,
        target: center.id,
        amountCents: source.amountCents,
      })),
      ...useNodes.map((use) => ({
        source: center.id,
        target: use.id,
        amountCents: use.amountCents,
      })),
    ],
    sourceTotalCents: diagram.sourceTotalCents,
    useTotalCents: diagram.useTotalCents,
  };
}

export function buildAnnualSnapshot(
  row: AnnualLedgerRow
): AnnualSnapshotViewModel {
  return {
    year: row.year,
    ageStart: row.ageStart,
    ageEnd: row.ageEnd,
    phase: row.phase,
    incomeCents: row.incomeCents,
    expenseCents: row.expenseCents,
    liquidReturnCents: row.liquidReturnCents,
    annualAvailableChangeCents:
      row.closingAvailableCents - row.openingAvailableCents,
    closingAvailableCents: row.closingAvailableCents,
    closingNetWorthCents: row.closingNetWorthCents,
    minimumAvailableCents: row.minimumAvailableCents,
    flow: buildAnnualFlowDiagram(row),
  };
}

export function buildAnnualSnapshots(
  result: MonthlyCalculationResult
): AnnualSnapshotViewModel[] {
  return result.annual.map(buildAnnualSnapshot);
}

export function selectInitialSnapshotYear(
  result: MonthlyCalculationResult,
  preferredYear?: number | null
): number | null {
  if (result.annual.length === 0) return null;
  if (
    preferredYear !== undefined &&
    preferredYear !== null &&
    result.annual.some((row) => row.year === preferredYear)
  ) {
    return preferredYear;
  }
  if (result.summary.firstGapYear !== null) {
    return result.summary.firstGapYear;
  }

  const first = result.annual[0];
  const minimum = result.annual.reduce((lowest, row) =>
    row.minimumAvailableCents < lowest.minimumAvailableCents ? row : lowest
  );
  if (
    result.summary.minimumAvailableCents === first.openingAvailableCents &&
    !result.summary.hasAnyGap
  ) {
    const retirementYear = monthParts(result.input.retirementMonth).year;
    if (result.annual.some((row) => row.year === retirementYear)) {
      return retirementYear;
    }
  }
  return minimum.year;
}
