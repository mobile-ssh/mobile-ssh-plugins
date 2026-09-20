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
  const navigationBase = Array.from({ length: 80 }, (_, i) =>
    'const navigationLine' + i + ' = "' + (i === 7 ? 'DELETE_ONLY_ORIGINAL' : 'original value ' + i) +
    ' with enough source text to wrap on a narrow phone screen";');
  fs.writeFileSync(path.join(repository, 'navigation.js'), navigationBase.join('\n') + '\n');
  git('add', '--all'); git('commit', '-m', 'Initial fixture');
  base[1] = 'const value1 = "<img src=x onerror=alert(1)>";';
  base[30] = 'const value30 = 300;';
  fs.writeFileSync(path.join(repository, 'app.js'), base.join('\n') + '\n');
  fs.writeFileSync(path.join(repository, 'binary.bin'), Buffer.from([0, 1, 3]));
  const navigationChanged = navigationBase.flatMap((line, i) => {
    if (i === 2) return ['const firstBlock = "FIRST_BLOCK_AFTER with wrapped source text for the phone screen";'];
    if (i === 4) return [line, 'const insertedOnly = "INSERT_ONLY_AFTER with wrapped source text for the phone screen";'];
    if (i === 7) return [];
    if (i >= 29 && i <= 34) return ['const longBlock' + i + ' = "LONG_BLOCK_AFTER_' + i + ' with wrapped source text for the phone screen";'];
    if (i === 64) return ['const lastBlock = "LAST_BLOCK_AFTER with wrapped source text for the phone screen";'];
    return [line];
  });
  fs.writeFileSync(path.join(repository, 'navigation.js'), navigationChanged.join('\n') + '\n');
  assert.equal((git('diff', '--', 'navigation.js').match(/^@@ /gm) || []).length, 3,
    'navigation fixture has five change blocks across three Git hunks');
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
    const artifacts = process.env.MOBILE_GIT_ARTIFACTS;
    if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
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
    await page.addInitScript(({ cwd, isDark }) => {
      window.MobileSSH = {
        version: '1.2.0', session: async () => ({ host: 'fixture.invalid', user: 'fixture', port: 22, connected: true, label: 'fixture@fixture.invalid', cwd }),
        ssh: { exec: (command, options) => window.fixtureExec(command, options) },
        storage: { get: async () => null, put: async () => {} },
        ui: { theme: async () => isDark ? { isDark } :
          { isDark, background: '#f8f9fa', surface: '#ffffff', text: '#202124', accent: '#1967d2' }, close: () => {} },
        recipe: { run: async () => { throw Error('Install is outside this fixture'); } }
      };
    }, { cwd: repository, isDark: process.env.MOBILE_GIT_THEME !== 'light' });
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
    async function selectedChange(index, total, marker) {
      await page.waitForFunction(({ index, total, marker }) => {
        const position = document.getElementById('change-position');
        const changed = Array.from(document.querySelectorAll('#diff .current-change'));
        return position.textContent === 'Change ' + index + ' of ' + total &&
          changed.some(cell => cell.textContent.includes(marker));
      }, { index, total, marker });
      assert.equal(await page.locator('#previous').isEnabled(), index > 1, 'Previous stops at the first change');
      assert.equal(await page.locator('#next').isEnabled(), index < total, 'Next stops at the last change');
      await page.waitForFunction(() => {
        const cell = document.querySelector('#diff .current-change');
        const toolbar = document.querySelector('.diff-toolbar').getBoundingClientRect();
        const bounds = cell.getBoundingClientRect();
        return bounds.top >= toolbar.bottom + 10 && bounds.top < innerHeight - 20;
      }, null, { timeout: 5000 });
    }
    async function captureNavigation(name) {
      if (!artifacts) return;
      await page.waitForFunction(() => {
        const cell = document.querySelector('#diff .current-change').getBoundingClientRect();
        const toolbar = document.querySelector('.diff-toolbar').getBoundingClientRect();
        return Math.abs(cell.top - toolbar.bottom - 12) < 2;
      });
      await page.screenshot({ path: path.join(artifacts, name) });
    }
    async function panDiff() {
      return page.locator('#diff, #diff .d2h-file-diff, #diff .d2h-file-side-diff').evaluateAll(elements => {
        return elements.filter(el => el.scrollWidth > el.clientWidth).map(el => {
          el.scrollLeft = Math.min(80, el.scrollWidth - el.clientWidth);
          return { className: el.className, offset: el.scrollLeft };
        });
      });
    }
    async function assertDiffPan(expected) {
      const actual = await page.locator('#diff, #diff .d2h-file-diff, #diff .d2h-file-side-diff').evaluateAll(elements =>
        elements.filter(el => el.scrollWidth > el.clientWidth).map(el => ({ className: el.className, offset: el.scrollLeft })));
      assert.ok(expected.some(el => el.offset > 0), 'the no-wrap fixture is horizontally panned');
      assert.deepEqual(actual, expected, 'Previous/Next preserves horizontal scroll when lines do not wrap');
    }
    async function stepChange(direction, index, total, marker) {
      await page.locator('#' + direction).click();
      await selectedChange(index, total, marker);
    }
    async function assertSplitRowsAligned(label) {
      // Compare every corresponding rendered row, including context, hunk headers,
      // and the empty side of insertions/deletions. Text wraps asymmetrically.
      await page.waitForFunction(() => {
        const panes = Array.from(document.querySelectorAll('#diff .d2h-file-side-diff'));
        if (panes.length !== 2) return false;
        const rows = panes.map(pane => Array.from(pane.querySelectorAll('tbody tr')));
        return rows[0].length === rows[1].length && rows[0].every((row, index) => {
          const left = row.getBoundingClientRect(), right = rows[1][index].getBoundingClientRect();
          return Math.abs(left.top - right.top) < 1 && Math.abs(left.height - right.height) < 1;
        });
      }, null, { timeout: 5000 }).catch(async error => {
        const mismatches = await page.locator('#diff .d2h-file-side-diff').evaluateAll(panes => {
          const rows = panes.map(pane => Array.from(pane.querySelectorAll('tbody tr')));
          return rows[0].flatMap((row, index) => {
            const left = row.getBoundingClientRect(), right = rows[1][index].getBoundingClientRect();
            return Math.abs(left.top - right.top) < 1 && Math.abs(left.height - right.height) < 1 ? [] :
              [{ row: index, leftTop: left.top, rightTop: right.top, leftHeight: left.height, rightHeight: right.height }];
          }).slice(0, 6);
        });
        throw new Error(label + ': split rows do not align: ' + JSON.stringify(mismatches), { cause: error });
      });
      const overflow = await page.locator('#diff .d2h-file-side-diff').evaluateAll(panes =>
        document.getElementById('wrap').checked ? panes.filter(pane => pane.scrollWidth > pane.clientWidth + 1)
          .map(pane => ({ width: pane.clientWidth, scrollWidth: pane.scrollWidth, scrollLeft: pane.scrollLeft, tableWidth: pane.querySelector('table').getBoundingClientRect().width,
            overflowing: Array.from(pane.querySelectorAll('*')).filter(el => el.getBoundingClientRect().right > pane.getBoundingClientRect().right + 1 || el.scrollWidth > el.clientWidth + 1)
              .slice(0, 4).map(el => ({ className: el.className, width: el.getBoundingClientRect().width, text: el.textContent.slice(0, 100) })) })) : []);
      assert.deepEqual(overflow, [], label + ': wrapped code fits each pane');
    }
    async function assertPinnedSplitGutters(label) {
      await page.waitForFunction(() => {
        const panes = Array.from(document.querySelectorAll('#diff .d2h-file-side-diff'));
        return panes.length === 2 && panes[0].scrollLeft > 0 && Math.abs(panes[0].scrollLeft - panes[1].scrollLeft) < 1;
      });
      const gutters = await page.locator('#diff .d2h-file-side-diff').evaluateAll(panes => panes.map(pane => {
        const toolbar = document.querySelector('.diff-toolbar').getBoundingClientRect();
        const bounds = pane.getBoundingClientRect();
        const cell = Array.from(pane.querySelectorAll('.d2h-code-side-linenumber')).find(candidate => {
          const rect = candidate.getBoundingClientRect();
          return /\d/.test(candidate.textContent) && rect.top >= toolbar.bottom && rect.top < innerHeight - 20;
        });
        if (!cell) return { missing: true };
        const rect = cell.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(8, rect.height / 2));
        return { offset: rect.left - bounds.left, width: rect.width, paneWidth: bounds.width,
          background: getComputedStyle(cell).backgroundColor, onTop: !!hit && cell.contains(hit) };
      }));
      for (const gutter of gutters) {
        assert.equal(gutter.missing, undefined, label + ': a visible numbered row exists');
        assert.ok(Math.abs(gutter.offset) < 2, label + ': the gutter stays at the visible pane edge: ' + JSON.stringify(gutter));
        assert.ok(gutter.width > 10 && gutter.width < gutter.paneWidth / 2, label + ': line numbers stay readable');
        assert.match(gutter.background, /^rgb\([^)]*\)$/, label + ': gutters have an opaque background');
        assert.equal(gutter.onTop, true, label + ': code cannot paint over line numbers');
      }
    }
    await selectedChange(1, 2, 'value1');
    await stepChange('next', 2, 2, 'value30');
    await page.locator('#layout').selectOption('side-by-side');
    assert.equal(await page.locator('.d2h-file-side-diff').count(), 2);
    await selectedChange(2, 2, 'value30');
    await assertSplitRowsAligned('short replacement');
    await stepChange('previous', 1, 2, 'value1');
    await page.locator('#layout').selectOption('line-by-line');
    await selectedChange(1, 2, 'value1');

    await page.getByRole('button', { name: /navigation\.js/ }).first().click();
    await selectedChange(1, 5, 'FIRST_BLOCK_AFTER');
    assert.equal(await page.locator('#diff .d2h-info').filter({ hasText: '@@' }).count(), 3,
      'the real renderer groups the first three changes in one hunk');
    await stepChange('next', 2, 5, 'INSERT_ONLY_AFTER');
    await captureNavigation('git-change-unified-portrait.png');
    await page.locator('#wrap').uncheck();
    const unifiedPan = await panDiff();
    await stepChange('next', 3, 5, 'DELETE_ONLY_ORIGINAL');
    await assertDiffPan(unifiedPan);
    await page.locator('#wrap').check();
    await stepChange('next', 4, 5, 'LONG_BLOCK_AFTER_29');
    assert.equal(await page.locator('#diff .current-change').count(), 12,
      'the six-line replacement highlights one contiguous block of removed and added lines');
    await stepChange('next', 5, 5, 'LAST_BLOCK_AFTER');
    await stepChange('previous', 4, 5, 'LONG_BLOCK_AFTER_29');
    await page.locator('#layout').selectOption('side-by-side');
    await selectedChange(4, 5, 'LONG_BLOCK_AFTER_29');
    await assertSplitRowsAligned('narrow wrapped replacements and one-sided changes');
    await page.locator('#font').selectOption('18');
    await assertSplitRowsAligned('larger text');
    const largeTextHeight = await page.locator('#diff .d2h-diff-table').first().evaluate(table => table.getBoundingClientRect().height);
    await page.locator('#font').selectOption('12');
    await assertSplitRowsAligned('smaller text');
    const smallTextHeight = await page.locator('#diff .d2h-diff-table').first().evaluate(table => table.getBoundingClientRect().height);
    assert.ok(smallTextHeight < largeTextHeight, 'smaller text reclaims row height instead of retaining old spacers');
    await page.locator('#font').selectOption('14');
    await assertSplitRowsAligned('restored text size');
    assert.equal(await page.locator('#diff .current-change').count(), 12);
    await stepChange('previous', 3, 5, 'DELETE_ONLY_ORIGINAL');
    assert.equal(await page.locator('.d2h-file-side-diff').nth(0).locator('.current-change').count(), 1,
      'split deletion selects the actual changed cell on the left');
    assert.equal(await page.locator('.d2h-file-side-diff').nth(1).locator('.current-change').count(), 0);
    await stepChange('previous', 2, 5, 'INSERT_ONLY_AFTER');
    assert.equal(await page.locator('.d2h-file-side-diff').nth(0).locator('.current-change').count(), 0);
    assert.equal(await page.locator('.d2h-file-side-diff').nth(1).locator('.current-change').count(), 1,
      'split insertion selects the actual changed cell on the right');
    await captureNavigation('git-change-split-portrait.png');
    await page.locator('#wrap').uncheck();
    await assertSplitRowsAligned('unwrapped lines');
    const splitPan = await panDiff();
    await stepChange('previous', 1, 5, 'FIRST_BLOCK_AFTER');
    await assertDiffPan(splitPan);
    await assertPinnedSplitGutters('horizontally panned split');
    if (artifacts) await page.screenshot({ path: path.join(artifacts, 'git-split-pinned-gutters.png') });
    await page.locator('#diff .d2h-file-side-diff').nth(1).evaluate(pane => { pane.scrollLeft = 120; });
    await assertPinnedSplitGutters('panning the right pane synchronizes both gutters');
    await page.locator('#wrap').check();
    await assertSplitRowsAligned('wrapping restored after horizontal pan');
    await page.setViewportSize({ width: 844, height: 390 });
    await assertSplitRowsAligned('landscape resize');
    await stepChange('next', 2, 5, 'INSERT_ONLY_AFTER');
    await stepChange('next', 3, 5, 'DELETE_ONLY_ORIGINAL');
    await stepChange('next', 4, 5, 'LONG_BLOCK_AFTER_29');
    await stepChange('next', 5, 5, 'LAST_BLOCK_AFTER');
    await assertSplitRowsAligned('navigation to final change');
    const landscapeHeight = await page.locator('#diff .d2h-diff-table').first().evaluate(table => table.getBoundingClientRect().height);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForFunction(height => document.querySelector('#diff .d2h-diff-table').getBoundingClientRect().height > height,
      landscapeHeight);
    await assertSplitRowsAligned('small phone resize');
    const narrowHeight = await page.locator('#diff .d2h-diff-table').first().evaluate(table => table.getBoundingClientRect().height);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForFunction(height => document.querySelector('#diff .d2h-diff-table').getBoundingClientRect().height < height,
      narrowHeight);
    await assertSplitRowsAligned('wide viewport resize');
    const wideHeight = await page.locator('#diff .d2h-diff-table').first().evaluate(table => table.getBoundingClientRect().height);
    assert.ok(wideHeight < narrowHeight, 'wider panes reclaim unneeded wrapped row height');
    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator('#layout').selectOption('line-by-line');
    await selectedChange(5, 5, 'LAST_BLOCK_AFTER');
    await page.locator('#layout').selectOption('side-by-side');
    await selectedChange(5, 5, 'LAST_BLOCK_AFTER');
    await assertSplitRowsAligned('returning to split layout');
    await page.locator('#layout').selectOption('line-by-line');
    await selectedChange(5, 5, 'LAST_BLOCK_AFTER');
    await stepChange('previous', 4, 5, 'LONG_BLOCK_AFTER_29');
    await page.setViewportSize({ width: 390, height: 844 });
    await stepChange('previous', 3, 5, 'DELETE_ONLY_ORIGINAL');
    await page.getByRole('button', { name: /<img onerror=alert\(1\)>\.txt/ }).first().click();
    await selectedChange(1, 1, 'Untracked source');
    await page.getByRole('button', { name: /app\.js/ }).first().click();
    await selectedChange(1, 2, 'value1');
    await page.locator('#font').selectOption('18');
    await page.locator('#wrap').uncheck();
    await page.locator('#wrap').check();
    if (artifacts) {
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
    await selectedChange(1, 2, 'value1');
    await stepChange('next', 2, 2, 'value30');
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
    assert.equal(await page.locator('#change-position').isVisible(), false);
    assert.equal(await page.locator('#previous').isEnabled(), false);
    assert.equal(await page.locator('#next').isEnabled(), false);
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
    console.log('PASS: portrait/landscape, real diff highlighting, HTML escaping, change-block navigation and visible scrolling in both layouts, aligned split rows after wrapping/font/viewport changes, pinned opaque line-number gutters and synchronized panning, staging, commit, history, binary fallback, friendly tool checks and failed repository switch (' + calls.length + ' SSH requests).');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
