import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(process.env.TERRAIN_CHECK_URL || 'http://127.0.0.1:6061/', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => !document.body.innerText.includes('Starting terrain editor'),
    undefined, { timeout: 120000 });
  await page.getByRole('button', { name: 'Create terrain' }).first().click();
  await page.getByRole('button', { name: /Choose a procedural template/ }).first().click();
  await page.getByRole('button', { name: 'Create Blank terrain' }).click();
  await page.getByRole('button', { name: 'Terrain', exact: true }).click();
  await page.getByText('Surface', { exact: true }).last().click();
  await page.getByText('Textures', { exact: true }).last().click();
  const source = page.locator('select').filter({ has: page.locator('option[value="pbrLibrary"]') });
  const started = Date.now();
  await source.selectOption('pbrLibrary');
  const status = page.locator('.surface-apply-status');
  await page.waitForFunction(() => /\d+\/\d+ PBR roles ready/.test(
    document.querySelector('.surface-apply-status')?.textContent || '',
  ), undefined, { timeout: 120000 });
  if (await page.getByText('Bake failed', { exact: true }).count()) {
    throw new Error('PBR first load showed Bake failed');
  }
  console.log(JSON.stringify({ firstLoadMs: Date.now() - started, status: await status.innerText() }));
} finally {
  await browser.close();
}
