const { chromium } = require('C:\\Users\\USER\\Desktop\\x-warmup\\node_modules\\playwright');
const path = require('path');

const PROFILE = path.join(__dirname, 'profiles', 'fanbox-profile');
const BANNER_IMG = path.join(__dirname, 'fanbox', 'fanbox-banner-5000.png');
const FANCARD_IMG = path.join(__dirname, 'fanbox', 'fanbox-fancard-5000.png');

const PLAN_NAME = '할인! 무제한 이용권 (Lifetime)';
const PLAN_PRICE = '3000';
const PLAN_DESC = `🔥 기간 한정 할인! ¥5,000 → ¥3,000

🎮 게임번역기 무제한 이용권

새로 구매하신 분들은 아래에서 라이선스 키를 조회하실 수 있습니다.
https://api.closedclaws.com/api/license/my-key

━━━━━━━━━━━━━━━━

✅ 포함 사항
• 만료 없는 영구 라이선스 키 즉시 발급
• UE4 / UE5 / Unity / RPG Maker 등 멀티 엔진 지원
• Claude AI 기반 자연스러운 한국어 번역
• 신규 엔진 업데이트 자동 포함
• 구매자 전용 Discord 서버 접근

🌟 결제 후 다음 달 구독 취소하셔도 됩니다
발급된 라이선스는 영구적으로 유효합니다`;

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
    // Go to new plan page
    console.log('Navigating to new plan page...');
    await page.goto('https://www.fanbox.cc/manage/plans/new', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Fill plan name
    const nameInput = page.locator('input[type="text"]').first();
    await nameInput.fill(PLAN_NAME);
    console.log('Plan name filled');

    // Fill price
    const priceInput = page.locator('input[type="number"]').first();
    await priceInput.fill(PLAN_PRICE);
    console.log('Price filled: 3000');

    // Fill description
    const textarea = page.locator('textarea').first();
    await textarea.fill(PLAN_DESC);
    console.log('Description filled');

    await page.waitForTimeout(1000);

    // Upload banner (first file input)
    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(0).setInputFiles(BANNER_IMG);
    console.log('Banner uploaded');
    await page.waitForTimeout(2000);

    // Upload fancard (second file input)
    await fileInputs.nth(1).setInputFiles(FANCARD_IMG);
    console.log('Fancard uploaded');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(__dirname, 'fanbox-before-save.png'), fullPage: true });
    console.log('Before-save screenshot taken');

    // Click save button
    const saveBtn = page.locator('button, a').filter({ hasText: /저장하기|保存|Save/i }).first();
    if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveBtn.click();
      console.log('Save button clicked!');
    } else {
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const save = btns.find(b => b.textContent.includes('저장'));
        if (save) save.click();
      });
      console.log('Save button clicked via JS!');
    }

    // Wait for confirmation dialog and click OK
    await page.waitForTimeout(2000);
    const okBtn = page.locator('button').filter({ hasText: /^OK$/i }).first();
    if (await okBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await okBtn.click();
      console.log('OK button clicked!');
    } else {
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const ok = btns.find(b => b.textContent.trim() === 'OK');
        if (ok) ok.click();
      });
      console.log('OK clicked via JS!');
    }

    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(__dirname, 'fanbox-after-save.png'), fullPage: true });
    console.log('After-save screenshot taken');
    console.log('=== Done! ===');

  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: path.join(__dirname, 'fanbox-error.png') });
  }

  await context.close();
}

run().catch(console.error);
