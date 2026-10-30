import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  calculateMonthlyLifePlan,
} = require('../../src/features/life-ledger/calculation/index.ts');
const {
  formatMonth,
  addMonths,
} = require('../../src/features/life-ledger/domain/index.ts');
const {
  PERSONA_INPUTS,
} = require('../../src/features/life-ledger/analysis/personas.ts');

export async function runPersonaJourneys(api) {
  const {
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
  } = api;
  const reports = [];
  const buttonText = (text, root = 'main') =>
    evaluate(
      `[...document.querySelectorAll(${JSON.stringify(root + ' button')})].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`
    );
  const select = async (selector, value) => {
    await evaluate(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`
    );
    await delay(50);
  };
  const tab = async (id) => {
    if (await evaluate('innerWidth<768'))
      await buttonText({ analysis: '分析', plan: '规划' }[id], 'nav.fixed');
    else await click(`#workspace-tab-${id}`);
    await selected(id);
  };
  const stage = async (id, label) => {
    await tab('plan');
    if (await evaluate('innerWidth<768')) await select('main nav select', id);
    else
      await evaluate(
        `[...document.querySelectorAll('main nav button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`
      );
    await waitFor(
      () =>
        evaluate(
          `document.querySelector('#plan-stage-heading')?.textContent===${JSON.stringify(label)}`
        ),
      label
    );
  };
  const showLongTermTrend = async () => {
    await ready('#annual-snapshot-title');
    await evaluate(`(()=>{
      const section=document.querySelector('#annual-snapshot-title').closest('section');
      const button=section.querySelectorAll('[role=group] button')[1];
      if(button?.getAttribute('aria-pressed')!=='true') button?.click();
    })()`);
    await ready('#balance-chart-heading');
  };
  const submit = async () => {
    const before = await record();
    await evaluate("document.querySelector('main form').requestSubmit()");
    await waitFor(
      async () => (await record()).revision > before.revision,
      'save form'
    );
  };
  const career = async (kind, amount, start, end, growth) => {
    await stage('career', '职业发展');
    await click(`#career-tab-${kind}`);
    await ready('main form');
    if (kind !== 'break') await fill('main input[name=amount]', String(amount));
    await fill('main input[name=start]', start);
    await fill('main input[name=end]', end);
    if (growth !== undefined)
      await fill('main input[name=job-growth]', String(growth));
    await submit();
  };
  const event = async (
    id,
    label,
    amount,
    start,
    end,
    { direction = 'expense', once = false, additional = false } = {}
  ) => {
    await stage(id, label);
    if (additional) await buttonText('添加项目');
    await ready('main form');
    await evaluate(
      "document.querySelectorAll('main form select').forEach(el=>{if(el.querySelector('option[value=income]'))el.dataset.e2eSelect='direction';if(el.querySelector('option[value=once]'))el.dataset.e2eSelect='frequency'})"
    );
    if (id === 'partner')
      await select('main select[data-e2e-select=direction]', direction);
    await fill('main input[name=amount]', String(amount));
    if (once) await select('main select[data-e2e-select=frequency]', 'once');
    await evaluate(
      "document.querySelectorAll('main form input[type=month]').forEach((el,i)=>el.dataset.e2eMonth=String(i))"
    );
    await fill('main input[data-e2e-month="0"]', start);
    await delay(50);
    if (!once) await fill('main input[data-e2e-month="1"]', end);
    await delay(50);
    await submit();
  };
  for (const p of PERSONA_INPUTS) {
    console.log(`Persona ${p.id}: start`);
    await send('Emulation.setDeviceMetricsOverride', {
      width: ['zhao', 'tang'].includes(p.id)
        ? 375
        : p.id === 'zhou'
          ? 768
          : 1440,
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
    await evaluate(
      "document.querySelectorAll('#calculator input[type=number]').forEach((el,i)=>el.dataset.e2eField=String(i))"
    );
    for (const [i, value] of [
      p.age,
      60,
      90,
      p.cash,
      p.income,
      p.expense,
      p.retirement,
    ].entries())
      await fill(`[data-e2e-field="${i}"]`, String(value));
    await delay(50);
    await delay(500);
    await click('#calculator button[type=submit]');
    await ready('#calculator-continue');
    await click('#calculator-continue');
    await ready('#workspace-tab-plan');
    const initial = await record(),
      base = initial.plan.baseMonth;
    const month = (n) => formatMonth(addMonths(base, n));
    const retireEnd = formatMonth(addMonths(initial.plan.retirementMonth, -1));
    assert.equal(
      initial.plan.assets
        .filter((a) => a.liquid)
        .reduce((s, a) => s + a.openingBalanceCents, 0),
      p.cash * 1e6
    );
    if (p.id === 'chen' || p.id === 'tang') {
      await stage('career', '职业发展');
      await fill('main input[name=growth]', p.id === 'chen' ? '3' : '-1');
      await delay(50);
      await submit();
    }
    if (p.id === 'chen') {
      await career('salary', 25000, month(24), retireEnd, 2);
      await career('side_income', 3000, month(0), month(59));
    }
    if (p.id === 'zhou') {
      await event('partner', '伴侣', 2000, month(0), month(335), {
        direction: 'income',
      });
      await event('partner', '伴侣', 3000, month(0), month(335), {
        additional: true,
      });
      await event('child', '孩子', 4000, month(24), month(239));
    }
    if (p.id === 'xu') {
      await event('housing', '住房', 800000, month(24), month(24), {
        once: true,
      });
      await event('child', '孩子', 5000, month(24), month(239));
    }
    if (p.id === 'zhao')
      await event('parents', '父母', 3000, month(0), month(95));
    if (p.id === 'tang') {
      await career('side_income', 2000, month(0), retireEnd);
      await career('break', 0, month(12), month(17));
    }
    const saved = await record();
    const result = calculateMonthlyLifePlan(saved.plan);
    if (p.id === 'chen') {
      assert.equal(result.monthly[24].incomeCents, 2800000);
      assert.equal(result.monthly[36].incomeCents, 2850000);
    }
    if (p.id === 'zhou') {
      assert.equal(result.monthly[0].incomeCents, 2200000);
      assert.equal(result.monthly[0].expenseCents, 1300000);
      assert.equal(result.monthly[24].expenseCents, 1700000);
    }
    if (p.id === 'xu') assert.equal(result.monthly[24].expenseCents, 81700000);
    if (p.id === 'zhao') {
      assert.equal(result.monthly[36].incomeCents, 0);
      assert.equal(result.monthly[36].expenseCents, 1000000);
    }
    if (p.id === 'tang') {
      assert.equal(result.monthly[12].incomeCents, 200000);
      assert.ok(result.monthly[18].incomeCents > 1600000);
    }
    await tab('analysis');
    await showLongTermTrend();
    assert.equal(
      await evaluate('document.documentElement.scrollWidth>innerWidth'),
      false
    );
    await evaluate(
      "document.querySelector('#balance-chart-heading').parentElement.querySelector('details').open=true"
    );
    const ending = new Intl.NumberFormat('zh', {
      maximumFractionDigits: 2,
    }).format(result.summary.endingAvailableCents / 100);
    assert.ok(
      await evaluate(
        `document.querySelector('#balance-chart-heading').parentElement.querySelector('tbody tr:last-child').textContent.includes(${JSON.stringify(ending)})`
      )
    );
    assert.deepEqual((await record()).plan, saved.plan);
    await tab('analysis');
    await ready('#annual-snapshot-title');
    const final = await record();
    await send('Page.reload');
    await ready('#workspace-tab-analysis');
    await selected('analysis');
    assert.deepEqual((await record()).plan, final.plan);
    assert.equal((await record()).revision, final.revision);
    reports.push({
      persona: p.id,
      events: saved.plan.standaloneCashFlows.length,
      endingCents: result.summary.endingAvailableCents,
      status: 'passed',
      checks: [
        'landing',
        'life-events',
        'monthly-boundaries',
        'analysis-charts',
        'reload',
        'analysis-does-not-mutate-plan',
      ],
    });
    console.log(`Persona ${p.id}: passed`);
  }
  return reports;
}
