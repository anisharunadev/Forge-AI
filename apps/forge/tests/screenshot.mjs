// apps/forge/tests/screenshot.mjs — single-shot Playwright capture.
//
// Usage: node screenshot.mjs --url <url> --out <png> [--viewport 1440x900]
//
// Used by FORA-382 to capture the persona + run-detail screenshots
// without invoking the full @playwright/test runner (faster, no
// fixtures, no test report). Boots chromium with a desktop viewport
// and a deterministic user-agent so the screenshots are reproducible
// across runs.

import { chromium } from '@playwright/test';
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    out: { type: 'string' },
    viewport: { type: 'string', default: '1440x900' },
  },
});

if (!values.url || !values.out) {
  console.error('usage: screenshot.mjs --url <url> --out <png> [--viewport 1440x900]');
  process.exit(2);
}

const [vw, vh] = values.viewport.split('x').map(Number);

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: vw, height: vh },
    userAgent: 'FORA-382-CleanLaptopBot/1.0',
  });
  const page = await context.newPage();
  // networkidle: persona routes are server-rendered, but the persona
  // switcher hydrates and the Timeline component fetches stage data.
  // networkidle guarantees the page is fully rendered before the
  // screenshot.
  await page.goto(values.url, { waitUntil: 'networkidle', timeout: 30_000 });
  // Give Next.js a beat to flush any deferred work (e.g. font swap).
  await page.waitForTimeout(500);
  const buf = await page.screenshot({ type: 'png', fullPage: true });
  await writeFile(values.out, buf);
  console.log(`[shot] saved ${buf.length} bytes -> ${values.out}`);
} finally {
  await browser.close();
}
