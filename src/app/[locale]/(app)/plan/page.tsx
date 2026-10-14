import { PlanWorkspaceClient } from '@/features/life-ledger/workspace/plan-workspace-client';
import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function PlanPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.plans');

  return <PlanWorkspaceClient locale={locale} copy={t.raw('workspace')} />;
}
