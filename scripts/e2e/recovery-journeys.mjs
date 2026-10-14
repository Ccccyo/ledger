import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  propertyPersona,
} = require('../../src/features/life-ledger/analysis/personas.ts');

export async function runRecoveryJourneys(api) {
  const { evaluate, click, ready, record, waitFor, send, origin, delay, port } =
    api;
  const checks = [];
  const axePackage = (await fs.readdir('node_modules/.pnpm')).find((name) =>
    name.startsWith('axe-core@')
  );
  const axe = await fs.readFile(
    `node_modules/.pnpm/${axePackage}/node_modules/axe-core/axe.min.js`,
    'utf8'
  );
  const accessibility = [];
  const scanState = async (name) => {
    await evaluate(axe);
    const originalClass = await evaluate('document.documentElement.className');
    for (const [width, theme] of [
      [375, 'dark'],
      [1440, 'light'],
    ]) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(
        `document.documentElement.classList.remove('light','dark');document.documentElement.classList.add('${theme}')`
      );
      // Let existing color transitions finish before measuring contrast.
      await delay(400);
      const report = await evaluate(`(async()=>{
        const result=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
        return {violations:result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),overflow:document.documentElement.scrollWidth>innerWidth+1};
      })()`);
      accessibility.push({ name, width, theme, ...report });
      await fs.writeFile(
        'docs/evidence/recovery-accessibility.json',
        JSON.stringify(accessibility, null, 2)
      );
      assert.deepEqual(report.violations, [], `${name} accessible at ${width}`);
      assert.equal(report.overflow, false);
    }
    await evaluate(
      `document.documentElement.className=${JSON.stringify(originalClass)}`
    );
  };
  // This suite uses the desktop tab bar; a preceding persona may leave the
  // shared browser at a phone viewport where those buttons are hidden.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const textButton = (text) =>
    evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`
    );
  const bodyHas = (text) =>
    waitFor(
      () =>
        evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`),
      text
    );
  const importText = (text) =>
    evaluate(
      `(()=>{const data=new DataTransfer();data.items.add(new File([${JSON.stringify(text)}],'test-backup.json',{type:'application/json'}));const input=document.querySelector('input[type=file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`
    );
  const openTrial = async () => {
    await click('#workspace-tab-overview');
    await ready('#actions-heading');
    await textButton('比较退休后的自付预算');
    await ready('[role=dialog]');
    await evaluate(
      "document.querySelector('[role=dialog] form').requestSubmit()"
    );
    await bodyHas('原计划 → 试算后');
  };
  const initial = await record();
  await importText('{invalid json');
  await bodyHas('无法读取这份备份');
  await scanState('invalid-import');
  assert.deepEqual(await record(), initial);
  assert.ok(await evaluate("!!document.querySelector('main')"));
  checks.push(
    'Malformed backup leaves the full current plan and revision intact'
  );

  await evaluate(
    "window.__qaTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...args){if(mode==='readwrite'&&[].concat(stores).includes('plans'))throw new DOMException('Injected write failure','QuotaExceededError');return window.__qaTransaction.call(this,stores,mode,...args)}"
  );
  await openTrial();
  await textButton('应用到计划');
  await bodyHas('未能保存到浏览器');
  await scanState('save-failure');
  assert.deepEqual(await record(), initial);
  assert.ok(
    await evaluate("!!document.querySelector('#balance-chart-heading')")
  );
  const editedResult = await evaluate(
    "document.querySelector('main').innerText"
  );
  await evaluate('IDBDatabase.prototype.transaction=window.__qaTransaction');
  await evaluate(
    "(()=>{const retry=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='重试');retry.click();retry.click();retry.click()})()"
  );
  await waitFor(
    async () => (await record()).revision > initial.revision,
    'retry persisted'
  );
  assert.equal(
    await evaluate("document.querySelector('main').innerText"),
    editedResult
  );
  const retried = await record();
  await delay(1000);
  assert.equal((await record()).revision, initial.revision + 1);
  await send('Page.reload');
  await ready('#balance-chart-heading');
  assert.deepEqual((await record()).plan, retried.plan);
  checks.push(
    'Injected storage failure retains edited result; repeated retry saves exactly once and reload restores it'
  );

  const plan = JSON.parse(JSON.stringify(propertyPersona()));
  await importText(
    JSON.stringify({
      formatVersion: '1.0.0',
      plan,
      versions: plan.versions,
      exportedAt: new Date().toISOString(),
    })
  );
  await waitFor(
    async () => (await record()).id === plan.id,
    'property backup imported'
  );
  await ready('#balance-chart-heading');
  assert.deepEqual((await record()).plan, plan);
  await bodyHas('净资产为正，也可能不够支付当期开销');
  checks.push(
    'Existing property and mortgage backup imports unchanged and shows cash/net-worth distinction'
  );

  const active = await record();
  await evaluate(
    `(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('life-ledger');q.onsuccess=()=>r(q.result)});await new Promise((r,j)=>{const tx=db.transaction('plans','readwrite');tx.objectStore('plans').put({...${JSON.stringify(active)},checksum:'injected-corruption'});tx.oncomplete=r;tx.onerror=j});db.close()})()`
  );
  await send('Page.reload');
  await bodyHas('恢复最近快照');
  await scanState('corrupt-record');
  assert.equal(
    await evaluate("!!document.querySelector('#balance-chart-heading')"),
    false
  );
  await textButton('恢复最近快照');
  await ready('#balance-chart-heading');
  assert.deepEqual((await record()).plan, plan);
  checks.push(
    'Corrupted active record is rejected; explicit snapshot restore recovers the intact plan'
  );

  // A real second tab shares the isolated profile and database.
  const target = await send('Target.createTarget', {
    url: `${origin}/plan?tab=overview`,
  });
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const socket = new WebSocket(
    pages.find((p) => p.id === target.targetId).webSocketDebuggerUrl
  );
  await new Promise((r) => socket.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const secondSend = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data),
      p = pending.get(m.id);
    if (m.method === 'Page.javascriptDialogOpening')
      void secondSend('Page.handleJavaScriptDialog', { accept: true });
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(m.error) : p.resolve(m.result);
  });
  const second = async (expression) => {
    const r = await secondSend('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  try {
    await secondSend('Page.enable');
    await waitFor(
      () => second("!!document.querySelector('#actions-heading')"),
      'second tab ready'
    );
    await second(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='比较退休后的自付预算').click()"
    );
    await waitFor(
      () => second("!!document.querySelector('[role=dialog] form')"),
      'second trial'
    );
    await second(
      "document.querySelector('[role=dialog] form').requestSubmit()"
    );
    await waitFor(
      () => second("document.body.innerText.includes('原计划 → 试算后')"),
      'second comparison'
    );
    const baseline = await record();
    await openTrial();
    await textButton('应用到计划');
    await waitFor(
      async () => (await record()).revision > baseline.revision,
      'first tab saved'
    );
    const latest = await record();
    await waitFor(
      () => second("document.body.innerText.includes('另一个标签页更新')"),
      'conflict notification'
    );
    // An external update must expire the already-open trial before it can apply.
    assert.ok(
      await second(
        "document.querySelector('[role=dialog]').textContent.includes('这次试算已过期')"
      )
    );
    await second(
      "document.querySelector('[role=dialog] button[aria-label]').click()"
    );
    await second(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='重试').click()"
    );
    await delay(1000);
    assert.deepEqual(await record(), latest);
    await second(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='读取最新版本').click()"
    );
    await waitFor(
      () =>
        second(
          "!document.body.innerText.includes('另一个标签页更新') && !!document.querySelector('#balance-chart-heading')"
        ),
      'conflict reload'
    );
    checks.push(
      'Two-tab update expires open trial; stale retry cannot overwrite latest plan; reload resolves conflict'
    );
    const replacement = {
      ...plan,
      id: 'replacement-plan',
      name: 'Replacement plan',
    };
    await importText(
      JSON.stringify({
        formatVersion: '1.0.0',
        plan: replacement,
        versions: replacement.versions,
      })
    );
    await waitFor(
      async () => (await record()).id === replacement.id,
      'replacement imported'
    );
    await waitFor(
      () => second("document.body.innerText.includes('另一个标签页更新')"),
      'different plan conflict'
    );
    const replacementSaved = await record();
    await second(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='重试').click()"
    );
    await delay(1000);
    assert.deepEqual(await record(), replacementSaved);
    checks.push(
      'Replacing the active plan with a lower-revision different ID also notifies other tabs and prevents overwrite'
    );
  } finally {
    socket.close();
    await send('Target.closeTarget', { targetId: target.targetId });
  }
  await click('header button[aria-label="更多操作"]');
  await textButton('删除并重新创建');
  await bodyHas('创建你的第一份长期计划');
  await scanState('empty-workspace');
  checks.push(
    'Invalid import, write failure, corrupt record and empty workspace pass mobile-dark and desktop-light accessibility checks'
  );
  return checks;
}
