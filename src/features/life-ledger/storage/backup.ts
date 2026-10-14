import { validateLifePlan, type LifePlan } from '../domain';

export interface LifeLedgerBackup {
  formatVersion: '1.0.0';
  exportedAt: string;
  plan: LifePlan;
  versions: LifePlan['versions'];
}

export function createPlanBackup(plan: LifePlan): LifeLedgerBackup {
  return {
    formatVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
    plan,
    versions: plan.versions,
  };
}

export function parsePlanBackup(raw: string): LifeLedgerBackup {
  const backup = JSON.parse(raw) as LifeLedgerBackup;
  if (
    backup.formatVersion !== '1.0.0' ||
    !backup.plan ||
    !validateLifePlan(backup.plan).valid
  ) {
    throw new Error('This file is not a valid Life Ledger backup.');
  }
  return backup;
}

export function downloadPlanBackup(plan: LifePlan) {
  const backup = createPlanBackup(plan);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `life-ledger-backup-${backup.exportedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
