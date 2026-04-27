const { firefox } = require('C:\\Users\\USER\\Desktop\\x-warmup\\node_modules\\playwright');
const path = require('path');
const fs = require('fs');

const COOKIES_FILE = path.join(__dirname, 'fanbox-cookies.json');

async function login() {
  console.log('Opening Firefox for Fanbox login...');
  console.log('Please log in manually.');
  console.log('After login, press Enter here to save cookies.\n');

  const browser = await firefox.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto('https://www.fanbox.cc/login');

  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('Press Enter after login is complete...', resolve));
  rl.close();

  const cookies = await context.cookies();
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  console.log(`Saved ${cookies.length} cookies`);

  await browser.close();
  console.log('Done!');
}

login().catch(console.error);
