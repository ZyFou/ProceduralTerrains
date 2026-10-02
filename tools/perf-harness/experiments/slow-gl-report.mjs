export default async function ({ page }) {
  const slow = await page.evaluate(() => window.__slowGL);
  console.log(JSON.stringify(slow, null, 1));
}
