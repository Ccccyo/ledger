import type { AgentObservation } from '../workspace/agent/agent-types';
import { openLifeLedgerDatabase } from './plan-repository';

export interface StoredAgentTask {
  planId: string;
  planHash: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    evidence?: string[];
    caveats?: string[];
  }>;
  activeQuestion: string | null;
  step: number;
  observations: AgentObservation[];
  status: 'idle' | 'running' | 'interrupted';
  updatedAt: string;
}

export interface StoredAgentMemory {
  id: string;
  planId: string;
  text: string;
  createdAt: string;
}

function done(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function requested<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadAgentTask(
  planId: string
): Promise<StoredAgentTask | null> {
  const database = await openLifeLedgerDatabase();
  try {
    const transaction = database.transaction('agentTasks', 'readonly');
    return (
      (await requested<StoredAgentTask | undefined>(
        transaction.objectStore('agentTasks').get(planId)
      )) ?? null
    );
  } finally {
    database.close();
  }
}

export async function saveAgentTask(task: StoredAgentTask): Promise<void> {
  const database = await openLifeLedgerDatabase();
  try {
    const transaction = database.transaction('agentTasks', 'readwrite');
    transaction.objectStore('agentTasks').put(task);
    await done(transaction);
  } finally {
    database.close();
  }
}

export async function deleteAgentTask(planId: string): Promise<void> {
  const database = await openLifeLedgerDatabase();
  try {
    const transaction = database.transaction('agentTasks', 'readwrite');
    transaction.objectStore('agentTasks').delete(planId);
    await done(transaction);
  } finally {
    database.close();
  }
}

export async function listAgentMemories(
  planId: string
): Promise<StoredAgentMemory[]> {
  const database = await openLifeLedgerDatabase();
  try {
    const transaction = database.transaction('agentMemories', 'readonly');
    return await requested<StoredAgentMemory[]>(
      transaction.objectStore('agentMemories').index('planId').getAll(planId)
    );
  } finally {
    database.close();
  }
}

export async function saveAgentMemory(
  memory: StoredAgentMemory
): Promise<void> {
  const database = await openLifeLedgerDatabase();
  try {
    const transaction = database.transaction('agentMemories', 'readwrite');
    transaction.objectStore('agentMemories').put(memory);
    await done(transaction);
  } finally {
    database.close();
  }
}

export async function deleteAgentMemory(id: string): Promise<void> {
  const database = await openLifeLedgerDatabase();
  try {
    const transaction = database.transaction('agentMemories', 'readwrite');
    transaction.objectStore('agentMemories').delete(id);
    await done(transaction);
  } finally {
    database.close();
  }
}
