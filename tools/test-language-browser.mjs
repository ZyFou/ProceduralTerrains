// Start Vite first, then run: node tools/test-language-browser.mjs
// Uses a fresh browser context and mocked API responses; no account is required.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route('**/api/**', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(route.request().url().includes('/auth/session') ? { user: null } : { ok: true, projects: [] }),
}));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const base = process.env.LANGUAGE_TEST_URL || 'http://127.0.0.1:6061';
const switchButton = page.locator('.lp-nav .language-switch');

try {
  await page.goto(`${base}/#login`);
  await switchButton.waitFor();
  assert.equal(await page.locator('#auth-title').innerText(), 'Welcome back');
  await page.locator('input[name="identifier"]').fill('Water');
  await page.locator('input[name="password"]').fill('my-test-password');
  await page.locator('canvas').first().waitFor({ state: 'attached' });
  await page.evaluate(() => { window.languageTestCanvas = document.querySelector('canvas'); });
  await switchButton.click();
  await page.waitForFunction(() => document.documentElement.lang === 'fr');
  assert.equal(await page.locator('#auth-title').innerText(), 'Heureux de vous retrouver');
  assert.equal(await switchButton.innerText(), 'EN');
  assert.equal(await page.locator('#topbar .language-switch').innerText(), 'EN');
  assert.equal(await page.locator('input[name="identifier"]').inputValue(), 'Water');
  assert.equal(await page.locator('input[name="password"]').inputValue(), 'my-test-password');
  assert.ok(await page.evaluate(() => window.languageTestCanvas === document.querySelector('canvas')), 'language switch must preserve the canvas');

  for (const [hash, expected] of [
    ['blender', 'Vos terrains, directement dans Blender.'],
    ['unity', 'Créez des terrains, directement dans Unity.'],
    ['confidentiality', 'Confidentialité et vie privée'],
    ['register', 'Créez votre compte'],
  ]) {
    await page.evaluate((value) => { location.hash = value; }, hash);
    await page.waitForFunction((text) => [...document.querySelectorAll('h1')].some((node) => node.textContent.replace(/\s+/g, ' ').trim() === text), expected);
  }
  await page.reload();
  await switchButton.waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'fr');
  assert.equal(await page.locator('#auth-title').innerText(), 'Créez votre compte');

  const otherTab = await context.newPage();
  await otherTab.goto(`${base}/#login`);
  await otherTab.locator('.lp-nav .language-switch').click();
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  assert.equal(await page.locator('#auth-title').innerText(), 'Create your account');
  await otherTab.close();

  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await switchButton.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, 'language switch must fit the mobile header');
  await switchButton.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.documentElement.lang === 'fr');
  assert.equal(await page.locator('#auth-title').innerText(), 'Créez votre compte');
  assert.deepEqual(errors, []);
  console.log('Language browser checks passed: FR/EN, shared headers, unchanged inputs/canvas, pages, persistence, cross-tab sync and mobile keyboard access.');
} finally {
  await browser.close();
}
