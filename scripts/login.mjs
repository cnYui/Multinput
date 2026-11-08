// Open the dedicated persistent profile in a visible window so you can sign in once (B站, 公众号 …).
// Close the window when done; later MCP runs with the same MULTI_INPUT_USER_DATA_DIR reuse the cookies.
// Stop any running multi-input service first: one profile directory can only be opened by one browser.
import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';

const dir = process.env.MULTI_INPUT_USER_DATA_DIR || path.join(os.homedir(), '.multi-input', 'chrome-profile');
const urls = process.argv.slice(2).length ? process.argv.slice(2) : ['https://member.bilibili.com/platform/upload/video/frame', 'https://mp.weixin.qq.com/'];
const context = await chromium.launchPersistentContext(dir, { headless: false, viewport: null, locale: 'zh-CN',
  env: { ...process.env, LANG: process.env.LANG || 'C.UTF-8' },
  ...(process.env.MULTI_INPUT_CHANNEL ? { channel: process.env.MULTI_INPUT_CHANNEL } : {}),
  ...(process.env.MULTI_INPUT_EXECUTABLE_PATH ? { executablePath: process.env.MULTI_INPUT_EXECUTABLE_PATH } : {}) });
const [first] = context.pages();
for (const [i, url] of urls.entries()) await (i === 0 && first ? first : await context.newPage()).goto(url).catch(e => console.error(url, e.message));
console.log(`Profile: ${dir}\nSign in on the opened tabs, then close the browser window.`);
await new Promise(resolve => context.on('close', resolve));
