const { chromium } = require('C:\\Users\\USER\\Desktop\\x-warmup\\node_modules\\playwright');
const path = require('path');

const PROFILE = path.join(__dirname, 'profiles', 'patreon-profile');

const MONTHLY_DESC = `🎮 Game Translator — Monthly License

New supporters can check their license key here:
https://api.closedclaws.com/api/license/my-key?lang=en

━━━━━━━━━━━━━━━━

✅ What's Included
• 30-day license key — issued automatically each month
• Multi-engine support: UE4 / UE5 / Unity / RPG Maker & more
• Claude AI-powered natural translation to your language
• Free updates for new engine support
• Access to exclusive Discord server for buyers

💡 License renews automatically each month
Translation API costs (Claude/OpenAI) are covered by you`;

const YEARLY_DESC = `🎮 Game Translator — Annual License

New supporters can check their license key here:
https://api.closedclaws.com/api/license/my-key?lang=en

━━━━━━━━━━━━━━━━

✅ What's Included
• 365-day license key — issued instantly
• Multi-engine support: UE4 / UE5 / Unity / RPG Maker & more
• Claude AI-powered natural translation to your language
• Free updates for new engine support
• Access to exclusive Discord server for buyers

🌟 You can cancel after the first payment
Your license stays active for the full year
Translation API costs (Claude/OpenAI) are covered by you`;

async function updateTier(page, tierIndex, desc, tierName) {
  console.log(`\n=== Updating Tier ${tierIndex + 1}: ${tierName} ===`);

  await page.goto('https://www.patreon.com/rag91560/membership', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const editBtns = page.locator('text=수정');
  await editBtns.nth(tierIndex).click();
  await page.waitForTimeout(3000);

  // Clear and fill description
  const editor = page.locator('[contenteditable="true"]').first();
  if (await editor.isVisible({ timeout: 3000 })) {
    // Select all and delete
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    // Type new description
    await page.keyboard.type(desc, { delay: 5 });
    console.log('Description updated');
  } else {
    // Try textarea
    const textarea = page.locator('textarea').first();
    await textarea.fill(desc);
    console.log('Description updated via textarea');
  }

  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, `patreon-update-tier${tierIndex + 1}.png`), fullPage: true });

  // Save
  const saveBtn = page.locator('button').filter({ hasText: '저장' }).first();
  await saveBtn.click();
  console.log('Saved!');
  await page.waitForTimeout(3000);
}

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
    // Update Monthly (index 0)
    await updateTier(page, 0, MONTHLY_DESC, 'Monthly Plan');

    // Update Yearly (index 1)
    await updateTier(page, 1, YEARLY_DESC, 'Yearly Plan');

    console.log('\n=== All tiers updated! ===');
  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: path.join(__dirname, 'patreon-update-error.png') });
  }

  await context.close();
}

run().catch(console.error);
