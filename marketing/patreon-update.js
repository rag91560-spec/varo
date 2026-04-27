const { chromium } = require('C:\\Users\\USER\\Desktop\\x-warmup\\node_modules\\playwright');
const path = require('path');

const PROFILE = path.join(__dirname, 'profiles', 'patreon-profile');
const BANNER_IMG = path.join(__dirname, 'patreon', 'patreon-banner-lifetime.png');
const COVER_IMG = path.join(__dirname, 'patreon', 'patreon-cover-lifetime.png');

async function run() {
  console.log('Launching Chrome...');
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // Step 1: Go to Patreon membership/tiers page
    console.log('Step 1: Navigating to Patreon tiers...');
    await page.goto('https://www.patreon.com/rag91560/membership', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    await page.screenshot({ path: path.join(__dirname, 'patreon-current.png'), fullPage: true });
    console.log('Current state screenshot saved');
    console.log('Page title:', await page.title());
    console.log('Page URL:', page.url());

    // Check if logged in
    const bodyText = await page.textContent('body').catch(() => '');
    if (bodyText.includes('Log in') || bodyText.includes('Sign up')) {
      console.log('NOT LOGGED IN');
      await context.close();
      return;
    }
    console.log('Logged in!');

    // Take screenshot of the page to understand layout
    console.log('\n=== Check patreon-current.png to see current state ===');

  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: path.join(__dirname, 'patreon-error.png') });
  }

  await context.close();
}

run().catch(console.error);
