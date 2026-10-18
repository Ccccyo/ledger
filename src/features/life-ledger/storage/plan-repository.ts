import { md5 } from '@/shared/lib/hash';

import { createLocalId, validateLifePlan, type LifePlan } from '../domain';

const DB_NAME = 'life-ledger';
const DB_VERSION = 2;
const ACTIVE_PLAN_KEY = 'active-plan';

export interface StoredPlanRecord {
  id: string;
  schemaVersion: '2.0.0';
  revision: number;
  checksum: string;
  plan: LifePlan;
  updatedAt: string;
  writerId: string;
}

interface MetaRecord {
  key: string;
  value: string;
}

export interface StoredPlanSnapshot {
  planId: string;
  revision: number;
  record: StoredPlanRecord;
  createdAt: string;
}

export class PlanRevisionConflictError extends Error {
  readonly name = 'PlanRevisionConflictError';
}

export class PlanIntegrityError extends Error {
  readonly name = 'PlanIntegrityError';
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export function openLifeLedgerDatabase(factory: IDBFactory = indexedDB) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('plans')) {
        database.createObjectStore('plans', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('snapshots')) {
        const snapshots = database.createObjectStore('snapshots', {
          keyPath: ['planId', 'revision'],
        });
        snapshots.createIndex('planId', 'planId');
      }
      if (!database.objectStoreNames.contains('resultCache')) {
        database.createObjectStore('resultCache', { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains('meta')) {
        database.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains('agentTasks')) {
        database.createObjectStore('agentTasks', { keyPath: 'planId' });
      }
      if (!database.objectStoreNames.contains('agentMemories')) {
        const memories = database.createObjectStore('agentMemories', {
          keyPath: 'id',
        });
        memories.createIndex('planId', 'planId');
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('Life Ledger database is blocked.'));
  });
}

async function checksumPlan(plan: LifePlan) {
  const serialized = JSON.stringify(plan);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return `md5-${md5(serialized)}`;

  const bytes = new TextEncoder().encode(serialized);
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

async function matchesChecksum(plan: LifePlan, expected: string) {
  if (expected.startsWith('md5-')) {
    return expected === `md5-${md5(JSON.stringify(plan))}`;
  }
  if (!globalThis.crypto?.subtle) return false;
  return (await checksumPlan(plan)) === expected;
}

export async function getActivePlan(
  database: IDBDatabase
): Promise<StoredPlanRecord | null> {
  const transaction = database.transaction(['meta', 'plans'], 'readonly');
  const meta = await requestResult<MetaRecord | undefined>(
    transaction.objectStore('meta').get(ACTIVE_PLAN_KEY)
  );
  if (!meta?.value) return null;
  const plan = await requestResult<StoredPlanRecord | undefined>(
    transaction.objectStore('plans').get(meta.value)
  );
  if (plan) {
    let valid = false;
    try {
      valid =
        validateLifePlan(plan.plan).valid &&
        (await matchesChecksum(plan.plan, plan.checksum));
    } catch {
      /* Malformed objects are also integrity failures. */
    }
    if (!valid)
      throw new PlanIntegrityError(
        'Stored plan failed integrity validation. Restore a snapshot or import a backup.'
      );
  }
  return plan ?? null;
}

export async function savePlan(
  database: IDBDatabase,
  plan: LifePlan,
  writerId: string,
  expectedRevision: number | null
): Promise<StoredPlanRecord> {
  if (!validateLifePlan(plan).valid)
    throw new Error('Invalid plan cannot be saved.');
  const checksum = await checksumPlan(plan);
  const transaction = database.transaction(
    ['plans', 'snapshots', 'meta'],
    'readwrite'
  );
  const plans = transaction.objectStore('plans');
  const existing = await requestResult<StoredPlanRecord | undefined>(
    plans.get(plan.id)
  );
  const active = await requestResult<MetaRecord | undefined>(
    transaction.objectStore('meta').get(ACTIVE_PLAN_KEY)
  );
  if (
    expectedRevision !== null &&
    ((existing?.revision ?? 0) !== expectedRevision ||
      active?.value !== plan.id)
  ) {
    transaction.abort();
    throw new PlanRevisionConflictError(
      'This plan was updated in another browser tab.'
    );
  }
  if (existing) {
    transaction.objectStore('snapshots').put({
      planId: existing.id,
      revision: existing.revision,
      record: existing,
      createdAt: new Date().toISOString(),
    });
  }
  const record: StoredPlanRecord = {
    id: plan.id,
    schemaVersion: '2.0.0',
    revision: (existing?.revision ?? 0) + 1,
    checksum,
    plan,
    updatedAt: new Date().toISOString(),
    writerId,
  };
  plans.put(record);
  if (!existing) {
    transaction.objectStore('snapshots').put({
      planId: record.id,
      revision: record.revision,
      record,
      createdAt: record.updatedAt,
    } satisfies StoredPlanSnapshot);
  }
  transaction
    .objectStore('meta')
    .put({ key: ACTIVE_PLAN_KEY, value: plan.id } satisfies MetaRecord);
  await transactionDone(transaction);
  void trimSnapshots(database, plan.id).catch(() => {});
  return record;
}

/**
 * Replaces the active plan in one transaction while preserving both the old
 * plan and the imported plan as recoverable snapshots.
 */
export async function replaceActivePlan(
  database: IDBDatabase,
  plan: LifePlan,
  writerId: string
): Promise<StoredPlanRecord> {
  if (!validateLifePlan(plan).valid)
    throw new Error('Invalid plan cannot be saved.');
  const checksum = await checksumPlan(plan);
  const transaction = database.transaction(
    ['plans', 'snapshots', 'meta'],
    'readwrite'
  );
  const plans = transaction.objectStore('plans');
  const snapshots = transaction.objectStore('snapshots');
  const meta = await requestResult<MetaRecord | undefined>(
    transaction.objectStore('meta').get(ACTIVE_PLAN_KEY)
  );
  const current = meta?.value
    ? await requestResult<StoredPlanRecord | undefined>(plans.get(meta.value))
    : undefined;
  const existingIncoming = await requestResult<StoredPlanRecord | undefined>(
    plans.get(plan.id)
  );

  if (current) {
    snapshots.put({
      planId: current.id,
      revision: current.revision,
      record: current,
      createdAt: new Date().toISOString(),
    } satisfies StoredPlanSnapshot);
  }

  const record: StoredPlanRecord = {
    id: plan.id,
    schemaVersion: '2.0.0',
    revision: (existingIncoming?.revision ?? 0) + 1,
    checksum,
    plan,
    updatedAt: new Date().toISOString(),
    writerId,
  };
  plans.put(record);
  snapshots.put({
    planId: record.id,
    revision: record.revision,
    record,
    createdAt: record.updatedAt,
  } satisfies StoredPlanSnapshot);
  if (current && current.id !== record.id) plans.delete(current.id);
  transaction
    .objectStore('meta')
    .put({ key: ACTIVE_PLAN_KEY, value: record.id } satisfies MetaRecord);

  await transactionDone(transaction);
  void trimSnapshots(database, record.id).catch(() => {});
  if (current && current.id !== record.id)
    void trimSnapshots(database, current.id).catch(() => {});
  return record;
}

export async function getLatestPlanSnapshot(
  database: IDBDatabase
): Promise<StoredPlanSnapshot | null> {
  const transaction = database.transaction(['snapshots', 'meta'], 'readonly');
  const [snapshots, active] = await Promise.all([
    requestResult<StoredPlanSnapshot[]>(
      transaction.objectStore('snapshots').getAll()
    ),
    requestResult<MetaRecord | undefined>(
      transaction.objectStore('meta').get(ACTIVE_PLAN_KEY)
    ),
  ]);
  for (const snapshot of snapshotCandidates(snapshots, active?.value)) {
    try {
      if (
        validateLifePlan(snapshot.record.plan).valid &&
        (await checksumPlan(snapshot.record.plan)) === snapshot.record.checksum
      )
        return snapshot;
    } catch {
      /* Try the next recoverable snapshot. */
    }
  }
  return null;
}

export function snapshotCandidates(
  snapshots: StoredPlanSnapshot[],
  activePlanId?: string
) {
  return snapshots
    .filter((snapshot) => !activePlanId || snapshot.planId === activePlanId)
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision
    );
}

async function trimSnapshots(database: IDBDatabase, planId: string) {
  const transaction = database.transaction('snapshots', 'readwrite');
  const store = transaction.objectStore('snapshots');
  const index = store.index('planId');
  const keys = await requestResult<IDBValidKey[]>(index.getAllKeys(planId));
  const sorted = keys.sort((left, right) => {
    const leftRevision = (left as [string, number])[1];
    const rightRevision = (right as [string, number])[1];
    return rightRevision - leftRevision;
  });
  sorted.slice(10).forEach((key) => store.delete(key));
  await transactionDone(transaction);
}

export async function deleteActivePlan(database: IDBDatabase) {
  const current = await getActivePlan(database);
  if (!current) return;
  const transaction = database.transaction(
    ['plans', 'snapshots', 'resultCache', 'meta'],
    'readwrite'
  );
  transaction.objectStore('plans').clear();
  transaction.objectStore('snapshots').clear();
  transaction.objectStore('resultCache').clear();
  transaction.objectStore('meta').delete(ACTIVE_PLAN_KEY);
  await transactionDone(transaction);
}

export function createWriterId() {
  return createLocalId('writer');
}
