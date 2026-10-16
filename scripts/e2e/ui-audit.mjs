import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function runUiAudit({
  evaluate,
  send,
  ready,
  waitFor,
  origin,
  delay,
}) {
  const packages = await fs.readdir('node_modules/.pnpm');
  const axePackage = packages.find((name) => name.startsWith('axe-core@'));
  assert.ok(
    axePackage,
    'axe-core must be available in the installed dependencies'
  );
  const axe = await fs.readFile(
    `node_modules/.pnpm/${axePackage}/node_modules/axe-core/axe.min.js`,
    'utf8'
  );
  const reports = [];
  const key = async (key, modifiers = 0) => {
    const windowsVirtualKeyCode =
      { Tab: 9, Escape: 27, Enter: 13, ArrowRight: 39 }[key] || 0;
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      modifiers,
      windowsVirtualKeyCode,
      ...(key === 'Enter' ? { text: '\r' } : {}),
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      modifiers,
      windowsVirtualKeyCode,
    });
  };
  async function scan(name, config, screenshot = false) {
    await evaluate(axe);
    const audit = await evaluate(`(async()=>{
      const result=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
      const visible=e=>!!e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
      return {
        violations:result.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),
        incomplete:result.incomplete.map(v=>({id:v.id,count:v.nodes.length})),
        overflow:document.documentElement.scrollWidth>innerWidth+1,
        smallInputs:[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(visible).filter(e=>parseFloat(getComputedStyle(e).fontSize)<16).map(e=>({name:e.name||e.id,font:getComputedStyle(e).fontSize})),
        motion:[...document.getAnimations()].filter(a=>a.playState==='running').length,
      };
    })()`);
    const { nodes } = await send('Accessibility.getFullAXTree');
    const exposed = nodes.filter((n) => !n.ignored);
    const roles = exposed.map((n) => n.role?.value);
    assert.ok(
      roles.includes('main') || roles.includes('dialog'),
      `${name}: accessible main or dialog landmark`
    );
    assert.ok(
      exposed.some((n) => n.role?.value === 'heading' && n.name?.value),
      `${name}: named heading`
    );
    const unnamedButtons = exposed.filter(
      (n) => n.role?.value === 'button' && !n.name?.value
    );
    assert.equal(
      unnamedButtons.length,
      0,
      `${name}: named controls in browser accessibility tree`
    );
    const item = {
      name,
      ...config,
      ...audit,
      accessibilityTree: {
        namedHeadings: exposed.filter(
          (n) => n.role?.value === 'heading' && n.name?.value
        ).length,
        unnamedButtons: unnamedButtons.length,
      },
    };
    reports.push(item);
    if (screenshot) {
      await evaluate('window.scrollTo(0,0)');
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const file = `docs/evidence/ui-${config.locale}-${config.theme}-${config.width}-${name}.png`;
      await fs.writeFile(file, Buffer.from(shot.data, 'base64'));
      item.screenshot = file;
    }
    await fs.writeFile(
      'docs/evidence/ui-audit.json',
      JSON.stringify({ status: 'running', reports }, null, 2)
    );
  }
  const stages = [
    'assets',
    'career',
    'partner',
    'child',
    'housing',
    'parents',
    'retirement',
    'events',
    'advanced',
    'income',
    'living',
    'basics',
  ];
  const showLongTermTrend = async () => {
    await ready('#annual-snapshot-title');
    await evaluate(`(()=>{
      const section=document.querySelector('#annual-snapshot-title').closest('section');
      const button=section.querySelectorAll('[role=group] button')[1];
      if(button?.getAttribute('aria-pressed')!=='true') button?.click();
    })()`);
    await ready('#balance-chart-heading');
  };
  for (const locale of ['zh', 'en']) {
    const copy = JSON.parse(
      await fs.readFile(
        `src/config/locale/messages/${locale}/pages/plans.json`,
        'utf8'
      )
    ).workspace;
    const prefix = locale === 'zh' ? '' : '/en';
    for (const theme of ['light', 'dark'])
      for (const width of [375, 720, 768, 1440]) {
        // 720 CSS pixels exercises the reflow width of 1440px at 200% browser zoom.
        // This does not claim physical browser zoom or screen-reader testing.
        const config = { locale, theme, width, reflow200: width === 720 };
        console.log(`UI audit ${locale} ${theme} ${width}`);
        await send('Emulation.setDeviceMetricsOverride', {
          width,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
        await evaluate(
          `localStorage.setItem('theme',${JSON.stringify(theme)})`
        );
        await send('Page.navigate', { url: `${origin}${prefix}/` });
        await ready('#calculator form');
        await waitFor(
          () =>
            evaluate(
              `document.documentElement.classList.contains(${JSON.stringify(theme)})`
            ),
          'theme applied'
        );
        await delay(300);
        await scan('landing', config);
        await send('Page.navigate', {
          url: `${origin}${prefix}/plan?tab=overview`,
        });
        await showLongTermTrend();
        await ready('header button[aria-label^="Switch to"]');
        for (const target of [theme === 'dark' ? 'light' : 'dark', theme]) {
          await evaluate(
            'document.querySelector(\'header button[aria-label^="Switch to"]\').focus()'
          );
          await key('Enter');
          await delay(100);
          await waitFor(
            () =>
              evaluate(
                `document.documentElement.classList.contains(${JSON.stringify(target)})`
              ),
            'keyboard theme toggle'
          );
          assert.equal(
            await evaluate(
              "document.getAnimations().filter(a=>a.playState==='running').length"
            ),
            0,
            'reduced-motion theme switch has no animation'
          );
        }
        await scan('overview', config, width !== 720);
        await evaluate(
          'document.querySelectorAll(\'main section[aria-labelledby$="chart-heading"] details\').forEach(d=>d.open=true)'
        );
        const chartTree = await send('Accessibility.getFullAXTree');
        assert.ok(
          chartTree.nodes.filter((n) => !n.ignored && n.role?.value === 'table')
            .length >= 2,
          'Both charts expose data tables to assistive technology'
        );
        await evaluate(
          'document.querySelectorAll(\'main section[aria-labelledby$="chart-heading"] details\').forEach(d=>d.open=false)'
        );
        if (width >= 768) {
          await evaluate(
            "document.querySelector('#workspace-tab-overview').focus()"
          );
          await key('ArrowRight');
          await waitFor(
            () =>
              evaluate(
                "document.querySelector('#workspace-tab-plan').getAttribute('aria-selected')==='true' && document.activeElement.id==='workspace-tab-plan'"
              ),
            'keyboard tab navigation'
          );
        }
        for (const section of stages) {
          await evaluate(
            `history.pushState(null,'',${JSON.stringify(`${prefix}/plan?tab=plan&section=${section}`)});window.dispatchEvent(new Event('life-ledger:history-pushed'))`
          );
          await ready('#plan-stage-heading');
          const heading = ['assets', 'income', 'living', 'basics'].includes(
            section
          )
            ? copy.trajectory.stages.now
            : copy.plan.sections[section];
          await waitFor(
            () =>
              evaluate(
                `document.querySelector('#plan-stage-heading')?.textContent===${JSON.stringify(heading)}`
              ),
            `stage ${section}`
          );
          await delay(100);
          await scan(section, config, section === 'career' && width !== 720);
        }
        await evaluate(
          `history.pushState(null,'',${JSON.stringify(`${prefix}/plan?tab=overview`)});window.dispatchEvent(new Event('life-ledger:history-pushed'))`
        );
        await showLongTermTrend();
        const drawers = [
          { name: 'trial', title: copy.actions['retirement-budget'].title },
          { name: 'evidence', title: copy.evidence.open },
        ];
        for (const drawer of drawers) {
          await evaluate(
            `(()=>{const b=[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()===${JSON.stringify(drawer.title)});b.focus();b.click()})()`
          );
          await ready('[role=dialog]');
          await scan(drawer.name, config);
          const visited = new Set();
          for (let i = 0; i < 12; i++) {
            await key('Tab');
            visited.add(
              await evaluate(
                "[...document.querySelectorAll('[role=dialog] *')].indexOf(document.activeElement)"
              )
            );
            assert.ok(
              await evaluate(
                "!!document.activeElement.closest('[role=dialog]')"
              ),
              'dialog traps forward focus'
            );
          }
          assert.ok(
            visited.size > 1,
            'Tab actually moves between dialog controls'
          );
          await key('Tab', 8);
          assert.ok(
            await evaluate("!!document.activeElement.closest('[role=dialog]')"),
            'dialog traps reverse focus'
          );
          await key('Escape');
          await waitFor(
            () => evaluate('!document.querySelector("[role=dialog]")'),
            'escape closes drawer'
          );
          await delay(100);
          const focusRestored = await evaluate(
            `document.activeElement.textContent.trim()===${JSON.stringify(drawer.title)}`
          );
          reports.at(-1).focusRestored = focusRestored;
        }
        await evaluate(
          `history.pushState(null,'',${JSON.stringify(`${prefix}/plan?tab=ledger`)});window.dispatchEvent(new Event('life-ledger:history-pushed'))`
        );
        await ready('main table');
        await scan('ledger', config);
        await evaluate(`(()=>{
          const b=[...document.querySelectorAll('main button')].find(b=>/^20\\d{2}/.test(b.textContent.trim()) && b.getClientRects().length);
          b.dataset.auditYearTrigger='true';b.focus();b.click();
        })()`);
        await ready('[role=dialog]');
        await evaluate(
          "document.querySelector('[role=dialog] details').open=true"
        );
        await scan('year-detail', config);
        await key('Tab');
        assert.ok(
          await evaluate("!!document.activeElement.closest('[role=dialog]')")
        );
        await key('Tab', 8);
        assert.ok(
          await evaluate("!!document.activeElement.closest('[role=dialog]')")
        );
        await key('Escape');
        await waitFor(
          () => evaluate('!document.querySelector("[role=dialog]")'),
          'year drawer closes'
        );
        await delay(100);
        reports.at(-1).focusRestored = await evaluate(
          "document.activeElement.dataset.auditYearTrigger==='true'"
        );
      }
  }
  const result = {
    status: reports.some(
      (r) =>
        r.violations.length ||
        r.overflow ||
        r.focusRestored === false ||
        (r.width === 375 && r.smallInputs.length)
    )
      ? 'issues-found'
      : 'passed',
    reports,
  };
  await fs.writeFile(
    path.resolve('docs/evidence/ui-audit.json'),
    JSON.stringify(result, null, 2)
  );
  return {
    status: result.status,
    screens: reports.length,
    violations: reports.reduce((n, r) => n + r.violations.length, 0),
  };
}
