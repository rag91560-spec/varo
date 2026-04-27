const { chromium } = require('C:\\Users\\USER\\Desktop\\x-warmup\\node_modules\\playwright');
const path = require('path');

const PROFILE = path.join(__dirname, 'profiles', 'fanbox-profile');

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
    // Go to plan management
    console.log('Navigating to plans...');
    await page.goto('https://www.fanbox.cc/manage/plans', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Click the 4th edit button (5000엔 plan is now 4th)
    const editButtons = page.locator('text=편집하기');
    const count = await editButtons.count();
    console.log(`Found ${count} edit buttons`);

    // The 5000엔 plan should be the last one (4th)
    const targetIdx = count - 1;
    await editButtons.nth(targetIdx).click();
    console.log(`Clicked edit button ${targetIdx + 1} (last plan)`);
    await page.waitForTimeout(3000);

    // Verify it's the 5000엔 plan
    const pageText = await page.textContent('body');
    if (pageText.includes('5000') || pageText.includes('5,000')) {
      console.log('Confirmed: this is the 5000엔 plan');
    } else {
      console.log('WARNING: may not be the right plan, checking...');
      await page.screenshot({ path: path.join(__dirname, 'fanbox-delete-check.png'), fullPage: true });
    }

    // Scroll down to find delete button
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // Click "플랜 삭제하기"
    const deleteBtn = page.locator('text=플랜 삭제하기').first();
    if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await deleteBtn.click();
      console.log('Delete button clicked');
      await page.waitForTimeout(2000);

      // Confirm deletion dialog
      const okBtn = page.locator('button').filter({ hasText: /^OK$/i }).first();
      if (await okBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await okBtn.click();
        console.log('OK confirmed - plan deleted!');
      } else {
        // Try other confirm buttons
        const confirmBtn = page.locator('button').filter({ hasText: /확인|삭제|OK|Delete/i }).first();
        if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await confirmBtn.click();
          console.log('Confirm clicked - plan deleted!');
        } else {
          await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button')];
            const ok = btns.find(b => /OK|확인|삭제/.test(b.textContent.trim()));
            if (ok) ok.click();
          });
          console.log('Confirm clicked via JS');
        }
      }

      await page.waitForTimeout(5000);
      await page.screenshot({ path: path.join(__dirname, 'fanbox-after-delete.png'), fullPage: true });
      console.log('After-delete screenshot taken');
    } else {
      console.log('Delete button not found');
      await page.screenshot({ path: path.join(__dirname, 'fanbox-delete-notfound.png'), fullPage: true });
    }

    console.log('=== Done! ===');

  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: path.join(__dirname, 'fanbox-delete-error.png') });
  }

  await context.close();
}

run().catch(console.error);
