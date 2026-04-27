const { chromium } = require('C:\\Users\\USER\\Desktop\\x-warmup\\node_modules\\playwright');
const path = require('path');

async function screenshot(htmlFile, pngFile, width, height) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto('file:///' + htmlFile.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
  await page.screenshot({ path: pngFile, clip: { x: 0, y: 0, width, height } });
  await browser.close();
  console.log(`Done: ${path.basename(pngFile)} (${width}x${height})`);
}

async function run() {
  const dir = path.join(__dirname, 'patreon');

  // Cover images (460x200)
  await screenshot(
    path.join(dir, 'patreon-cover-lifetime.html'),
    path.join(dir, 'patreon-cover-lifetime.png'),
    460, 200
  );
  await screenshot(
    path.join(dir, 'patreon-cover-monthly.html'),
    path.join(dir, 'patreon-cover-monthly.png'),
    460, 200
  );
  await screenshot(
    path.join(dir, 'patreon-cover-yearly.html'),
    path.join(dir, 'patreon-cover-yearly.png'),
    460, 200
  );

  // Card images (600x315 - Patreon card size)
  await screenshot(
    path.join(dir, 'patreon-card-lifetime.html'),
    path.join(dir, 'patreon-card-lifetime.png'),
    600, 315
  );

  // Banner images (1600x400)
  await screenshot(
    path.join(dir, 'patreon-banner-lifetime.html'),
    path.join(dir, 'patreon-banner-lifetime.png'),
    1600, 400
  );

  console.log('All Patreon images re-captured!');
}

run().catch(console.error);
