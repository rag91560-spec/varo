const { chromium } = require('C:\\Users\\USER\\Desktop\\x-warmup\\node_modules\\playwright');
const path = require('path');

async function capture() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 520, height: 400 } });

  const htmlPath = path.join(__dirname, 'tiers.html');
  await page.goto(`file://${htmlPath}`);
  await page.waitForTimeout(1000);

  const ids = [
    'fanbox-monthly', 'fanbox-yearly', 'fanbox-lifetime',
    'patreon-monthly', 'patreon-yearly', 'patreon-lifetime'
  ];

  for (const id of ids) {
    const el = page.locator(`#${id}`);
    await el.screenshot({ path: path.join(__dirname, `${id}.png`), scale: 'device' });
    console.log(`Saved ${id}.png`);
  }

  await browser.close();
  console.log('Done!');
}

capture().catch(console.error);
