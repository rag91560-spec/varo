const { chromium } = require('C:\\Users\\USER\\Desktop\\x-warmup\\node_modules\\playwright');
const path = require('path');

const PROFILE = path.join(__dirname, 'profiles', 'fanbox-profile');
const BANNER_IMG = path.join(__dirname, 'fanbox', 'fanbox-banner-5000.png');
const FANCARD_IMG = path.join(__dirname, 'fanbox', 'fanbox-fancard-5000.png');

async function run() {
  console.log('Launching stealth Chrome...');
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });

  // Hide webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // Navigate to fanbox creator plans page
    console.log('Navigating to Fanbox plans...');
    await page.goto('https://www.fanbox.cc/manage/plans', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Take screenshot to see current state
    await page.screenshot({ path: path.join(__dirname, 'fanbox-plans-current.png') });
    console.log('Screenshot saved: fanbox-plans-current.png');
    console.log('Page title:', await page.title());
    console.log('Page URL:', page.url());

    // Look for the 5000 or 3000 plan (it might show old or new price depending on if already changed)
    const pageContent = await page.content();

    // Find all plan edit links/buttons
    const planLinks = await page.locator('a[href*="plans"]').all();
    console.log(`Found ${planLinks.length} plan links`);

    // Try to find the lifetime/5000 plan edit button
    // Fanbox plan management usually has edit buttons per plan
    const editButtons = await page.locator('button, a').filter({ hasText: /編集|edit/i }).all();
    console.log(`Found ${editButtons.length} edit buttons`);

    // Let's look at what's on the page
    const snapshot = await page.accessibility.snapshot();
    console.log('Accessibility tree (top level):', JSON.stringify(snapshot?.children?.map(c => c.name || c.role).slice(0, 20)));

  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: path.join(__dirname, 'fanbox-error.png') });
  }

  // Keep browser open for inspection
  console.log('\nBrowser stays open. Press Ctrl+C to close.');
  await new Promise(() => {}); // Keep alive
}

run().catch(console.error);
