import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Each run owns a fresh Chrome profile. It never opens the user's browser data.
const offlineRun = process.argv.includes('--offline');
const origin =
  process.env.E2E_BASE_URL ||
  (offlineRun ? 'http://localhost:3107' : 'http://localhost:3000');
let ownedServer;
let proxyServer;
let serveNextWorker = false;
const executable =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await fs.mkdtemp(
  path.join(os.tmpdir(), 'life-ledger-navigation-')
);
const chromeArgs = [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  'about:blank',
];
let chrome = spawn(executable, chromeArgs, { stdio: 'ignore' });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
let inspectPage;
let inspectOffline;
const requestUrls = new Map();
const evidence = { profile, startedAt: new Date().toISOString(), checks: [] };
async function waitFor(task, message) {
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    try {
      const value = await task();
      if (value) return value;
    } catch {
      /* Page may be transitioning. */
    }
    await delay(100);
  }
  throw new Error(`Timed out: ${message}`);
}
try {
  if (offlineRun) {
    const url = new URL(origin);
    assert.equal(
      url.hostname,
      'localhost',
      'Offline test must own a local server'
    );
    let occupied = false;
    try {
      await fetch(origin);
      occupied = true;
    } catch {
      /* Available test port. */
    }
    assert.equal(
      occupied,
      false,
      'Choose an unused port for the owned offline-test server'
    );
    const backend = `http://localhost:${Number(url.port) + 1}`;
    let backendOccupied = false;
    try {
      await fetch(backend);
      backendOccupied = true;
    } catch {
      /* Test port. */
    }
    assert.equal(
      backendOccupied,
      false,
      'Offline test backend port must be unused'
    );
    ownedServer = spawn(
      process.execPath,
      [
        'node_modules/next/dist/bin/next',
        'start',
        '--port',
        String(Number(url.port) + 1),
      ],
      { stdio: 'ignore' }
    );
    await waitFor(async () => {
      if (ownedServer.exitCode !== null) throw new Error('Test server exited');
      return (await fetch(backend)).ok;
    }, 'production test server');
    const worker = await fs.readFile('public/life-ledger-sw.js', 'utf8');
    proxyServer = createServer(async (request, response) => {
      try {
        if (request.url === '/life-ledger-sw.js') {
          response.writeHead(200, {
            'content-type': 'application/javascript',
            'cache-control': 'no-store',
          });
          response.end(
            serveNextWorker
              ? worker.replace(/"version":"([^"]+)"/, '"version":"$1-qa-next"')
              : worker
          );
          return;
        }
        const body = [];
        for await (const chunk of request) body.push(chunk);
        const upstream = await fetch(`${backend}${request.url}`, {
          method: request.method,
          headers: { ...request.headers, host: new URL(backend).host },
          body: body.length ? Buffer.concat(body) : undefined,
          redirect: 'manual',
        });
        const headers = Object.fromEntries(upstream.headers);
        delete headers['content-encoding'];
        delete headers['content-length'];
        response.writeHead(upstream.status, headers);
        response.end(Buffer.from(await upstream.arrayBuffer()));
      } catch {
        response.writeHead(502);
        response.end();
      }
    });
    await new Promise((resolve) =>
      proxyServer.listen(Number(url.port), 'localhost', resolve)
    );
  }
  const port = await waitFor(
    async () =>
      Number(
        (
          await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
        ).split('\n')[0]
      ),
    'Chrome startup'
  );
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(
    pages.find((p) => p.type === 'page').webSocketDebuggerUrl
  );
  await new Promise((resolve) =>
    socket.addEventListener('open', resolve, { once: true })
  );
  let id = 0;
  const pending = new Map();
  let acceptDialog = false;
  let dialogCount = 0;
  let navigationEpoch = 0;
  const send = async (method, params = {}) => {
    const before = navigationEpoch;
    const result = await new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    if (method === 'Page.navigate' || method === 'Page.reload') {
      await waitFor(
        () => navigationEpoch > before,
        'document navigation committed'
      );
    }
    return result;
  };
  const receiveMessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId)
      navigationEpoch++;
    if (m.method === 'Runtime.exceptionThrown') {
      (evidence.browserErrors ??= []).push(m.params.exceptionDetails);
    }
    if (m.method === 'Network.requestWillBeSent') {
      requestUrls.set(m.params.requestId, m.params.request.url);
    }
    if (m.method === 'Network.loadingFailed') {
      (evidence.networkErrors ??= []).push({
        ...m.params,
        url: requestUrls.get(m.params.requestId),
      });
    }
    if (m.method === 'Page.javascriptDialogOpening') {
      dialogCount++;
      void send('Page.handleJavaScriptDialog', { accept: acceptDialog });
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(m.error) : p.resolve(m.result);
  };
  socket.addEventListener('message', receiveMessage);
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  inspectPage = () =>
    evaluate(
      '({url:location.href,text:document.body.innerText.slice(0,6000)})'
    );
  inspectOffline = () =>
    evaluate(`(async()=>{
    const reg=await navigator.serviceWorker.getRegistration();
    const keys=await caches.keys();
    return {controller:navigator.serviceWorker.controller?.state, active:reg?.active?.state, waiting:reg?.waiting?.state,
      caches:await Promise.all(keys.map(async key=>({key, count:(await (await caches.open(key)).keys()).length}))),
      scripts:[...document.scripts].map(s=>s.src).filter(Boolean)};
  })()`);
  const click = async (selector) => {
    const point = await evaluate(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`
    );
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      clickCount: 1,
      ...point,
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      clickCount: 1,
      ...point,
    });
  };
  const ready = (selector) =>
    waitFor(
      () => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),
      selector
    );
  const fill = (selector, value) =>
    evaluate(
      `(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`
    );
  const selected = (tab) =>
    waitFor(
      () =>
        evaluate(
          `document.querySelector('#workspace-tab-${tab}')?.getAttribute('aria-selected')==='true'`
        ),
      `tab ${tab}`
    );
  const record = () =>
    evaluate(
      `(async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('life-ledger');q.onsuccess=()=>r(q.result);q.onerror=j});const meta=await new Promise(r=>{const q=db.transaction('meta').objectStore('meta').get('active-plan');q.onsuccess=()=>r(q.result)});const plan=await new Promise(r=>{const q=db.transaction('plans').objectStore('plans').get(meta.value);q.onsuccess=()=>r(q.result)});db.close();return plan})()`
    );
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: origin });
  await ready('#calculator form');
  await waitFor(
    () =>
      evaluate(
        "Object.keys(document.querySelector('#calculator form')).some(k=>k.startsWith('__reactProps'))"
      ),
    'landing hydration'
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('#calculator input[type=number]').length"
    ),
    7
  );
  await delay(500);
  if (process.argv.includes('--offline')) {
    await waitFor(
      () => evaluate('!!navigator.serviceWorker.controller'),
      'production offline shell prepared'
    );
    await evaluate(
      "window.__offlineUpgradeProbe='keep-current-page';caches.open('unrelated-test-cache')"
    );
    serveNextWorker = true;
    await evaluate(
      '(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update()})()'
    );
    await waitFor(
      () =>
        evaluate(
          '(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting)()'
        ),
      'new worker waits for existing page'
    );
    assert.equal(
      await evaluate('window.__offlineUpgradeProbe'),
      'keep-current-page'
    );
    const versions = await evaluate(
      "(async()=>(await caches.keys()).filter(k=>k.startsWith('life-ledger-shell-')))()"
    );
    assert.equal(versions.length, 2);
    assert.ok(versions.some((k) => k.endsWith('-qa-next')));
    evidence.checks.push(
      'New worker prepares separately and waits without reloading the current page'
    );
    const stopped = new Promise((resolve) => ownedServer.once('exit', resolve));
    ownedServer.kill('SIGTERM');
    await stopped;
    proxyServer.closeAllConnections();
    await new Promise((resolve) => proxyServer.close(resolve));
    await assert.rejects(fetch(origin));
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    evidence.checks.push(
      'Owned production server stopped; HTTP cache disabled before offline checks'
    );
    await send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await send('Page.reload');
    await waitFor(
      () =>
        evaluate(
          "Object.keys(document.querySelector('#calculator form') || {}).some(k=>k.startsWith('__reactProps'))"
        ),
      'offline landing hydration'
    );
    evidence.checks.push(
      'Prepared landing reloads and hydrates offline before creating a plan'
    );
  }
  await click('#calculator button[type=submit]');
  await waitFor(
    () =>
      evaluate(
        "[...document.querySelectorAll('button')].some(b=>b.textContent.includes('加入我的人生大事'))"
      ),
    'landing result'
  );
  await evaluate(
    "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('加入我的人生大事')).click()"
  );
  await ready('#workspace-tab-plan');
  await waitFor(() => record(), 'saved initial plan');
  if (process.argv.includes('--offline')) {
    evidence.checks.push(
      'Landing calculation and first workspace navigation succeed offline'
    );
  }
  await click('#workspace-tab-plan');
  await selected('plan');
  await evaluate(
    "[...document.querySelectorAll('main nav button')].find(b=>b.textContent.trim()==='职业发展').click()"
  );
  await ready('#career-tab-growth');
  const beforePreset = dialogCount;
  await evaluate(
    "[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()==='3%').click()"
  );
  await click('#career-tab-salary');
  assert.equal(
    dialogCount,
    beforePreset + 1,
    'Preset creates a protected unsubmitted draft'
  );
  assert.equal(
    await evaluate("document.querySelector('input[name=growth]').value"),
    '3'
  );
  await fill('input[name=growth]', '3');
  await delay(50);
  const beforeDialogs = dialogCount;
  await click('#career-tab-salary');
  assert.equal(dialogCount, beforeDialogs + 1);
  assert.equal(
    await evaluate(
      "document.querySelector('#career-tab-growth').getAttribute('aria-selected')"
    ),
    'true'
  );
  assert.equal(
    await evaluate("document.querySelector('input[name=growth]').value"),
    '3'
  );
  await click('#workspace-tab-ledger');
  assert.equal(dialogCount, beforeDialogs + 2);
  await selected('plan');
  const originalHref = await evaluate('location.href');
  const beforeHeader = dialogCount;
  await click('header a');
  assert.equal(
    dialogCount,
    beforeHeader + 1,
    'Returning home protects the draft'
  );
  assert.equal(await evaluate('location.href'), originalHref);
  await click('header button[aria-haspopup="menu"]');
  await ready('[role=menuitem]');
  await evaluate(
    "[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.includes('English')).click()"
  );
  await delay(100);
  assert.equal(
    dialogCount,
    beforeHeader + 2,
    'Language changes protect the draft'
  );
  assert.equal(await evaluate('location.href'), originalHref);
  assert.equal(
    await evaluate("document.querySelector('input[name=growth]').value"),
    '3'
  );
  evidence.checks.push(
    'Canceled home and language navigation keep the URL and unsubmitted growth'
  );
  const originalLength = await evaluate('history.length');
  const beforeBack = dialogCount;
  await evaluate('history.back()');
  await waitFor(
    () => dialogCount > beforeBack,
    'back requests draft confirmation'
  );
  await waitFor(
    () => evaluate(`location.href===${JSON.stringify(originalHref)}`),
    'canceled back restores original history entry'
  );
  assert.equal(
    await evaluate("document.querySelector('input[name=growth]').value"),
    '3'
  );
  assert.equal(await evaluate('history.length'), originalLength);
  evidence.checks.push(
    'Salary preset is dirty; canceled browser back retains draft and original history without duplicates'
  );
  evidence.checks.push(
    'Canceled stage/tab navigation retains the unsubmitted draft'
  );
  acceptDialog = true;
  await click('#workspace-tab-ledger');
  await selected('ledger');
  await evaluate('history.back()');
  await selected('plan');
  await ready('input[name=growth]');
  assert.equal(
    await evaluate("document.querySelector('input[name=growth]').value"),
    '0',
    'Confirmed departure discards the unsubmitted growth'
  );
  await fill('input[name=growth]', '2');
  acceptDialog = false;
  const beforeForward = dialogCount;
  await evaluate('history.forward()');
  await waitFor(
    () => dialogCount > beforeForward,
    'forward requests draft confirmation'
  );
  await waitFor(
    () => evaluate(`location.href===${JSON.stringify(originalHref)}`),
    'canceled forward restores career entry'
  );
  assert.equal(
    await evaluate("document.querySelector('input[name=growth]').value"),
    '2'
  );
  acceptDialog = true;
  await evaluate('history.forward()');
  await selected('ledger');
  await evaluate('history.back()');
  await selected('plan');
  await ready('#career-tab-growth');
  evidence.checks.push(
    'Canceled forward retains draft; confirmed traversal works in both directions'
  );
  await click('#career-tab-side_income');
  await ready('input[name=amount]');
  await fill('input[name=amount]', '2000');
  await delay(50);
  const beforeEventEdit = await record();
  // Everything below is driven after the browser is disconnected.
  await send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await evaluate("document.querySelector('main form').requestSubmit()");
  await waitFor(
    async () =>
      (await record()).plan.standaloneCashFlows.some(
        (f) => f.category === 'side_income' && f.amountCents === 200000
      ),
    'offline event saved'
  );
  const saved = await record();
  assert.ok(
    saved.plan.metadata.updatedAt > beforeEventEdit.plan.metadata.updatedAt,
    'Accepted event updates provenance timestamp'
  );
  await click('#workspace-tab-overview');
  await selected('overview');
  await ready('#balance-chart-heading');
  await click('#workspace-tab-ledger');
  await selected('ledger');
  assert.ok(
    await evaluate(
      "document.querySelector('main').innerText.includes('全部年份')"
    )
  );
  await click('#workspace-tab-plan');
  await selected('plan');
  await ready('#career-tab-growth');
  assert.equal((await record()).revision, saved.revision);
  evidence.checks.push(
    'Offline: edit and save event, view both charts, switch ledger/plan without revision changes'
  );
  await evaluate('history.back()');
  await selected('ledger');
  await evaluate('history.forward()');
  await selected('plan');
  evidence.checks.push('Browser back/forward remains functional offline');
  await send('Network.emulateNetworkConditions', {
    offline: process.argv.includes('--offline'),
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await send('Page.reload');
  await ready('#career-tab-growth');
  assert.equal((await record()).revision, saved.revision);
  assert.ok(
    (await record()).plan.standaloneCashFlows.some(
      (f) => f.category === 'side_income' && f.amountCents === 200000
    )
  );
  evidence.checks.push(
    'Reload restores event without generating a new revision'
  );
  if (process.argv.includes('--offline')) {
    for (const pause of [0, 10, 100]) {
      await send('Page.navigate', { url: 'about:blank' });
      if (pause) await delay(pause);
      await send('Page.navigate', { url: `${origin}/plan?tab=overview` });
      await ready('#balance-chart-heading');
      assert.equal((await record()).revision, saved.revision);
    }
    const cached = await evaluate(
      "(async()=>{const keys=await caches.keys();return (await Promise.all(keys.filter(k=>k.startsWith('life-ledger-shell-')).map(async k=>(await (await caches.open(k)).keys()).map(r=>new URL(r.url).pathname)))).flat()})()"
    );
    assert.ok(
      cached.every(
        (p) =>
          /^\/(?:en|zh)?\/?(?:plan)?$/.test(p) || p.startsWith('/_next/static/')
      )
    );
    evidence.checks.push(
      'Fresh documents reopen offline at 0/10/100ms navigation intervals; saved revision unchanged; cache contains only public shells and static resources'
    );
  }
  if (process.argv.includes('--personas')) {
    const { runPersonaJourneys } = await import('./persona-journeys.mjs');
    evidence.personas = await runPersonaJourneys({
      evaluate,
      click,
      fill,
      ready,
      record,
      selected,
      waitFor,
      send,
      origin,
      delay,
    });
  }
  if (process.argv.includes('--balance')) {
    await send('Page.navigate', { url: `${origin}/plan?tab=overview` });
    await ready('#balance-chart-heading');
    await fs.mkdir('docs/evidence', { recursive: true });
    for (const width of [375, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await delay(500);
      await evaluate(
        "document.querySelector('#balance-chart-heading').scrollIntoView({block:'start'})"
      );
      await delay(200);
      const chart = await evaluate(`(()=>{
        const section=document.querySelector('#balance-chart-heading').closest('section');
        return { text:section.innerText, dots:section.querySelectorAll('.recharts-reference-dot').length, ticks:section.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick').length, overflow:document.documentElement.scrollWidth>innerWidth+1 };
      })()`);
      assert.ok(chart.text.includes('退休年末可用资金'));
      assert.ok(chart.text.includes('计算终点可用资金'));
      assert.equal(chart.dots, 2);
      assert.ok(chart.ticks >= 2);
      assert.equal(chart.overflow, false);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(
        `docs/evidence/balance-${width}.png`,
        Buffer.from(shot.data, 'base64')
      );
      evidence.checks.push(
        `Balance chart ${width}px: visible axes, two checkpoints, no overflow`
      );
    }
  }
  if (process.argv.includes('--audit')) {
    const { runUiAudit } = await import('./ui-audit.mjs');
    evidence.uiAudit = await runUiAudit({
      evaluate,
      send,
      ready,
      waitFor,
      origin,
      delay,
    });
    assert.equal(evidence.uiAudit.status, 'passed', 'UI audit must pass');
  }
  evidence.status = 'passed';
  if (offlineRun) {
    const beforeRestart = await record();
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    await send('Browser.close');
    await exited;
    socket.close();
    chrome = spawn(executable, chromeArgs, { stdio: 'ignore' });
    const restartedPages = await waitFor(async () => {
      const newPort = Number(
        (
          await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
        ).split('\n')[0]
      );
      return (await fetch(`http://127.0.0.1:${newPort}/json`)).json();
    }, 'browser restarted with the same test profile');
    socket = new WebSocket(
      restartedPages.find((p) => p.type === 'page').webSocketDebuggerUrl
    );
    await new Promise((resolve) =>
      socket.addEventListener('open', resolve, { once: true })
    );
    socket.addEventListener('message', receiveMessage);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await assert.rejects(fetch(origin));
    await send('Page.navigate', { url: `${origin}/plan?tab=overview` });
    await ready('#balance-chart-heading');
    assert.deepEqual(await record(), beforeRestart);
    const activeCaches = await evaluate('caches.keys()');
    const shells = activeCaches.filter((k) =>
      k.startsWith('life-ledger-shell-')
    );
    assert.equal(shells.length, 2);
    assert.ok(shells.some((key) => key.endsWith('-qa-next')));
    assert.ok(activeCaches.includes('unrelated-test-cache'));
    evidence.checks.push(
      'Waiting version activates after old clients exit; current and preceding shells retained for handover, unrelated cache and IndexedDB retained'
    );
    await send('Page.navigate', { url: `${origin}/en/plan?tab=overview` });
    await ready('#balance-chart-heading');
    assert.equal(await evaluate('document.documentElement.lang'), 'en');
    assert.deepEqual(await record(), beforeRestart);
    evidence.checks.push(
      'Full browser process restart while server remains stopped restores plan unchanged; English shell also opens offline'
    );
  }
  if (process.argv.includes('--recovery')) {
    const { runRecoveryJourneys } = await import('./recovery-journeys.mjs');
    evidence.recovery = await runRecoveryJourneys({
      evaluate,
      click,
      ready,
      record,
      waitFor,
      send,
      origin,
      delay,
      port,
    });
  }
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.status = 'failed';
  evidence.error = String(error);
  evidence.page = await inspectPage?.();
  if (offlineRun)
    evidence.offlineDiagnostic = await inspectOffline?.().catch((error) =>
      String(error)
    );
  console.error(error, evidence.page);
  process.exitCode = 1;
} finally {
  const output = path.resolve(
    process.argv.includes('--balance')
      ? 'docs/evidence/workspace-balance.json'
      : process.argv.includes('--audit')
        ? 'docs/evidence/workspace-ui-journey.json'
        : process.argv.includes('--offline')
          ? 'docs/evidence/workspace-offline.json'
          : process.argv.includes('--recovery')
            ? 'docs/evidence/workspace-recovery.json'
            : 'docs/evidence/workspace-navigation.json'
  );
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(evidence, null, 2));
  socket?.close();
  chrome.kill('SIGTERM');
  if (ownedServer && ownedServer.exitCode === null) ownedServer.kill('SIGTERM');
  proxyServer?.closeAllConnections();
  proxyServer?.close();
}
