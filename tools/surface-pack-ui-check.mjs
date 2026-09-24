import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/@vite/client', (route) => route.fulfill({
    body: 'export const injectQuery=(url)=>url; export const createHotContext=()=>({on(){},accept(){},dispose(){}});',
    contentType: 'text/javascript',
  }));
  await page.goto('http://127.0.0.1:6064/tools/surface-qa.html');
  await page.evaluate(async () => {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/src/styles.css';
    document.head.append(stylesheet);
    document.body.innerHTML = '<div id="app"><div id="surface-panel"></div></div>';
    document.body.style.margin = '0';
    document.body.style.background = '#11141b';
    const container = document.querySelector('#surface-panel');
    container.style.cssText = 'width:320px;padding:12px;box-sizing:border-box;background:var(--bg-panel);';
    const React = await import('/node_modules/.vite/deps/react.js');
    const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { default: SurfacePackPanel } = await import('/src/components/ui/SurfacePackPanel.jsx');
    (ReactDOM.createRoot || ReactDOM.default.createRoot)(container).render((React.createElement || React.default.createElement)(SurfacePackPanel, {
      ctx: { params: { surfaceDocument: {} }, onParam: () => {} },
    }));
  });
  await page.locator('.surface-pack-role').first().waitFor({ timeout: 5000 }).catch(async (error) => {
    throw new Error(`${error.message}\n${errors.join('\n')}\n${(await page.locator('#surface-panel').innerHTML()).slice(0, 800)}`);
  });
  const result = await page.evaluate(() => {
    const panel = document.querySelector('#surface-panel');
    const controls = [...panel.querySelectorAll('select')];
    const panelRect = panel.getBoundingClientRect();
    return {
      controls: controls.length,
      selectBackground: getComputedStyle(controls[0]).backgroundColor,
      pickerBackground: getComputedStyle(panel.querySelector('.file-picker-btn')).backgroundColor,
      overflowingControls: controls.filter((select) => select.getBoundingClientRect().right > panelRect.right).length,
      panelScrollWidth: panel.scrollWidth,
      panelWidth: panel.clientWidth,
    };
  });
  await fs.mkdir('output/surface-qa', { recursive: true });
  await page.locator('#surface-panel').screenshot({ path: 'output/surface-qa/panel.png' });
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  if (errors.length || result.controls !== 15 || result.overflowingControls || result.panelScrollWidth > result.panelWidth) process.exitCode = 1;
} finally {
  await browser.close();
}
