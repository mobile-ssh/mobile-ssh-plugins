/* Optional browser integration: use an installed Playwright, or set MOBILE_GIT_PLAYWRIGHT
 * to its absolute module path. All Git writes are confined to disposable repositories. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.MOBILE_GIT_PLAYWRIGHT || 'playwright');

(async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-git-browser-'));
  const repository = path.join(temporary, "repo with ' quotes");
  const plugin = path.resolve(__dirname, '../plugins/git/ui');
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { env, encoding: 'utf8' });
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Git Browser Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  const base = Array.from({ length: 35 }, (_, i) => 'const value' + i + ' = ' + i + ';');
  fs.writeFileSync(path.join(repository, 'app.js'), base.join('\n') + '\n');
  fs.writeFileSync(path.join(repository, 'binary.bin'), Buffer.from([0, 1, 2]));
  git('add', '--all'); git('commit', '-m', 'Initial fixture');
  base[1] = 'const value1 = "<img src=x onerror=alert(1)>";';
  base[30] = 'const value30 = 300;';
  fs.writeFileSync(path.join(repository, 'app.js'), base.join('\n') + '\n');
  fs.writeFileSync(path.join(repository, 'binary.bin'), Buffer.from([0, 1, 3]));
  fs.writeFileSync(path.join(repository, '<img onerror=alert(1)>.txt'), 'Untracked source\n');
  const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(plugin, '.' + relative);
    if (!target.startsWith(plugin + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(target)] || 'application/octet-stream');
    res.end(fs.readFileSync(target));
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.MOBILE_GIT_CHROMIUM || undefined, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-US', isMobile: true, hasTouch: true });
    const errors = [], calls = [];
    let toolFixture = 'installed';
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push('Unexpected script dialog'); dialog.dismiss(); });
    await page.exposeFunction('fixtureExec', (command, options) => new Promise((resolve, reject) => {
      calls.push(command);
      assert.ok(options.maxOutputBytes > 0, 'Every Git request has a byte limit');
      if (command.includes('MOBILE_SSH_GIT_TOOLS_V1')) {
        if (toolFixture === 'disconnected') return reject(new Error('SSH connection lost'));
        const records = [
          ['git', '1', 'git version 2.43.0\n', '0'],
          ['lazygit', '1', 'commit=17cb09fa, build date=2026-09-13T05:42:30Z, version=0.65.1, os=linux, arch=amd64, git version=2.43.0\n', '0'],
          toolFixture === 'missing' ? ['delta', '0', '', '127'] : ['delta', '1', 'delta 0.19.2\n', '0']
        ];
        return resolve({ stdout: '\0MOBILE_SSH_GIT_TOOLS_V1\0' + records.flat().join('\0') + '\0MOBILE_SSH_GIT_TOOLS_END\0', stderr: '', exitCode: 0 });
      }
      execFile('/bin/sh', ['-c', command], { cwd: temporary, env, encoding: 'utf8', timeout: options.timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error);
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > options.maxOutputBytes) return reject(new Error('OUTPUT_LIMIT_EXCEEDED'));
        resolve({ stdout, stderr, exitCode: error ? error.code : 0 });
      });
    }));
    await page.addInitScript(({ cwd }) => {
      window.MobileSSH = {
        version: '1.2.0', session: async () => ({ host: 'fixture.invalid', user: 'fixture', port: 22, connected: true, label: 'fixture@fixture.invalid', cwd }),
        ssh: { exec: (command, options) => window.fixtureExec(command, options) },
        storage: { get: async () => null, put: async () => {} },
        ui: { theme: async () => ({ isDark: true }), close: () => {} },
        recipe: { run: async () => { throw Error('Install is outside this fixture'); } }
      };
    }, { cwd: repository });
    await page.goto('http://127.0.0.1:' + server.address().port + '/index.html');
    await page.locator('#workspace').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#error').isVisible(), false);
    assert.equal(await page.locator('#files img').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'portrait page fits viewport');
    await page.getByRole('button', { name: /app\.js/ }).first().click();
    await page.locator('.d2h-file-wrapper').waitFor();
    assert.ok(await page.locator('.d2h-code-linenumber').first().evaluate(el =>
      el.getBoundingClientRect().width < el.closest('table').getBoundingClientRect().width * 0.25),
    'line numbers leave most of the phone width for code');
    assert.equal(await page.locator('#diff img').count(), 0);
    assert.ok((await page.locator('#diff').innerText()).includes('<img src=x onerror=alert(1)>'));
    assert.ok(await page.locator('#diff .hljs-keyword').count(), 'real syntax highlighting runs');
    await page.locator('#previous').click();
    assert.equal(await page.locator('#diff .current-hunk').count(), 1);
    await page.locator('#layout').selectOption('side-by-side');
    assert.equal(await page.locator('.d2h-file-side-diff').count(), 2);
    await page.locator('#layout').selectOption('line-by-line');
    await page.locator('#font').selectOption('18');
    await page.locator('#wrap').uncheck();
    await page.locator('#wrap').check();
    const artifacts = process.env.MOBILE_GIT_ARTIFACTS;
    if (artifacts) {
      fs.mkdirSync(artifacts, { recursive: true });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: path.join(artifacts, 'git-portrait.png'), fullPage: true });
    }
    const appRow = page.locator('.file-row').filter({ has: page.locator('.file-path', { hasText: 'app.js' }) });
    await appRow.getByRole('button', { name: 'Stage', exact: true }).click();
    await appRow.getByRole('button', { name: 'Unstage', exact: true }).waitFor();
    assert.equal(git('diff', '--cached', '--name-only').trim(), 'app.js');
    await page.locator('#commit-message').fill('Commit through touch UI');
    await page.locator('#commit').click();
    await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    assert.equal(git('log', '-1', '--format=%s').trim(), 'Commit through touch UI');
    await page.locator('#history-tab').click();
    await page.locator('.history-row').first().waitFor();
    await page.locator('.history-row').first().click();
    await page.locator('#commit-file-list .file-open').first().click();
    await page.locator('.d2h-file-wrapper').waitFor();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator('#layout').selectOption('side-by-side');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'landscape page fits viewport');
    if (artifacts) {
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: path.join(artifacts, 'git-landscape.png'), fullPage: true });
    }
    await page.locator('#changes-tab').click();
    await page.getByRole('button', { name: /binary\.bin/ }).click();
    await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    assert.match(await page.locator('#diff-note').innerText(), /Binary file/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#setup-panel > summary').click();
    await page.locator('#check-tools').click();
    await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#tool-lazygit-version').innerText(), '0.65.1');
    assert.equal(await page.locator('#tool-lazygit-status').innerText(), '✓ Installed');
    assert.equal(await page.locator('#tools-summary').innerText(), 'All three tools are installed.');
    assert.equal(await page.locator('#install-lazygit').isVisible(), false);
    assert.equal(await page.locator('#install-delta').isVisible(), false);
    assert.equal(await page.locator('#tools').isVisible(), false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'tool cards fit portrait');
    if (artifacts) await page.locator('#setup-panel').screenshot({ path: path.join(artifacts, 'git-tools-installed.png') });
    toolFixture = 'missing';
    await page.locator('#check-tools').click();
    await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#tool-delta-status').innerText(), 'Not installed');
    assert.equal(await page.locator('#install-delta').isVisible(), true);
    assert.equal(await page.locator('#install-lazygit').isVisible(), false);
    if (artifacts) await page.locator('#setup-panel').screenshot({ path: path.join(artifacts, 'git-tools-missing.png') });
    toolFixture = 'disconnected';
    await page.locator('#check-tools').click();
    await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#tool-git-status').innerText(), 'Check unavailable');
    assert.equal(await page.locator('#tool-git-version').isVisible(), false);
    assert.equal(await page.locator('#install-delta').isVisible(), false);
    assert.match(await page.locator('#tools-summary').innerText(), /Check your connection/);
    assert.equal(await page.locator('#error').isVisible(), false);
    await page.locator('#setup-panel > summary').click();
    await page.locator('#repository').fill(temporary);
    await page.locator('#open').click();
    await page.locator('#error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#workspace').isVisible(), false, 'failed repository switch hides old write controls');
    assert.match(await page.locator('#error-message').innerText(), /Enter the path to a Git project/);
    assert.equal(await page.locator('#error').getAttribute('role'), 'status');
    assert.equal(await page.locator('#error-details').evaluate(el => el.open), false);
    assert.equal(await page.locator('#error-detail').isVisible(), false);
    assert.equal(await page.locator('#open').isEnabled(), true);
    if (artifacts) {
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: path.join(artifacts, 'git-choose-repository.png'), fullPage: true });
    }
    await page.locator('#error-details summary').click();
    assert.match(await page.locator('#error-detail').innerText(), /not a git repository/);
    await page.locator('#repository').fill(path.join(temporary, 'missing-repository'));
    await page.locator('#open').click();
    await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#error').getAttribute('role'), 'alert');
    assert.equal(await page.locator('#error-details').evaluate(el => el.open), false);
    assert.deepEqual(errors, []);
    console.log('PASS: portrait/landscape, real diff highlighting, HTML escaping, hunk controls, staging, commit, history, binary fallback, friendly tool checks and failed repository switch (' + calls.length + ' SSH requests).');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
