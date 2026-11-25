/**
 * End-to-end smoke test against a FAKE player page (tests/e2e/fixture) and a
 * FAKE Supabase (request routing inside the test browser). It exercises Scene Talk's own logic end to end: SPA navigation,
 * Shadow DOM mount, spoiler gating, posting, pop-ups, modes,
 * fullscreen, episode change, and keyboard/click shielding. It proves nothing
 * about Netflix's real DOM or a real Supabase project; those are manual checks.
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
const root = resolve(here, '../..');
const outDir = resolve(root, '.output-e2e');
const extensionPath = join(outDir, 'chrome-mv3');
const artifacts = join(here, '.artifacts');
const videoPath = join(artifacts, 'test.webm');
mkdirSync(artifacts, { recursive: true });

const SUPABASE = 'https://e2e-test.supabase.co';
const EXT_ID = 'ogpidfiegoigmchlfmmdempbapjlbcnp';
const ME = '00000000-0000-4000-8000-0000000000e2';
const MIRA = '00000000-0000-4000-8000-0000000000a1';
const TOMASZ = '00000000-0000-4000-8000-0000000000b2';
const VIDEO = 'netflix:80000001';

// ---- Build with a fake Supabase config, into a separate folder -------------
execFileSync(process.execPath, [join(root, 'node_modules/wxt/bin/wxt.mjs'), 'build'], {
  cwd: root,
  stdio: 'ignore',
  env: {
    ...process.env,
    SCENE_TALK_OUTDIR: outDir,
    WXT_SUPABASE_URL: SUPABASE,
    WXT_SUPABASE_ANON_KEY: 'e2e-anon-key',
  },
});

if (!existsSync(videoPath)) {
  // 90 s tiny test pattern, generated locally (needs ffmpeg).
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10',
    '-t', '90', '-c:v', 'libvpx', '-b:v', '60k', '-g', '10', videoPath,
  ]);
}
const fixtureHtml = readFileSync(join(here, 'fixture/player.html'));
const video = readFileSync(videoPath);

// ---- Fake backend data ---------------------------------------------------------
const profiles = { [ME]: 'tester', [MIRA]: 'mira_k', [TOMASZ]: 'tomasz' };
const row = (id, ts, userId, text, extra = {}) => ({
  id, video_id: VIDEO, ts_seconds: ts, user_id: userId, parent_id: null, text,
  is_spoiler: false, like_count: 0, created_at: '2026-11-25T10:00:00Z', ...extra,
});
const uuid = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const comments = [
  row(uuid(1), 1.0, MIRA, 'First moment, already hooked'),
  row(uuid(2), 2.0, MIRA, 'The door matters later', { is_spoiler: true }),
  row(uuid(3), 2.5, TOMASZ, 'Agreed', { parent_id: uuid(1) }),
  row(uuid(4), 40.0, MIRA, 'Big reveal in the skipped-over part'),
  row(uuid(5), 63.0, TOMASZ, 'Pop-up moment'),
  row(uuid(6), 85.0, MIRA, 'Way ahead'),
];
const posted = [];

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const accessToken = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: ME, exp: now + 3600, role: 'authenticated', aud: 'authenticated' })}.sig`;
const session = {
  access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
  refresh_token: 'fake-refresh',
  user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'tester@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-11-25T10:00:00Z' },
};

// ---- Browser -------------------------------------------------------------------
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

// Realtime is not mocked: Playwright's WebSocket routing patches the page's
// WebSocket, but content scripts run in an isolated world with their own, so
// the live connection simply fails here. Live inserts are covered by the
// comments-sync unit tests and the manual checklist.

await context.route(`${SUPABASE}/**`, async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  if (req.method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  }
  if (url.pathname === '/rest/v1/comments') {
    // Like real PostgREST: likes makes comments<->profiles ambiguous, so an
    // embed must name the author foreign key.
    const select = url.searchParams.get('select') ?? '';
    if (/(^|,)profiles\(/.test(select)) {
      return json(300, { code: 'PGRST201', message: "Could not embed because more than one relationship was found for 'comments' and 'profiles'" });
    }
    const [lo, hi] = ['gte.', 'lt.'].map((p) => Number(url.searchParams.getAll('ts_seconds').find((v) => v.startsWith(p))?.slice(p.length)));
    const video = url.searchParams.get('video_id')?.replace(/^eq\./, '');
    const rows = comments
      .filter((c) => c.video_id === video && c.ts_seconds >= lo && c.ts_seconds < hi)
      .map((c) => ({ ...c, profiles: { display_name: profiles[c.user_id] } }));
    return json(200, rows);
  }
  if (url.pathname === '/rest/v1/profiles') {
    const id = url.searchParams.get('id') ?? '';
    const ids = id.startsWith('eq.') ? [id.slice(3)] : id.replace(/^in\.\(|\)$/g, '').split(',').map((s) => s.replace(/"/g, ''));
    const rows = ids.filter((i) => profiles[i]).map((i) => ({ id: i, display_name: profiles[i] }));
    const single = (req.headers().accept ?? '').includes('vnd.pgrst.object');
    return single ? (rows[0] ? json(200, rows[0]) : json(406, { code: 'PGRST116' })) : json(200, rows);
  }
  if (url.pathname === '/functions/v1/post-comment' && req.method() === 'POST') {
    const body = req.postDataJSON();
    posted.push({ body, auth: req.headers().authorization });
    const comment = row(uuid(100 + posted.length), body.tsSeconds, ME, body.text, { is_spoiler: body.isSpoiler, parent_id: body.parentId });
    return json(201, { comment });
  }
  return json(404, { message: `no mock for ${url.pathname}` });
});

await context.route('https://www.netflix.com/**', (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/__fixture/test.webm') {
    return route.fulfill({ status: 200, contentType: 'video/webm', body: video });
  }
  return route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml });
});

try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  await worker.evaluate((s) => chrome.storage.local.set({ 'sb-auth': JSON.stringify(s) }), session);

  const page = await context.newPage();
  const panel = page.getByTestId('panel');
  const commentText = (t) => page.getByTestId('comment').filter({ hasText: t });
  const vt = () => page.evaluate(() => document.querySelector('video')?.currentTime ?? -1);
  const isPaused = () => page.evaluate(() => document.querySelector('video')?.paused ?? true);
  const waitForTime = (t) => page.waitForFunction((x) => (document.querySelector('video')?.currentTime ?? 0) > x, t, { timeout: 30000 });

  await step('the extension ID is pinned by the manifest key', async () => {
    assert.ok(worker.url().startsWith(`chrome-extension://${EXT_ID}/`), worker.url());
  });

  await step('stays dormant on a non-watch page', async () => {
    await page.goto('https://www.netflix.com/browse');
    await page.waitForTimeout(800);
    assert.equal(await page.locator('scene-talk-root').count(), 0);
  });

  await step('mounts inside the player after SPA navigation (no reload)', async () => {
    await page.click('#open');
    await panel.waitFor({ timeout: 5000 });
    assert.equal(await panel.getAttribute('data-video-id'), '80000001');
    assert.ok(await page.evaluate(() => !!document.querySelector('.watch-video scene-talk-root')));
  });

  await step('reveals comments as playback reaches them; nothing ahead', async () => {
    await waitForTime(0.5);
    assert.equal(await commentText('First moment').count(), 0, 'not before its timestamp');
    await waitForTime(3.2);
    await commentText('First moment').waitFor({ timeout: 3000 });
    await commentText('Agreed').waitFor({ timeout: 3000 });
    assert.equal(await page.getByTestId('spoiler').count(), 1, 'the spoiler is blurred');
    assert.equal(await commentText('Big reveal').count(), 0);
    assert.equal(await commentText('Way ahead').count(), 0);
  });

  await step('a spoiler is revealed by clicking it', async () => {
    await page.getByTestId('spoiler').click();
    await commentText('The door matters later').waitFor();
    assert.equal(await isPaused(), false, 'clicking the panel did not pause');
  });

  await step('"c" while typing in a page field does not open the composer', async () => {
    await page.click('#page-input');
    await page.keyboard.type('c');
    assert.equal(await page.getByTestId('composer').count(), 0);
    await page.evaluate(() => document.activeElement?.blur());
  });

  let openedAt = 0;
  await step('"c" opens the composer and captures the timestamp at that moment', async () => {
    openedAt = await vt();
    await page.keyboard.press('c');
    await page.getByTestId('composer-input').waitFor({ timeout: 3000 });
    assert.match(await page.getByTestId('composer').textContent(), /as tester/);
  });

  await step('typing (with spaces) never reaches the page; playback keeps going', async () => {
    await page.getByTestId('composer-input').pressSequentially('Loved this scene f', { delay: 60 });
    assert.equal(await isPaused(), false);
    assert.deepEqual(await page.evaluate(() => window.__events), []);
  });

  await step('Enter posts via the Edge Function; the comment appears as yours', async () => {
    await page.waitForTimeout(1200); // submit noticeably later than the composer opened
    await page.keyboard.press('Enter');
    await commentText('Loved this scene f').waitFor({ timeout: 5000 });
    assert.equal(posted.length, 1);
    const { body, auth } = posted[0];
    assert.equal(body.videoId, VIDEO);
    assert.ok(Math.abs(body.tsSeconds - openedAt) < 0.6, `ts ${body.tsSeconds} should be ~${openedAt} (when opened)`);
    assert.equal('userId' in body || 'user_id' in body, false, 'no user id in the request body');
    assert.equal(auth, `Bearer ${accessToken}`, 'sent with the signed-in session');
    assert.equal(await page.getByTestId('composer').count(), 0, 'composer closed');
    assert.equal(await isPaused(), false, 'posting did not pause playback');
    assert.match(await commentText('Loved this scene f').textContent(), /you/);
  });

  await step('a forward skip reveals everything before the new position, nothing after', async () => {
    await page.evaluate(() => (document.querySelector('video').currentTime = 60));
    await waitForTime(61);
    await commentText('Big reveal').waitFor({ timeout: 3000 }); // at 0:40, skipped over
    assert.equal(await commentText('Way ahead').count(), 0); // at 1:25, not reached
  });

  await step('pop-up mode shows comments as playback reaches them', async () => {
    await page.getByRole('button', { name: 'Pop-ups' }).click();
    await page.getByTestId('toast').filter({ hasText: 'Pop-up moment' }).waitFor({ timeout: 8000 });
  });

  await step('hide is one click and is remembered after a reload', async () => {
    await page.getByTestId('hide').click();
    await page.getByTestId('show').waitFor();
    await page.reload();
    await page.getByTestId('show').waitFor({ timeout: 8000 });
    await page.getByTestId('show').click();
    await panel.waitFor();
  });

  await step('stays mounted in fullscreen', async () => {
    await page.click('#fs');
    await page.waitForFunction(() => document.fullscreenElement?.contains(document.querySelector('scene-talk-root')), null, { timeout: 3000 });
    await page.screenshot({ path: join(artifacts, 'm3-fullscreen.png') });
    await page.evaluate(() => document.exitFullscreen());
  });

  await step('episode change resets the panel', async () => {
    await page.evaluate(() => window.__nextEpisode('80000002'));
    await page.waitForFunction(() => {
      const host = document.querySelector('scene-talk-root');
      return host?.shadowRoot?.querySelector('[data-testid="panel"]')?.getAttribute('data-video-id') === '80000002';
    }, null, { timeout: 5000 });
    await page.getByTestId('empty').waitFor({ timeout: 3000 });
    assert.equal(await page.locator('scene-talk-root').count(), 1);
  });

  await step('watched ranges persist per video', async () => {
    await page.evaluate(() => document.querySelector('video').pause());
    await page.waitForTimeout(300);
    const stored = await worker.evaluate(() => chrome.storage.local.get(null));
    const [[start, furthest]] = stored['watched:netflix:80000001'].ranges;
    assert.equal(start, 0);
    assert.ok(furthest >= 60, `furthest point ${furthest} should be past the skip to 60`);
    assert.equal(stored['settings:displayMode'], 'panel');
  });

  await step('the popup shows the signed-in display name', async () => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
    await popup.getByText('Commenting as').waitFor({ timeout: 5000 });
    assert.match(await popup.locator('main').textContent(), /tester/);
    await popup.close();
  });

  // Must stay last: it reloads the extension, orphaning this tab's content script.
  await step('after an extension reload the old copy removes its panel and logs nothing', async () => {
    const warnings = [];
    page.on('console', (m) => {
      if (/Scene Talk|invalidated/i.test(m.text()) && ['warning', 'error'].includes(m.type())) warnings.push(m.text());
    });
    page.on('pageerror', (e) => warnings.push(String(e)));
    await page.evaluate(() => document.querySelector('video').play());
    await worker.evaluate(() => chrome.runtime.reload());
    // The orphaned script notices on its next tick or 5 s heartbeat.
    await page.waitForFunction(() => document.querySelectorAll('scene-talk-root').length === 0, null, { timeout: 12000 });
    await page.waitForTimeout(6000); // let a save interval pass
    assert.deepEqual(warnings, []);
  });
} finally {
  console.log(results.join('\n'));
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
console.log('\nSmoke test passed.');
