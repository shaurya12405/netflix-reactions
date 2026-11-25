/**
 * End-to-end smoke test for M1 against a FAKE player page (tests/e2e/fixture).
 * It checks our own logic (SPA navigation, Shadow DOM mount, playback tracking,
 * fullscreen, episode change, keyboard/click shielding). It cannot prove
 * anything about Netflix's real DOM: that still needs the manual checklist.
 *
 * Run: npm run test:e2e   (set PW_CHROMIUM_PATH to use a specific Chromium)
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, '../../.output/chrome-mv3');
const artifacts = join(here, '.artifacts');
const videoPath = join(artifacts, 'test.webm');
mkdirSync(artifacts, { recursive: true });

if (!existsSync(videoPath)) {
  // 90 s tiny test pattern, generated locally (needs ffmpeg).
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10',
    '-t', '90', '-c:v', 'libvpx', '-b:v', '60k', '-g', '10', videoPath,
  ]);
}
const fixtureHtml = readFileSync(join(here, 'fixture/player.html'));
const video = readFileSync(videoPath);

const userDataDir = mkdtempSync(join(tmpdir(), 'scene-talk-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(`  ✓ ${name}`);
  } catch (e) {
    results.push(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
    throw e;
  }
};

try {
  await context.route('https://www.netflix.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/__fixture/test.webm') {
      return route.fulfill({ status: 200, contentType: 'video/webm', body: video });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml });
  });

  const page = await context.newPage();
  const host = page.locator('scene-talk-root');
  const videoId = page.getByTestId('video-id');
  const currentTime = () => page.evaluate(() => document.querySelector('video')?.currentTime ?? -1);
  const isPaused = () => page.evaluate(() => document.querySelector('video')?.paused ?? true);
  const ranges = () =>
    page.getByTestId('ranges').locator('li').allTextContents();

  await step('stays dormant on a non-watch page', async () => {
    await page.goto('https://www.netflix.com/browse');
    await page.waitForTimeout(800);
    assert.equal(await host.count(), 0);
  });

  await step('mounts after SPA navigation to /watch/<id> (no reload)', async () => {
    await page.click('#open');
    await videoId.filter({ hasText: '80000001' }).waitFor({ timeout: 5000 });
    const inside = await page.evaluate(
      () => !!document.querySelector('.watch-video scene-talk-root'),
    );
    assert.ok(inside, 'host should be inside the player container');
  });

  await step('shadow DOM isolates styles (page hides all inputs; ours stays visible)', async () => {
    assert.ok(await page.getByTestId('key-test').isVisible());
  });

  await step('shows a live currentTime and records watched ranges', async () => {
    await page.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 3);
    await page.waitForTimeout(600);
    const shown = await page.getByTestId('current-time').textContent();
    assert.match(shown, /0:0[2-9]/);
    assert.equal((await ranges()).length, 1);
  });

  await step('typing a space in our input does not pause (capture-phase page listeners)', async () => {
    assert.equal(await isPaused(), false);
    await page.getByTestId('key-test').click();
    await page.keyboard.type('a b f');
    assert.equal(await page.getByTestId('key-test').inputValue(), 'a b f');
    assert.equal(await isPaused(), false, 'video must keep playing');
    const events = await page.evaluate(() => window.__events);
    assert.deepEqual(events, [], 'page must not see keys typed in our UI');
  });

  await step('page shortcuts still work outside our UI', async () => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.click(300, 600); // on the player, outside our panel
    await page.keyboard.press(' ');
    const events = await page.evaluate(() => window.__events);
    assert.ok(events.includes('player-click') && events.includes('window-capture-space'), JSON.stringify(events));
    // Back to playing for the next steps.
    await page.evaluate(() => document.querySelector('video').play());
    await page.evaluate(() => (window.__events = []));
  });

  await step('clicking inside our panel does not pause', async () => {
    await page.getByTestId('video-id').click();
    assert.equal(await isPaused(), false);
    assert.deepEqual(await page.evaluate(() => window.__events), []);
  });

  await step('a forward seek does not unlock the skipped part', async () => {
    const before = await currentTime();
    await page.evaluate((t) => (document.querySelector('video').currentTime = t), before + 30);
    await page.waitForTimeout(2500);
    const list = await ranges();
    assert.equal(list.length, 2, `expected 2 ranges, got ${JSON.stringify(list)}`);
  });

  await step('stays mounted in fullscreen (inside the fullscreen element)', async () => {
    await page.click('#fs');
    await page.getByTestId('fullscreen').filter({ hasText: 'yes' }).waitFor({ timeout: 3000 });
    const inside = await page.evaluate(() =>
      document.fullscreenElement?.contains(document.querySelector('scene-talk-root')),
    );
    assert.ok(inside);
    await page.screenshot({ path: join(artifacts, 'm1-fullscreen.png') });
    await page.evaluate(() => document.exitFullscreen());
  });

  await step('episode change (URL + new <video>) resets state', async () => {
    await page.evaluate(() => window.__nextEpisode('80000002'));
    await videoId.filter({ hasText: '80000002' }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    const list = await ranges();
    assert.ok(list.length <= 1, `new episode should start fresh, got ${JSON.stringify(list)}`);
    assert.equal(await host.count(), 1, 'exactly one host');
  });

  await step('watched ranges persist in extension storage per video (saved on pause)', async () => {
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.querySelector('video').pause());
    await page.waitForTimeout(300);
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    // The manifest `key` must pin the ID (needed for a stable OAuth redirect).
    assert.ok(worker.url().startsWith('chrome-extension://ogpidfiegoigmchlfmmdempbapjlbcnp/'), worker.url());
    const stored = await worker.evaluate(() => chrome.storage.local.get(null));
    const keys = Object.keys(stored).sort();
    assert.deepEqual(keys, ['watched:netflix:80000001', 'watched:netflix:80000002']);
    assert.equal(stored['watched:netflix:80000001'].ranges.length, 2);
  });
} finally {
  console.log(results.join('\n'));
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
console.log('\nM1 smoke test passed.');
