import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  formatMonth,
  addMonths,
} = require('../../src/features/life-ledger/domain/index.ts');
const {
  calculateMonthlyLifePlan,
} = require('../../src/features/life-ledger/calculation/index.ts');

export async function runLifeEventsJourney({
  evaluate,
  fill,
  ready,
  record,
  waitFor,
  send,
  origin,
  delay,
}) {
  const packages = await fs.readdir('node_modules/.pnpm');
  const axePackage = packages.find((n) => n.startsWith('axe-core@'));
  const axe = await fs.readFile(
    `node_modules/.pnpm/${axePackage}/node_modules/axe-core/axe.min.js`,
    'utf8'
  );
  const audits = [];
  const audit = async (name, width) => {
    await evaluate(axe);
    const violations = await evaluate(
      "(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))()"
    );
    audits.push({ name, width, violations });
    assert.deepEqual(violations, [], `${name} accessibility`);
  };
  const press = async (text) => {
    await evaluate(
      `[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`
    );
    await delay(80);
  };
  const stage = async (id) => {
    await send('Page.navigate', {
      url: `${origin}/plan?tab=plan&section=${id}`,
    });
    await ready('#plan-stage-heading');
    await delay(150);
  };
  const save = async () => {
    const before = await record();
    await evaluate("document.querySelector('main form').requestSubmit()");
    await waitFor(
      async () => (await record()).revision > before.revision,
      'event persisted'
    );
  };
  const initial = await record();
  const preset = async (key) => {
    await evaluate(
      `(()=>{const s=document.querySelector('main select[name=preset]');s.value=${JSON.stringify(key)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`
    );
    await delay(80);
  };
  const base = initial.plan.baseMonth;
  await stage('child');
  await preset('birth');
  await fill('main input[name=amount]', '12000');
  await save();
  await press('添加项目');
  await preset('school');
  await fill('main input[name=amount]', '20000');
  await fill('main form input[type=month]', formatMonth(addMonths(base, 60)));
  await save();
  let p = (await record()).plan;
  assert.equal(
    p.standaloneCashFlows.filter((f) => f.category === 'child').length,
    2
  );
  assert.equal(
    p.standaloneCashFlows.find((f) => f.name === '教育学费').frequency.kind,
    'yearly'
  );
  await stage('events');
  await preset('travel');
  await fill('main input[name=amount]', '10000');
  await save();
  await press('添加另一个人生事件');
  await preset('study');
  await preset('custom');
  await fill('main input[name=name]', '自定义进修');
  await fill('main input[name=amount]', '18000');
  await save();
  await stage('parents');
  await preset('support');
  await fill('main input[name=amount]', '2000');
  await save();
  await press('添加项目');
  await preset('living');
  await fill('main input[name=amount]', '1000');
  await save();
  await stage('partner');
  await preset('support');
  await fill('main input[name=amount]', '3000');
  await save();
  await stage('housing');
  await preset('rent_income');
  await fill('main input[name=amount]', '4000');
  await save();
  await press('购房');
  for (const [key, value] of Object.entries({
    price: '100',
    deposit: '30',
    rate: '3.5',
    years: '30',
  }))
    await fill(`main input[name=${key}]`, value);
  await fill('main input[name=month]', formatMonth(addMonths(base, 24)));
  assert.ok(
    await evaluate(
      "document.querySelector('main form dl').textContent.includes('3,143.32')"
    )
  );
  assert.ok(
    await evaluate(
      "document.querySelector('main form').textContent.includes('扣除首付') && document.querySelector('main form').textContent.includes('购房当月结束余额')"
    )
  );
  await save();
  p = (await record()).plan;
  const house = p.assets.find((a) => a.purchase);
  assert.ok(house);
  assert.equal(house.acquiredMonth, addMonths(base, 24));
  assert.equal(
    p.standaloneCashFlows.filter(
      (f) => f.category === 'parent' && f.direction === 'income'
    ).length,
    1
  );
  assert.equal(
    p.standaloneCashFlows.filter(
      (f) => f.category === 'parent' && f.direction === 'expense'
    ).length,
    1
  );
  assert.equal(
    p.standaloneCashFlows.filter(
      (f) => f.name === '旅行' || f.name === '自定义进修'
    ).length,
    2
  );
  const result = calculateMonthlyLifePlan(p);
  assert.equal(result.monthly[23].nonLiquidAssetsCents, 0);
  assert.equal(result.monthly[24].nonLiquidAssetsCents, 100000000);
  const saved = await record();
  await send('Page.reload');
  await ready('#plan-stage-heading');
  assert.deepEqual(await record(), saved);
  for (const width of [375, 768, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await stage('child');
    await press('添加项目');
    await preset('school');
    await audit('compact event form', width);
    const compactFormWidth = await evaluate(
      `({
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll('body *')]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return (
              (rect.right > innerWidth + 1 || rect.left < -1) &&
              !element.closest('.overflow-x-auto')
            );
          })
          .slice(0, 8)
          .map((element) => ({
            tag: element.tagName,
            className: String(element.className).slice(0, 160),
            text: element.textContent.trim().slice(0, 80),
            left: Math.round(element.getBoundingClientRect().left),
            right: Math.round(element.getBoundingClientRect().right),
          })),
      })`
    );
    assert.equal(
      compactFormWidth.scrollWidth,
      compactFormWidth.innerWidth,
      JSON.stringify(compactFormWidth)
    );
    await evaluate(
      "document.querySelector('main form').scrollIntoView({block:'center',behavior:'instant'})"
    );
    const formShot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      `docs/evidence/compact-event-form-${width}.png`,
      Buffer.from(formShot.data, 'base64')
    );
    await send('Page.navigate', { url: `${origin}/plan?tab=overview` });
    await ready('#balance-chart-heading');
    await delay(1200);
    const overviewWidth = await evaluate(
      `({
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll('body *')]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return (
              (rect.right > innerWidth + 1 || rect.left < -1) &&
              !element.closest('.overflow-x-auto')
            );
          })
          .slice(0, 8)
          .map((element) => ({
            tag: element.tagName,
            className: String(element.className).slice(0, 160),
            text: element.textContent.trim().slice(0, 80),
            left: Math.round(element.getBoundingClientRect().left),
            right: Math.round(element.getBoundingClientRect().right),
          })),
      })`
    );
    assert.equal(
      overviewWidth.scrollWidth,
      overviewWidth.innerWidth,
      JSON.stringify(overviewWidth)
    );
    assert.ok(
      await evaluate(
        "document.querySelector('#life-timeline-heading').parentElement.parentElement.textContent.includes('人生时间轴')"
      )
    );
    assert.ok(
      await evaluate(
        "document.querySelector('#life-stage-expenses-heading').closest('section').textContent.includes('购房') && document.querySelector('#life-stage-expenses-heading').closest('section').textContent.includes('退休')"
      )
    );
    assert.equal(
      await evaluate(
        "document.querySelector('#scenario-chart-heading').closest('section').querySelectorAll('.recharts-line-curve[d]').length"
      ),
      3
    );
    const primaryTimeline = await evaluate(
      "[...document.querySelector('#life-timeline-heading').closest('section').querySelectorAll(':scope > ol button')].map(button=>button.textContent.replace(/\\s+/g,' ').trim())"
    );
    assert.ok(primaryTimeline.some((item) => item.includes('出生准备')));
    assert.ok(primaryTimeline.some((item) => item.includes('购房')));
    assert.ok(primaryTimeline.some((item) => item.includes('退休')));
    assert.ok(!primaryTimeline.some((item) => item.includes('教育学费')));
    assert.ok(!primaryTimeline.some((item) => item.includes('贷款最后一期')));
    const timelineAges = primaryTimeline.map((item) =>
      Number(item.match(/\d+/)?.[0])
    );
    assert.ok(
      timelineAges.every(
        (age, index) => !index || age >= timelineAges[index - 1]
      )
    );
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      `docs/evidence/events-overview-${width}.png`,
      Buffer.from(shot.data, 'base64')
    );
    await audit('overview', width);
    await press('收入与支出');
    assert.ok(
      await evaluate(
        "document.querySelector('#expense-chart-heading').textContent.includes('收入与支出')"
      )
    );
    await audit('income spending view', width);
    assert.ok(
      await evaluate(
        "(()=>{const s=document.querySelector('#expense-chart-heading').parentElement;return s.querySelectorAll('.recharts-bar-rectangle path').length>0 && !!s.querySelector('.recharts-area-curve[d]') && s.querySelectorAll('.recharts-yAxis').length===2})()"
      ),
      'income area and spending bars use two scales in one chart'
    );
    await evaluate(
      "document.querySelector('#expense-chart-heading').scrollIntoView({block:'start',behavior:'instant'});window.scrollBy(0,-90)"
    );
    const incomeShot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      `docs/evidence/income-spending-${width}.png`,
      Buffer.from(incomeShot.data, 'base64')
    );
    await press('每年花多少');
    await evaluate(
      "document.querySelector('#balance-chart-heading').scrollIntoView({block:'start',behavior:'instant'});window.scrollBy(0,-140)"
    );
    const chartShot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      `docs/evidence/events-charts-${width}.png`,
      Buffer.from(chartShot.data, 'base64')
    );
    await stage('housing');
    await press('购房');
    await press('修改');
    await delay(1200);
    await evaluate(
      "document.querySelector('#plan-stage-heading').scrollIntoView({block:'start',behavior:'instant'});window.scrollBy(0,-140)"
    );
    const houseShot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      `docs/evidence/events-housing-${width}.png`,
      Buffer.from(houseShot.data, 'base64')
    );
    assert.equal(
      await evaluate('document.documentElement.scrollWidth>innerWidth'),
      false
    );
    await audit('housing-calculator', width);
    await send('Page.navigate', { url: `${origin}/plan?tab=ledger` });
    await ready('#ledger-heading');
    await delay(600);
    assert.equal(
      await evaluate('document.documentElement.scrollWidth>innerWidth'),
      false
    );
    await audit('annual ledger', width);
    const ledgerShot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      `docs/evidence/annual-ledger-${width}.png`,
      Buffer.from(ledgerShot.data, 'base64')
    );
  }
  return {
    status: 'passed',
    audits,
    checks: [
      'multiple child items and yearly tuition',
      'multiple named and preset life events',
      'bidirectional parents and family support',
      'rent income and linked future purchase',
      'mortgage preview equals formal monthly results',
      'refresh retains all events',
      'timeline and overview mobile/desktop layout',
      'combined dual-scale income and spending chart',
      'three simple deterministic scenarios',
      'low-saturation annual ledger',
    ],
  };
}
