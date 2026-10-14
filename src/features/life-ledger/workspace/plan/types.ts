import type { LifePlan } from '../../domain';
import type { WorkspaceCopy } from '../workspace-types';

export const PLAN_SECTIONS = [
  'basics',
  'assets',
  'income',
  'living',
  'career',
  'partner',
  'child',
  'housing',
  'parents',
  'retirement',
  'events',
  'advanced',
] as const;
export type PlanSectionId = (typeof PLAN_SECTIONS)[number];
export function resolvePlanSection(value: string | null): PlanSectionId | '' {
  if (value === '') return '';
  if (value === 'family' || value === 'partner-child') return 'child';
  return PLAN_SECTIONS.includes(value as PlanSectionId)
    ? (value as PlanSectionId)
    : 'basics';
}
export interface SectionProps {
  plan: LifePlan;
  locale: string;
  copy: WorkspaceCopy;
  onChange: (updater: (plan: LifePlan) => LifePlan) => void;
}
