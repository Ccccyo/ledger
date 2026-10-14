import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync('scripts/offline/worker.js', 'utf8').replace(
  '__LIFE_LEDGER_MANIFEST__',
  JSON.stringify({ version: 'test', assets: ['/_next/static/app.js'] })
);

function harness(failInstall = false) {
  const handlers: Record<string, (event: any) => void> = {};
  const values = new Map<string, Response>();
  const removed: string[] = [];
  const requests: Request[] = [];
  let offline = false;
  const cache = {
    put: async (key: string, response: Response) => {
      values.set(key, response);
    },
    match: async (key: string) => values.get(key)?.clone(),
  };
  class LocalRequest extends Request {
    constructor(input: string, init?: RequestInit) {
      super(new URL(input, 'https://ledger.test'), init);
    }
  }
  runInNewContext(source, {
    self: {
      location: { origin: 'https://ledger.test' },
      clients: { claim: async () => {} },
      addEventListener: (name: string, handler: any) => {
        handlers[name] = handler;
      },
    },
    URL,
    Request: LocalRequest,
    Response,
    caches: {
      open: async () => cache,
      keys: async () => [
        'unrelated-cache',
        'life-ledger-shell-ancient',
        'life-ledger-shell-old',
        'life-ledger-shell-test',
      ],
      delete: async (key: string) => {
        removed.push(key);
      },
    },
    fetch: async (request: Request) => {
      requests.push(request);
      if (offline || (failInstall && request.url.endsWith('app.js')))
        throw new Error('Offline');
      return new Response('public shell', {
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  const lifecycle = (name: string) =>
    new Promise<void>((resolve, reject) =>
      handlers[name]({
        waitUntil: (task: Promise<void>) => task.then(resolve, reject),
      })
    );
  const fetchEvent = (path: string, mode = 'navigate', method = 'GET') => {
    let response: Promise<Response> | undefined;
    handlers.fetch({
      request: { url: new URL(path, 'https://ledger.test').href, mode, method },
      respondWith: (task: Promise<Response>) => {
        response = task;
      },
    });
    return response;
  };
  return {
    lifecycle,
    fetchEvent,
    requests,
    removed,
    goOffline: () => {
      offline = true;
    },
  };
}

it('offline preparation omits credentials and never intercepts private routes or APIs', async () => {
  const h = harness();
  await h.lifecycle('install');
  assert.ok(h.requests.every((r) => r.credentials === 'omit'));
  h.goOffline();
  assert.equal(
    await (await h.fetchEvent('/plan?tab=ledger'))?.text(),
    'public shell'
  );
  for (const path of [
    '/api/auth/session',
    '/settings',
    '/admin',
    '/chat',
    'https://other.test/plan',
  ]) {
    assert.equal(h.fetchEvent(path), undefined);
  }
  assert.equal(h.fetchEvent('/plan', 'navigate', 'POST'), undefined);
  assert.equal(h.fetchEvent('/plan?_rsc=abc', 'cors'), undefined);
  await h.lifecycle('activate');
  assert.deepEqual(h.removed, ['life-ledger-shell-ancient']);
});

it('partial preparation is removed and does not activate an incomplete shell', async () => {
  const h = harness(true);
  await assert.rejects(h.lifecycle('install'));
  assert.deepEqual(h.removed, ['life-ledger-shell-test']);
});

it('controller handover serves the preceding HTML build assets offline and bounds cache retention', async () => {
  const stores = new Map<string, Map<string, Response>>([
    ['unrelated-cache', new Map()],
    ['life-ledger-shell-ancient', new Map()],
    [
      'life-ledger-shell-old',
      new Map([['/_next/static/old-hash.js', new Response('old build')]]),
    ],
    [
      'life-ledger-shell-test',
      new Map([['/_next/static/new-hash.js', new Response('new build')]]),
    ],
  ]);
  const handlers: Record<string, (event: any) => void> = {};
  runInNewContext(source, {
    self: {
      location: { origin: 'https://ledger.test' },
      clients: { claim: async () => {} },
      addEventListener: (name: string, fn: any) => {
        handlers[name] = fn;
      },
    },
    URL,
    Response,
    caches: {
      keys: async () => [...stores.keys()],
      delete: async (key: string) => stores.delete(key),
      open: async (key: string) => ({
        match: async (path: string) => stores.get(key)?.get(path)?.clone(),
      }),
    },
    fetch: async () => {
      throw new Error('Offline');
    },
  });
  await new Promise((resolve, reject) =>
    handlers.activate({
      waitUntil: (p: Promise<void>) => p.then(resolve, reject),
    })
  );
  assert.deepEqual(
    [...stores.keys()],
    ['unrelated-cache', 'life-ledger-shell-old', 'life-ledger-shell-test']
  );
  const request = (path: string) =>
    new Promise<Response>((resolve, reject) =>
      handlers.fetch({
        request: {
          url: `https://ledger.test${path}`,
          method: 'GET',
          mode: 'cors',
        },
        respondWith: (p: Promise<Response>) => p.then(resolve, reject),
      })
    );
  assert.equal(
    await (await request('/_next/static/old-hash.js')).text(),
    'old build'
  );
  assert.equal(
    await (await request('/_next/static/new-hash.js')).text(),
    'new build'
  );
  await assert.rejects(request('/_next/static/missing.js'), /Offline/);
});
