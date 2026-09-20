const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const plugin = path.join(__dirname, '../plugins/git');
const flush = async () => { for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve)); };

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.value = ''; this.textContent = ''; this.hidden = false;
    this.disabled = false; this.dataset = {}; this.attributes = {}; this.style = { setProperty() {} };
    this.className = ''; this.scrolled = false;
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
      toggle: (name, on) => { if (on === undefined) on = !classes.has(name); if (on) classes.add(name); else classes.delete(name); }
    };
  }
  set innerHTML(value) { throw new Error('Application inserted untrusted HTML: ' + value); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  scrollIntoView() { this.scrolled = true; }
  querySelector() { return null; }
  querySelectorAll(selector) { return this.descendants().filter(el => selector === '.d2h-info' && el.className === 'd2h-info'); }
  descendants() { return this.children.flatMap(el => [el, ...el.descendants()]); }
  async click() { if (!this.disabled && this.onclick) this.onclick(); await flush(); }
}

function harness(options = {}) {
  const elements = new Map();
  for (const match of fs.readFileSync(path.join(plugin, 'ui/index.html'), 'utf8').matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const el = new Element(match[1]); el.id = match[2]; el.hidden = /\bhidden\b/.test(match[0]);
    elements.set(el.id, el);
  }
  elements.get('wrap').checked = true;
  elements.get('layout').value = 'line-by-line';
  const all = () => [...elements.values()].flatMap(el => [el, ...el.descendants()]);
  const document = {
    getElementById: id => elements.get(id), createElement: tag => new Element(tag),
    body: new Element('body'), documentElement: new Element('html'),
    querySelectorAll(selector) {
      if (selector === 'button,input,textarea,select') return all().filter(el => ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
      if (selector === '.file-action,#fetch,#pull,#push') return all().filter(el => el.className.includes('file-action') || ['fetch','pull','push'].includes(el.id));
      return [];
    }, addEventListener() {}
  };
  const calls = [], rendered = [], stored = [];
  const changedFile = { path: 'safe.txt', index: 'M', worktree: 'M', kind: 'ordinary', staged: true, unstaged: true, untracked: false };
  const state = { root: '/work/repo', branch: 'main', oid: 'a'.repeat(40), upstream: 'origin/main', ahead: 0, behind: 0, files: [changedFile], ...options.state };
  const methods = {
    async open(directory) { calls.push(['open', directory]); if (options.open) return options.open(directory); return state; },
    async status() { calls.push(['status']); return state; },
    async diff(file, mode) { calls.push(['diff', file.path, mode]); return options.patch === undefined ? 'diff --git a/safe.txt b/safe.txt\n--- a/safe.txt\n+++ b/safe.txt\n@@ -1 +1 @@\n-old\n+new\n' : options.patch; },
    async history(input) { calls.push(['history', input]); return options.history || []; },
    async commitFiles(oid) { calls.push(['commitFiles', oid]); return [changedFile]; },
    async commitDiff(oid, file) { calls.push(['commitDiff', oid, file.path]); return ''; }
  };
  for (const name of ['stage', 'unstage', 'commit', 'fetch', 'pull', 'push']) methods[name] = async (...args) => {
    calls.push([name, ...args]);
    if (options[name]) return options[name](...args);
    return state;
  };
  const MobileSSH = {
    version: options.version || '1.2.0',
    session: async () => ({ connected: true, label: 'user@host', user: 'user', host: 'host', port: 22, cwd: options.cwd }),
    storage: { get: async key => { calls.push(['storage.get', key]); return options.saved || null; }, put: async (...args) => stored.push(args) },
    ui: { theme: async () => ({ isDark: true }), close: () => calls.push(['close']) },
    ssh: { exec: async command => { calls.push(['exec', command]); return { stdout: 'tools', stderr: '', exitCode: 0 }; } },
    recipe: { run: async step => { calls.push(['recipe', step]); return options.recipe ? options.recipe(step) : { ok: true, log: 'installed' }; } }
  };
  if (options.showTerminal) MobileSSH.ui.showTerminal = async () => { calls.push(['showTerminal']); };
  function Diff2HtmlUI(target, patch, config) {
    this.draw = () => {
      rendered.push({ patch, config });
      target.replaceChildren(...[0, 1, 2].map(() => { const el = new Element('td'); el.className = 'd2h-info'; el.textContent = '@@ hunk @@'; return el; }));
    };
    this.highlightCode = () => {};
  }
  const MobileGitTools = { check: async () => {
    calls.push(['checkTools']);
    if (options.toolCheck) return options.toolCheck();
    return { tools: [
      { id: 'git', state: 'installed', version: '2.43.0' },
      { id: 'lazygit', state: 'installed', version: '0.65.1' },
      { id: 'delta', state: 'installed', version: '0.19.2' }
    ], details: 'git version 2.43.0\ncommit=abc, version=0.65.1, arch=amd64\ndelta 0.19.2' };
  } };
  const context = vm.createContext({ document, MobileSSH, MobileGitTools, MobileGit: { Client: function () { return methods; } }, navigator: { language: options.language || 'en' }, Diff2HtmlUI });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(plugin, 'ui/i18n.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(plugin, 'ui/app.js'), 'utf8'), context);
  return { get: id => elements.get(id), calls, rendered, stored, state, document, context, all };
}

test('older bridges cannot run Git without an enforced output cap', async () => {
  const h = harness({ version: '1.1.0' }); await flush();
  assert.equal(h.get('open').disabled, true);
  assert.match(h.get('error-detail').textContent, /1\.2\.0/);
  assert.equal(h.calls.length, 0);
});

test('session directory wins over per-host storage without trimming a real path', async () => {
  const h = harness({ cwd: '/work/ spaced ', saved: '/saved' }); await flush();
  assert.deepEqual(h.calls.find(call => call[0] === 'open'), ['open', '/work/ spaced ']);
  assert.deepEqual(h.stored, [['repository:["user","host",22]', '/work/repo']]);
  assert.equal(h.calls.some(call => call[0] === 'recipe' || call[0] === 'exec'), false);
});

test('one file with staged and unstaged changes is reviewed in both groups', async () => {
  const h = harness(); await flush();
  const sections = h.get('files').children;
  assert.equal(sections[0].children[1].children[0].children[0].textContent, 'M');
  await sections[0].children[1].children[0].click();
  assert.deepEqual(h.calls.find(call => call[0] === 'diff'), ['diff', 'safe.txt', 'staged']);
  assert.equal(h.rendered[0].config.outputFormat, 'line-by-line');
  assert.equal(sections[1].children[1].children[1].textContent, 'Stage');
});

test('paths and history subjects are text, including markup-shaped content', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const h = harness({ state: { files: [{ path: evil, index: 'M', staged: true }] }, history: [{ oid: 'a'.repeat(40), subject: evil, author: evil, date: '2026-09-19' }] });
  await flush();
  assert.equal(h.get('files').children[0].children[1].children[0].children[1].textContent, evil);
  await h.get('history-tab').click();
  assert.equal(h.get('history').children[0].textContent, evil);
});

test('write controls are locked while a mutation is pending and never auto-retry', async () => {
  let reject;
  const pending = new Promise((_, no) => { reject = no; });
  const h = harness({ stage: () => pending }); await flush();
  const action = h.get('files').children[1].children[1].children[1];
  const first = action.click(); await flush();
  assert.equal(action.disabled, true);
  assert.equal(h.get('open').disabled, true);
  await action.click();
  reject(new Error('disconnected')); await first; await flush();
  assert.equal(h.calls.filter(call => call[0] === 'stage').length, 1);
  assert.match(h.get('error-message').textContent, /never retried automatically/);
});

test('successful write with failed refresh cannot be repeated before refresh', async () => {
  const h = harness({ push: async () => { throw Object.assign(new Error('connection lost after success'), { actionCompleted: true }); } }); await flush();
  await h.get('push').click();
  assert.match(h.get('error-message').textContent, /operation completed/);
  assert.equal(h.get('push').disabled, true);
  assert.equal(h.get('refresh').disabled, false);
  await h.get('refresh').click();
  assert.equal(h.get('push').disabled, false);
});

test('opening an invalid repository clears the old visible write controls', async () => {
  let count = 0;
  const state = { root: '/first', branch: 'main', files: [], oid: '' };
  const h = harness({ open: async () => { if (count++) throw Object.assign(new Error('fatal: not a git repository'), { code: 'NOT_REPOSITORY' }); return state; } }); await flush();
  h.get('error-details').open = true;
  h.get('repository').value = '/missing';
  h.get('repository-form').onsubmit({ preventDefault() {} }); await flush();
  assert.equal(h.get('workspace').hidden, true);
  assert.equal(h.get('diff-panel').hidden, true);
  assert.equal(h.get('commit').disabled, true);
  assert.match(h.get('error-message').textContent, /Enter the path to a Git project/);
  assert.doesNotMatch(h.get('error-message').textContent, /failed|Writes|fatal/);
  assert.equal(h.get('error-details').open, false);
  assert.equal(h.get('error').classList.contains('information'), true);
  assert.equal(h.get('error').attributes.role, 'status');
  assert.equal(h.get('open').disabled, false);
});

test('binary and oversized patches avoid the HTML renderer', async () => {
  for (const patch of ['Binary files a/a and b/a differ\n', 'x'.repeat(400001)]) {
    const h = harness({ patch }); await flush();
    await h.get('files').children[0].children[1].children[0].click();
    assert.equal(h.rendered.length, 0);
    assert.equal(h.get('diff-note').hidden, false);
    assert.equal(h.get('next').disabled, true);
  }
});

test('previous hunk from an unselected diff navigates to the last change', async () => {
  const h = harness(); await flush();
  await h.get('files').children[0].children[1].children[0].click();
  await h.get('previous').click();
  assert.equal(h.get('diff').children[2].classList.contains('current-hunk'), true);
  await h.get('next').click();
  assert.equal(h.get('diff').children[0].classList.contains('current-hunk'), true);
});

test('history loads commit files and per-file diff, without any write', async () => {
  const oid = 'b'.repeat(40);
  const h = harness({ history: [{ oid, subject: 'hello', author: 'User', date: '2026-09-19' }] }); await flush();
  await h.get('history-tab').click();
  await h.get('history').children[0].click();
  await h.get('commit-file-list').children[0].children[0].click();
  assert.deepEqual(h.calls.find(call => call[0] === 'commitDiff'), ['commitDiff', oid, 'safe.txt']);
  assert.equal(h.get('commit-file-list').children[0].children.length, 1);
});

test('setup offers only missing optional tools and verifies installation through a fresh check', async () => {
  let checked = 0;
  const h = harness({ toolCheck: async () => ({ tools: [
    { id: 'git', state: 'installed', version: '2.43.0' },
    { id: 'lazygit', state: checked++ ? 'installed' : 'missing', version: '' },
    { id: 'delta', state: 'installed', version: '0.19.2' }
  ], details: 'details' }) }); await flush();
  await h.get('check-tools').click();
  assert.equal(h.get('install-lazygit').hidden, false);
  assert.equal(h.get('install-delta').hidden, true);
  await h.get('install-lazygit').click();
  assert.deepEqual(h.calls.filter(call => call[0] === 'recipe'), [['recipe', 'install-lazygit']]);
  assert.equal(h.calls.filter(call => call[0] === 'checkTools').length, 2);
  assert.equal(h.get('install-lazygit').hidden, true);
  assert.equal(h.get('tools-details').open, false);
  assert.match(h.get('tools').textContent, /installed/);
});

test('installed tools show compact versions and hide installation actions and raw diagnostics', async () => {
  const h = harness(); await flush();
  await h.get('check-tools').click();
  assert.equal(h.get('tool-lazygit-version').textContent, '0.65.1');
  assert.equal(h.get('tool-lazygit-status').textContent, '✓ Installed');
  assert.equal(h.get('tools-summary').textContent, 'All three tools are installed.');
  assert.equal(h.get('install-lazygit').hidden, true);
  assert.equal(h.get('install-delta').hidden, true);
  assert.equal(h.get('tools-install-note').hidden, true);
  assert.equal(h.get('tools-details').open, false);
  assert.match(h.get('tools').textContent, /commit=abc/);
  await h.get('install-lazygit').click(); // Even a stale/programmatic action must not reinstall.
  assert.equal(h.calls.filter(call => call[0] === 'recipe').length, 0);
});

test('Git is required before optional installation and broken binaries are not marked installed', async () => {
  const h = harness({ toolCheck: async () => ({ tools: [
    { id: 'git', state: 'missing', version: '' },
    { id: 'lazygit', state: 'failed', version: '' },
    { id: 'delta', state: 'missing', version: '' }
  ], details: 'permission denied' }) }); await flush();
  await h.get('check-tools').click();
  assert.equal(h.get('tool-git-help').hidden, false);
  assert.equal(h.get('tool-lazygit-status').textContent, 'Needs attention');
  assert.match(h.get('tools-summary').textContent, /Install Git on this server/);
  assert.equal(h.get('install-lazygit').hidden, true);
  assert.equal(h.get('install-delta').hidden, true);
  await h.get('install-delta').click();
  assert.equal(h.calls.filter(call => call[0] === 'recipe').length, 0);
});

test('a disconnected recheck clears stale installed results and keeps its error in setup', async () => {
  let count = 0;
  const h = harness({ toolCheck: async () => {
    if (count++) throw new Error('SSH connection lost');
    return { tools: ['git', 'lazygit', 'delta'].map(id => ({ id, state: 'installed', version: '1.0.0' })), details: '' };
  } }); await flush();
  await h.get('check-tools').click();
  await h.get('check-tools').click();
  assert.equal(h.get('tool-git-status').textContent, 'Check unavailable');
  assert.equal(h.get('tool-git-version').hidden, true);
  assert.match(h.get('tools-summary').textContent, /Check your connection/);
  assert.equal(h.get('activity').textContent, '');
  assert.equal(h.get('error').hidden, true);
  assert.equal(h.get('check-tools').disabled, false);
  assert.equal(h.get('tools-details').open, false);
});

test('an unfinished installation shows local guidance and does not rerun or report success', async () => {
  const h = harness({
    toolCheck: async () => ({ tools: ['git', 'lazygit', 'delta'].map(id => ({ id, state: id === 'git' ? 'installed' : 'missing', version: '' })), details: '' }),
    recipe: async () => ({ ok: false, log: 'cancelled by user' })
  }); await flush();
  await h.get('check-tools').click();
  await h.get('install-delta').click();
  assert.match(h.get('tools-summary').textContent, /Installation wasn’t completed/);
  assert.equal(h.get('tools-details').open, false);
  assert.equal(h.get('error').hidden, true);
  assert.equal(h.calls.filter(call => call[0] === 'checkTools').length, 1);
  assert.deepEqual(h.calls.filter(call => call[0] === 'recipe'), [['recipe', 'install-delta']]);
});

test('terminal navigation uses native session focus and falls back to closing older hosts', async () => {
  const h = harness({ showTerminal: true }); await flush();
  await h.get('terminal').click();
  assert.deepEqual(h.calls.filter(call => /^(showTerminal|close)$/.test(call[0])), [['showTerminal']]);
  const older = harness(); await flush();
  await older.get('terminal').click();
  assert.deepEqual(older.calls.filter(call => /^(showTerminal|close)$/.test(call[0])), [['close']]);
});

test('all 20 locales have every UI string and right-to-left languages set direction', async () => {
  const source = fs.readFileSync(path.join(plugin, 'ui/i18n.js'), 'utf8');
  const start = source.indexOf('  var strings = ') + '  var strings = '.length;
  const strings = JSON.parse(source.slice(start, source.indexOf(';\n  var aliases', start)));
  assert.equal(Object.keys(strings).length, 20);
  for (const dict of Object.values(strings)) assert.deepEqual(Object.keys(dict).sort(), Object.keys(strings.en).sort());
  const h = harness({ language: 'ar-EG' }); await flush();
  assert.equal(h.document.documentElement.dir, 'rtl');
  assert.equal(h.context.t('stage'), strings['ar-EG'].stage);
});

test('installer shell parses, pins asset hashes and never edits global configuration', () => {
  const recipe = JSON.parse(fs.readFileSync(path.join(plugin, 'recipe.json'), 'utf8'));
  for (const step of recipe.steps) {
    assert.equal(spawnSync('sh', ['-n'], { input: step.run }).status, 0);
    if (!step.id.startsWith('install-')) continue;
    assert.match(step.run, /git_sha="[a-f0-9]{64}"/);
    assert.ok(step.run.indexOf('SHA-256 mismatch') < step.run.indexOf('tar -xzf'));
    assert.doesNotMatch(step.run, /sudo|git config|bashrc|profile/);
  }
});
