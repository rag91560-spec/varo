const { chromium } = require('C:\\Users\\USER\\Desktop\\x-warmup\\node_modules\\playwright');
const path = require('path');

const PROFILE = path.join(__dirname, 'profiles', 'patreon-profile');

async function run() {
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
    await page.goto('https://www.patreon.com/rag91560/membership', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const editBtns = page.locator('text=수정');
    const editCount = await editBtns.count();
    console.log(`Found ${editCount} tiers`);

    for (let i = 0; i < editCount; i++) {
      // Go back to membership page each time
      if (i > 0) {
        await page.goto('https://www.patreon.com/rag91560/membership', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);
      }

      const btns = page.locator('text=수정');
      await btns.nth(i).click();
      console.log(`\n=== Tier ${i + 1} ===`);
      await page.waitForTimeout(3000);

      // Get tier name
      const name = await page.locator('input[type="text"]').first().inputValue().catch(() => 'unknown');
      console.log(`Name: ${name}`);

      // Get description from contenteditable
      const desc = await page.evaluate(() => {
        const editor = document.querySelector('[contenteditable="true"]');
        return editor ? editor.innerText : 'no editor found';
      });
      console.log(`Description:\n${desc}`);

      await page.screenshot({ path: path.join(__dirname, `patreon-tier-${i + 1}.png`), fullPage: true });
    }

  } catch (e) {
    console.error('Error:', e.message);
  }

  await context.close();
}

run().catch(console.error);
