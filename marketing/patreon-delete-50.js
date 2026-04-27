const { chromium } = require('C:\\Users\\USER\\Desktop\\x-warmup\\node_modules\\playwright');
const path = require('path');

const PROFILE = path.join(__dirname, 'profiles', 'patreon-profile');

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

    // Find all 수정 buttons - the old $50 Lifetime Plan should be the LAST one
    const editBtns = page.locator('text=수정');
    const editCount = await editBtns.count();
    console.log(`Found ${editCount} edit buttons`);

    // Click the last 수정 (old $50 Lifetime Plan is at the bottom)
    const targetIdx = editCount - 1;
    await editBtns.nth(targetIdx).click();
    console.log(`Clicked edit button ${targetIdx + 1} (last tier)`);
    await page.waitForTimeout(3000);

    // Verify it's the $50 plan
    const pageText = await page.textContent('body');
    if (pageText.includes('50') && pageText.includes('Lifetime Plan') && !pageText.includes('SALE')) {
      console.log('Confirmed: this is the old $50 Lifetime Plan');
    } else {
      console.log('Checking page content...');
      await page.screenshot({ path: path.join(__dirname, 'patreon-delete-check.png'), fullPage: true });
    }

    // Scroll down to find delete option
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    await page.screenshot({ path: path.join(__dirname, 'patreon-delete-before.png'), fullPage: true });

    // Scroll to bottom to see the ... button
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // Click the "..." button - it's next to 취소 and 저장 at the very bottom of the form
    console.log('Clicking ... (more options) button...');
    const clickResult = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      // Find 저장 button
      const saveBtn = btns.find(b => b.textContent.trim() === '저장');
      if (!saveBtn) return 'No save button found';
      const saveRect = saveBtn.getBoundingClientRect();

      // Find 취소 button
      const cancelBtn = btns.find(b => b.textContent.trim() === '취소');
      if (!cancelBtn) return 'No cancel button found';
      const cancelRect = cancelBtn.getBoundingClientRect();

      // The ... button should be to the LEFT of 취소, same row, and NOT a text button
      // It's the only other button on that row with empty/icon text
      const candidates = btns.filter(b => {
        const rect = b.getBoundingClientRect();
        const text = b.textContent.trim();
        return Math.abs(rect.top - cancelRect.top) < 20
          && rect.left < cancelRect.left
          && rect.left > 300  // Not the sidebar buttons
          && (text === '' || text.length <= 3);
      });

      if (candidates.length > 0) {
        // Pick the one closest to 취소
        candidates.sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return Math.abs(aRect.left - cancelRect.left) - Math.abs(bRect.left - cancelRect.left);
        });
        candidates[0].click();
        const r = candidates[0].getBoundingClientRect();
        return `Clicked ... button at x=${r.left}, y=${r.top}, text="${candidates[0].textContent.trim()}", size=${r.width}x${r.height}`;
      }

      // Debug: list all buttons near save/cancel row
      const nearbyBtns = btns.filter(b => {
        const rect = b.getBoundingClientRect();
        return Math.abs(rect.top - cancelRect.top) < 30;
      });
      return `No ... found. Nearby buttons: ${nearbyBtns.map(b => `"${b.textContent.trim()}" x=${b.getBoundingClientRect().left}`).join(', ')}`;
    });
    console.log(clickResult);
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(__dirname, 'patreon-delete-menu.png'), fullPage: true });

    // Check what appeared after clicking ...
    const menuItems = await page.evaluate(() => {
      // Look for any popup/dropdown/menu that appeared
      const allText = [];
      // Check for elements that might be menu items
      const candidates = document.querySelectorAll('[role="menu"] *, [role="menuitem"], [role="dialog"] *, [data-radix-popper-content-wrapper] *, [class*="popover"] *, [class*="dropdown"] *, [class*="menu"] *');
      candidates.forEach(el => {
        const t = el.textContent.trim();
        if (t && t.length < 60 && !allText.includes(t)) allText.push(t);
      });
      return allText.slice(0, 20);
    });
    console.log('Menu items:', JSON.stringify(menuItems));

    // Try to find and click delete option
    const deleteResult = await page.evaluate(() => {
      const allEls = [...document.querySelectorAll('button, a, [role="menuitem"], div[tabindex], span')];
      for (const el of allEls) {
        const text = el.textContent.trim();
        if (/^(등급 삭제|삭제|Delete|Archive|보관|Remove|비활성화|Unpublish|Deactivate|등급 비활성화|이 등급 삭제)$/i.test(text)) {
          el.click();
          return `Clicked: "${text}"`;
        }
      }
      // Broader search
      for (const el of allEls) {
        const text = el.textContent.trim();
        if (/삭제|Delete|Archive|보관|Remove|비활성|Unpublish|Deactivate/i.test(text) && text.length < 30) {
          el.click();
          return `Clicked (broad): "${text}"`;
        }
      }
      return 'No delete option found';
    });
    console.log(deleteResult);
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(__dirname, 'patreon-delete-confirm.png'), fullPage: true });

    // Handle confirmation if needed
    if (deleteResult.includes('Clicked')) {
      const confirmBtn = page.locator('button').filter({ hasText: /확인|OK|Yes|Delete|삭제|Confirm|비활성/i }).first();
      if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await confirmBtn.click();
        console.log('Confirmation clicked');
      }
    }

    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(__dirname, 'patreon-delete-after.png'), fullPage: true });
    console.log('=== Done! ===');

  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: path.join(__dirname, 'patreon-delete-error.png') });
  }

  await context.close();
}

run().catch(console.error);
