const { chromium } = require('C:\\Users\\USER\\Desktop\\x-warmup\\node_modules\\playwright');
const path = require('path');

const PROFILE = path.join(__dirname, 'profiles', 'patreon-profile');
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
    // Go to membership page
    console.log('Navigating to membership...');
    await page.goto('https://www.patreon.com/rag91560/membership', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Step 1: Click the Lifetime Plan "수정" button (3rd one)
    console.log('Step 1: Clicking Lifetime Plan edit...');
    const editBtns = page.locator('text=수정');
    const editCount = await editBtns.count();
    console.log(`Found ${editCount} edit buttons`);

    // Click the last 수정 (Lifetime plan)
    await editBtns.nth(editCount - 1).click();
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(__dirname, 'patreon-edit-page.png'), fullPage: true });
    console.log('Edit page screenshot saved');

    // Check if price is editable
    const inputs = page.locator('input');
    const inputCount = await inputs.count();
    for (let i = 0; i < inputCount; i++) {
      const type = await inputs.nth(i).getAttribute('type').catch(() => '');
      const val = await inputs.nth(i).inputValue().catch(() => '');
      const disabled = await inputs.nth(i).isDisabled().catch(() => false);
      const placeholder = await inputs.nth(i).getAttribute('placeholder').catch(() => '');
      console.log(`  Input ${i}: type=${type}, value="${val}", disabled=${disabled}, placeholder="${placeholder}"`);
    }

    // Check for price field specifically
    const priceInputs = page.locator('input').filter({ hasText: /50/ });
    console.log(`Price-like inputs: ${await priceInputs.count()}`);

  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: path.join(__dirname, 'patreon-error.png') });
  }

  await context.close();
}

run().catch(console.error);
