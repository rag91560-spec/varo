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

    // Click the last 수정 button (Lifetime Plan SALE - should be last/3rd)
    const editBtns = page.locator('text=수정');
    const editCount = await editBtns.count();
    console.log(`Found ${editCount} edit buttons`);
    await editBtns.nth(editCount - 1).click();
    console.log('Clicked edit for Lifetime Plan (SALE)');
    await page.waitForTimeout(3000);

    // Remove existing cover image first (click x button)
    const removeImgBtn = page.locator('button').filter({ has: page.locator('svg') }).locator('xpath=//button[contains(@aria-label, "remove") or contains(@aria-label, "삭제") or contains(@aria-label, "Remove")]');
    // Try finding the x button near the cover image
    const xResult = await page.evaluate(() => {
      // Find the cover image thumbnail and its x button
      const imgs = document.querySelectorAll('img');
      for (const img of imgs) {
        const parent = img.closest('div');
        if (parent) {
          const btn = parent.querySelector('button');
          if (btn) {
            btn.click();
            return 'Clicked x button near image';
          }
        }
      }
      // Alternative: find buttons with x/close icon near "커버 이미지" text
      const labels = [...document.querySelectorAll('*')];
      const coverLabel = labels.find(l => l.textContent.includes('커버 이미지'));
      if (coverLabel) {
        const section = coverLabel.closest('div');
        if (section) {
          const btns = section.querySelectorAll('button');
          for (const b of btns) {
            if (b.textContent.trim() === '' || b.textContent.trim() === '×' || b.textContent.trim() === 'x') {
              b.click();
              return 'Clicked x button in cover section';
            }
          }
        }
      }
      return 'No x button found';
    });
    console.log(xResult);
    await page.waitForTimeout(1000);

    // Upload new cover image
    const fileInput = page.locator('input[type="file"]');
    const fileCount = await fileInput.count();
    console.log(`Found ${fileCount} file inputs`);
    if (fileCount > 0) {
      await fileInput.nth(0).setInputFiles(COVER_IMG);
      console.log('New cover image uploaded');
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: path.join(__dirname, 'patreon-fix-before-save.png'), fullPage: true });

    // Save
    const saveBtn = page.locator('button').filter({ hasText: '저장' }).first();
    await saveBtn.click();
    console.log('Save clicked');

    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(__dirname, 'patreon-fix-after-save.png'), fullPage: true });
    console.log('=== Done! ===');

  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: path.join(__dirname, 'patreon-fix-error.png') });
  }

  await context.close();
}

run().catch(console.error);
