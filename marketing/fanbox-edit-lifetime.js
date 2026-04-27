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

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // Go to plan management
    console.log('Navigating to plans...');
    await page.goto('https://www.fanbox.cc/manage/plans', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Scroll down to find the Lifetime plan (3rd plan)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // Click the 3rd "편집하기" button (Lifetime plan)
    const editButtons = page.locator('text=편집하기');
    const count = await editButtons.count();
    console.log(`Found ${count} edit buttons`);

    if (count >= 3) {
      await editButtons.nth(2).click(); // 3rd = lifetime
      console.log('Clicked Lifetime plan edit button');
      await page.waitForTimeout(3000);

      await page.screenshot({ path: path.join(__dirname, 'fanbox-edit-page.png') });
      console.log('Edit page screenshot saved');

      // Now we need to:
      // 1. Change the price from 5000 to 3000
      // 2. Replace the banner image
      // 3. Replace the fancard image
      // 4. Save

      // Look for price input
      const priceInput = page.locator('input[type="number"], input[name*="price"], input[name*="fee"]').first();
      if (await priceInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        const currentPrice = await priceInput.inputValue();
        console.log('Current price:', currentPrice);
        await priceInput.fill('3000');
        console.log('Price changed to 3000');
      } else {
        console.log('Price input not found directly, checking page...');
        // Try finding by value
        const inputs = page.locator('input');
        const inputCount = await inputs.count();
        for (let i = 0; i < inputCount; i++) {
          const val = await inputs.nth(i).inputValue().catch(() => '');
          const type = await inputs.nth(i).getAttribute('type').catch(() => '');
          console.log(`  Input ${i}: type=${type}, value="${val}"`);
        }
      }

      // Look for image upload areas - take full page screenshot first
      await page.screenshot({ path: path.join(__dirname, 'fanbox-edit-full.png'), fullPage: true });
      console.log('Full edit page screenshot saved');

      // Find file inputs for image upload
      const fileInputs = page.locator('input[type="file"]');
      const fileCount = await fileInputs.count();
      console.log(`Found ${fileCount} file inputs`);

      if (fileCount >= 1) {
        // Upload banner image (usually first file input)
        await fileInputs.nth(0).setInputFiles(BANNER_IMG);
        console.log('Banner image uploaded');
        await page.waitForTimeout(2000);
      }

      if (fileCount >= 2) {
        // Upload fancard image (usually second file input)
        await fileInputs.nth(1).setInputFiles(FANCARD_IMG);
        console.log('Fancard image uploaded');
        await page.waitForTimeout(2000);
      }

      await page.screenshot({ path: path.join(__dirname, 'fanbox-after-upload.png'), fullPage: true });
      console.log('After upload screenshot saved');

      // Don't save yet - let user verify
      console.log('\n=== Review the browser and press Ctrl+C when done ===');

    } else {
      console.log('Could not find 3 edit buttons');
    }

  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: path.join(__dirname, 'fanbox-error.png') });
  }

  await new Promise(() => {}); // Keep alive
}

run().catch(console.error);
