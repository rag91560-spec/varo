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
    // Step 1: Go to plan management
    console.log('Step 1: Navigating to plan management...');
    await page.goto('https://www.fanbox.cc/manage/plans', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Step 2: Click "새 플랜 추가" or find the create button
    console.log('Step 2: Looking for create plan button...');

    // Scroll down to check if there's a button at the bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(__dirname, 'fanbox-step2.png'), fullPage: true });

    // Try to find the create button - it might be a link or button
    const createBtn = page.locator('a, button').filter({ hasText: /새 플랜|플랜 추가|新しいプラン|Add|Create/i });
    const createCount = await createBtn.count();
    console.log(`Found ${createCount} create buttons`);

    if (createCount > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(3000);
    } else {
      // Maybe it's at a different URL
      await page.goto('https://www.fanbox.cc/manage/plans/new', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: path.join(__dirname, 'fanbox-step2b.png'), fullPage: true });
    console.log('Create plan page screenshot saved');

    // Step 3: Fill in the plan details
    console.log('Step 3: Filling plan details...');

    const inputs = page.locator('input');
    const inputCount = await inputs.count();
    console.log(`Found ${inputCount} inputs`);

    for (let i = 0; i < inputCount; i++) {
      const type = await inputs.nth(i).getAttribute('type').catch(() => '');
      const val = await inputs.nth(i).inputValue().catch(() => '');
      const placeholder = await inputs.nth(i).getAttribute('placeholder').catch(() => '');
      console.log(`  Input ${i}: type=${type}, value="${val}", placeholder="${placeholder}"`);
    }

    // Fill plan name
    const nameInput = page.locator('input[type="text"]').first();
    if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.fill(PLAN_NAME);
      console.log('Plan name filled');
    }

    // Fill price - look for number input or text input with yen
    const priceInput = page.locator('input[type="number"], input[inputmode="numeric"]').first();
    if (await priceInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await priceInput.fill(PLAN_PRICE);
      console.log('Price filled');
    } else {
      // Try all inputs for one that might be price
      for (let i = 0; i < inputCount; i++) {
        const placeholder = await inputs.nth(i).getAttribute('placeholder').catch(() => '');
        if (placeholder && (placeholder.includes('金額') || placeholder.includes('円') || placeholder.includes('price'))) {
          await inputs.nth(i).fill(PLAN_PRICE);
          console.log(`Price filled in input ${i}`);
          break;
        }
      }
    }

    // Fill description - look for textarea
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
      await textarea.fill(PLAN_DESC);
      console.log('Description filled');
    }

    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(__dirname, 'fanbox-step3.png'), fullPage: true });

    // Step 4: Upload images
    console.log('Step 4: Uploading images...');
    const fileInputs = page.locator('input[type="file"]');
    const fileCount = await fileInputs.count();
    console.log(`Found ${fileCount} file inputs`);

    if (fileCount >= 1) {
      await fileInputs.nth(0).setInputFiles(BANNER_IMG);
      console.log('Banner uploaded');
      await page.waitForTimeout(2000);
    }
    if (fileCount >= 2) {
      await fileInputs.nth(1).setInputFiles(FANCARD_IMG);
      console.log('Fancard uploaded');
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: path.join(__dirname, 'fanbox-step4.png'), fullPage: true });
    console.log('Ready to save. Screenshot saved.');
    console.log('\n=== Check the browser. Press Ctrl+C when done ===');

  } catch (e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: path.join(__dirname, 'fanbox-error.png') });
  }

  await new Promise(() => {});
}

run().catch(console.error);
