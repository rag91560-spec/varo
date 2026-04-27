const { chromium } = require('C:\\Users\\USER\\Desktop\\x-warmup\\node_modules\\playwright');
const path = require('path');

const PROFILE = path.join(__dirname, 'profiles', 'patreon-profile');
const COVER_IMG = path.join(__dirname, 'patreon', 'patreon-cover-lifetime.png');

const PLAN_NAME = 'Lifetime Plan (SALE)';
const PLAN_PRICE = '30';
const PLAN_DESC = `🔥 Limited-Time Discount! $50 → $30

🎮 Game Translator — Lifetime License

New supporters can check their license key here:
https://api.closedclaws.com/api/license/my-key?lang=en

━━━━━━━━━━━━━━━━

✅ What's Included
• Permanent license key — issued instantly, never expires
• Multi-engine support: UE4 / UE5 / Unity / RPG Maker & more
• Claude AI-powered natural Korean translation
• Free updates for new engine support
• Access to exclusive Discord server for buyers

🌟 You can cancel next month after payment
Your license key stays valid permanently`;

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
    // Step 1: Go to membership page
    console.log('Step 1: Navigating to membership...');
    await page.goto('https://www.patreon.com/rag91560/membership', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    await page.screenshot({ path: path.join(__dirname, 'patreon-step1.png'), fullPage: true });
    console.log('Membership page loaded');

    // Step 2: Click "+ 등급 추가" or "Add tier" button
    console.log('Step 2: Looking for add tier button...');
    const addTierBtn = page.locator('button, a').filter({ hasText: /등급 추가|Add tier|새 등급|New tier|Add a tier/i }).first();
    if (await addTierBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addTierBtn.click();
      console.log('Add tier button clicked');
    } else {
      // Try finding by other selectors
      console.log('Trying alternative selectors...');
      const allBtns = page.locator('button');
      const btnCount = await allBtns.count();
      console.log(`Total buttons: ${btnCount}`);
      for (let i = 0; i < btnCount; i++) {
        const txt = await allBtns.nth(i).textContent().catch(() => '');
        console.log(`  Button ${i}: "${txt.trim().substring(0, 50)}"`);
      }

      // Also check links
      const allLinks = page.locator('a');
      const linkCount = await allLinks.count();
      for (let i = 0; i < linkCount; i++) {
        const txt = await allLinks.nth(i).textContent().catch(() => '');
        const href = await allLinks.nth(i).getAttribute('href').catch(() => '');
        if (txt.includes('등급') || txt.includes('tier') || txt.includes('추가') || txt.includes('Add') || txt.includes('새') || txt.includes('New')) {
          console.log(`  Link ${i}: "${txt.trim()}" href="${href}"`);
        }
      }

      // Try clicking via JS
      await page.evaluate(() => {
        const els = [...document.querySelectorAll('button, a')];
        const add = els.find(e => /등급 추가|Add tier|새 등급|New tier|Add a tier/i.test(e.textContent));
        if (add) { add.click(); console.log('Clicked via JS:', add.textContent); }
        else { console.log('No add tier button found via JS'); }
      });
    }
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(__dirname, 'patreon-step2.png'), fullPage: true });

    // Step 3: Fill in tier details
    console.log('Step 3: Filling tier details...');

    // Fill title - first text input (placeholder: "등급 이름")
    const titleInput = page.locator('input[placeholder="등급 이름"]').first();
    await titleInput.fill(PLAN_NAME);
    console.log('Title filled');

    // Fill price - second text input (placeholder: "0.00")
    const priceInput = page.locator('input[placeholder="0.00"]').first();
    await priceInput.click();
    await priceInput.fill('');
    await page.keyboard.type(PLAN_PRICE, { delay: 50 });
    console.log('Price filled: $' + PLAN_PRICE);
    await page.waitForTimeout(1000);

    // Fill description
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
      await textarea.fill(PLAN_DESC);
      console.log('Description filled');
    } else {
      // Patreon might use contenteditable div
      const editor = page.locator('[contenteditable="true"]').first();
      if (await editor.isVisible({ timeout: 3000 }).catch(() => false)) {
        await editor.click();
        await page.keyboard.type(PLAN_DESC, { delay: 10 });
        console.log('Description filled via contenteditable');
      }
    }
    await page.waitForTimeout(1000);

    // Step 4: Upload cover image
    console.log('Step 4: Uploading cover image...');
    const fileInputs = page.locator('input[type="file"]');
    const fileCount = await fileInputs.count();
    console.log(`Found ${fileCount} file inputs`);
    if (fileCount > 0) {
      await fileInputs.nth(0).setInputFiles(COVER_IMG);
      console.log('Cover image uploaded');
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: path.join(__dirname, 'patreon-step4.png'), fullPage: true });

    // Step 5: Save/publish tier
    console.log('Step 5: Saving tier...');
    const saveBtn = page.locator('button').filter({ hasText: /저장|Save|Publish|게시|등급 저장/i }).first();
    if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveBtn.click();
      console.log('Save button clicked');
    } else {
      // Try via JS
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const save = btns.find(b => /저장|Save|Publish|게시/.test(b.textContent));
        if (save) { save.click(); console.log('Saved via JS'); }
        else {
          btns.forEach((b, i) => console.log(`Btn ${i}: "${b.textContent.trim().substring(0, 40)}"`));
        }
      });
    }

    // Handle confirmation dialog
    await page.waitForTimeout(2000);
    const okBtn = page.locator('button').filter({ hasText: /^OK$|확인|Confirm|Yes/i }).first();
    if (await okBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await okBtn.click();
      console.log('Confirmation clicked');
    }

    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(__dirname, 'patreon-step5.png'), fullPage: true });
    console.log('=== Tier creation complete! ===');

  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: path.join(__dirname, 'patreon-error.png') });
  }

  await context.close();
}

run().catch(console.error);
