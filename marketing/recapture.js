const { chromium } = require('C:\\Users\\USER\\Desktop\\x-warmup\\node_modules\\playwright');
const path = require('path');

async function capture() {
  const browser = await chromium.launch();
  const dir = __dirname;

  const jobs = [
    // Fanbox banners (1200x440)
    { html: 'fanbox/fanbox-banner-5000.html', out: 'fanbox/fanbox-banner-5000.png', w: 1200, h: 440 },
    // Fanbox fancards (960x540)
    { html: 'fanbox/fanbox-fancard-5000.html', out: 'fanbox/fanbox-fancard-5000.png', w: 960, h: 540 },
    // Patreon banners (1200x440)
    { html: 'patreon/patreon-banner-lifetime.html', out: 'patreon/patreon-banner-lifetime.png', w: 1200, h: 440 },
    // Patreon cards
    { html: 'patreon/patreon-card-lifetime.html', out: 'patreon/patreon-card-lifetime.png', w: 960, h: 540 },
    // Patreon covers
    { html: 'patreon/patreon-cover-lifetime.html', out: 'patreon/patreon-cover-lifetime.png', w: 1600, h: 400 },
  ];

  for (const job of jobs) {
    const page = await browser.newPage({ viewport: { width: job.w, height: job.h } });
    const htmlPath = path.join(dir, job.html);
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(dir, job.out), type: 'png' });
    console.log('Saved', job.out);
    await page.close();
  }

  await browser.close();
  console.log('Done!');
}

capture().catch(console.error);
