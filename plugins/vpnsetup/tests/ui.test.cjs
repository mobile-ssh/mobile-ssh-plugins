const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ui = path.join(__dirname, '..', 'ui');
const flush = async () => { for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve)); };
const plain = value => JSON.parse(JSON.stringify(value));

class Element {
  constructor(tag, owner) {
    // Every visible change is counted: a page at rest must not redraw, relabel or toggle anything.
    this.changes = 0; this.text = ''; this.isHidden = false;
    this.tagName = tag.toUpperCase(); this.owner = owner; this.children = []; this.value = ''; this.textContent = ''; this.hidden = false;
    this.className = ''; this.attributes = {}; this.rebuilt = 0; this.disabledCount = 0; this.isDisabled = false;
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
  }
  get textContent() { return this.text; }
  set textContent(value) { value = String(value); if (value !== this.text) { this.text = value; this.changes++; } }
  get hidden() { return this.isHidden; }
  set hidden(value) { value = !!value; if (value !== this.isHidden) { this.isHidden = value; this.changes++; } }
  get disabled() { return this.isDisabled; }
  set disabled(value) { if (value && !this.isDisabled) this.disabledCount++; this.isDisabled = !!value; }
  set innerHTML(value) { throw new Error('Application inserted untrusted HTML: ' + value); }
  replaceChildren(...children) { this.children = children; this.rebuilt++; this.changes++; }
  focus() { this.owner.activeElement = this; }
  // As in a browser, only the focused element reports a blur.
  blur() { if (this.owner.activeElement !== this) return; this.owner.activeElement = null; if (this.onblur) this.onblur(); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  async click() { if (!this.disabled && !this.hidden && this.onclick) this.onclick(); await flush(); }
}

function harness(initial, options = {}) {
  const elements = new Map();
  const root = { properties: {}, attributes: {}, setAttribute(name, value) { root.attributes[name] = String(value); } };
  root.style = { setProperty(name, value) { root.properties[name] = value; } };
  const document = {
    getElementById: id => elements.get(id), createElement: tag => new Element(tag, document), activeElement: null,
    documentElement: root, addEventListener() {}
  };
  for (const [, tag, id, attributes, label] of fs.readFileSync(path.join(ui, 'index.html'), 'utf8').matchAll(/<([a-z0-9]+)[^>]*\bid="([^"]+)"([^>]*)>([^<]*)/g)) {
    const el = new Element(tag, document); el.id = id; el.hidden = /\bhidden\b/.test(attributes); el.textContent = label;
    elements.set(el.id, el);
  }
  const calls = [], timers = [];
  let jobs = plain(initial);
  const respond = (name, fallback) => async args => {
    calls.push([name, args]);
    if (options[name]) return options[name](args);
    return fallback(args);
  };
  const MobileSSH = {
    version: options.version,
    ui: { theme: async () => (options.theme ? options.theme() : {}) },
    workflows: {
      list: async () => { calls.push(['list']); return plain(jobs); },
      get: respond('get', ({ id }) => plain(jobs.find(job => job.id === id))),
      create: respond('create', ({ operation, inputs }) => {
        const deploymentId = inputs.deploymentId || 'new-deployment';
        const job = { id: 'created-' + calls.length, deploymentId, operation, status: 'READY', revision: 1, needsCredential: false,
          pendingStep: null, createdAt: NOW + 90 * 60000, updatedAt: NOW + 90 * 60000, state: { deploymentId, operation, inputs } };
        jobs.unshift(job); return plain(job);
      }),
      review: respond('review', ({ id }) => plain(jobs.find(job => job.id === id))),
      resume: respond('resume', ({ id }) => plain(jobs.find(job => job.id === id))),
      cancel: respond('cancel', ({ id }) => plain(jobs.find(job => job.id === id))),
      openVpn: respond('openVpn', () => ({ opened: true })), export: respond('export', () => ({ opened: true })),
      openAdmin: respond('openAdmin', () => ({ opened: true })), forgetCredential: respond('forgetCredential', () => ({ forgotten: true }))
    }
  };
  const context = vm.createContext({
    document, MobileSSH,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; }
  });
  context.window = context;
  context.addEventListener = () => {};
  vm.runInContext(fs.readFileSync(path.join(ui, 'app.js'), 'utf8'), context);
  const controls = () => [...elements.values()].filter(el => ['BUTTON', 'SELECT'].includes(el.tagName));
  return {
    get: id => elements.get(id), calls, document, root,
    get jobs() { return jobs; }, set jobs(value) { jobs = plain(value); },
    disabled: () => controls().reduce((sum, el) => sum + el.disabledCount, 0),
    // Visible changes so far, on the page and inside the lists and pickers it built.
    changes: () => [...elements.values()].reduce((sum, el) => sum + el.changes + el.children.reduce((inner, child) => inner + child.changes, 0), 0),
    // Runs the one background refresh the page scheduled and reports its delay.
    async poll() {
      const live = timers.filter(timer => !timer.cleared && !timer.ran);
      assert.equal(live.length, 1, 'exactly one refresh is scheduled');
      live[0].ran = true; await live[0].fn(); await flush();
      return live[0].ms;
    }
  };
}

const NOW = Date.UTC(2026, 10, 11, 12, 0);
const ready = { deploymentId: 'alpha', name: 'mssh-alpha', provider: 'hetzner', mode: 'automatic', phase: 'ready', host: '203.0.113.10',
  credentialRef: 'cloud-ref', clients: [{ clientId: '1', profileId: 'p1' }, { clientId: '2', profileId: 'p2' }],
  resources: { key: { id: 11, owned: true, status: 'created' }, firewall: { id: 22, owned: true, status: 'created' }, server: { id: 33, owned: true, status: 'created' } } };
function job(id, operation, status, minutes, extra = {}) {
  return { id, pluginId: 'io.github.mobilessh.vpnsetup', deploymentId: 'alpha', operation, status, revision: 4, needsCredential: false,
    pendingStep: null, createdAt: NOW + minutes * 60000, updatedAt: NOW + minutes * 60000, ...extra,
    state: { ...ready, operation, ...extra.state } };
}
const stoppedSetup = (resources = {}) => ({ id: 'setup-beta', deploymentId: 'beta', operation: 'setup', status: 'CANCELLED', revision: 3,
  needsCredential: false, createdAt: NOW, updatedAt: NOW,
  pendingStep: { kind: 'input', id: 'beta-provider', form: 'provider', title: 'Where should your VPN run?', fields: [] },
  state: { deploymentId: 'beta', name: 'mssh-beta', operation: 'setup', phase: 'provider', inputs: {}, resources } });
const recovery = () => job('delete-1', 'delete', 'WAITING_INPUT', 61, {
  revision: 5, pendingStep: { kind: 'input', id: 'alpha-recovery', form: 'recovery', title: 'Setup needs attention', fields: [] },
  state: { phase: 'recovery', error: { code: 'workflow_failed', message: 'Cloud firewall deletion failed (HTTP 422, resource_in_use: firewall with ID 22 is still in use). Remaining resources are retained for retry.' } } });
function fleet() {
  return [
    job('delete-1', 'delete', 'RUNNING', 60, { pendingStep: { kind: 'http', id: 'alpha-cleanup-2-delete-0' }, state: { phase: 'cleanup' } }),
    job('health-2', 'health', 'PAUSED', 50, { pendingStep: { kind: 'ssh', id: 'alpha-health-0' } }),
    job('revoke-1', 'revokeClient', 'SUCCEEDED', 40),
    job('client-1', 'createClient', 'SUCCEEDED', 30),
    job('health-1', 'health', 'SUCCEEDED', 20),
    job('setup-alpha', 'setup', 'SUCCEEDED', 10),
    stoppedSetup()
  ];
}
const labels = select => select.children.map(option => option.textContent);

test('background polling never disables controls and slows down once the job waits for the user', async () => {
  const h = harness(fleet()); await flush();
  assert.deepEqual(labels(h.get('deployments')), ['mssh-alpha · Delete · In progress', 'mssh-beta · Setup stopped · nothing created']);
  assert.deepEqual(h.get('deployments').children.map(option => option.value), ['alpha', 'beta']);
  assert.equal(h.get('deployments').value, 'alpha');
  assert.equal(h.get('title').textContent, 'mssh-alpha');
  assert.deepEqual(h.get('history').children.map(li => li.textContent.split(' · ').slice(0, 2).join(' · ')),
    ['Delete · In progress', 'Check server · Paused', 'Revoke client · Done', 'Add client · Done', 'Check server · Done', 'Setup · Done']);
  assert.equal(h.get('history').children[0].className, 'current');
  const delays = [];
  for (let poll = 0; poll < 30; poll++) {
    if (poll === 10) h.jobs = [recovery(), ...fleet().slice(1)];
    delays.push(await h.poll());
  }
  assert.equal(h.disabled(), 0);
  assert.deepEqual(delays, [...Array(11).fill(1000), ...Array(19).fill(10000)]);
  assert.equal(h.get('deployments').rebuilt, 1, 'a changed status relabels the picker in place');
  assert.equal(h.get('history').rebuilt, 2);
  assert.equal(h.get('deployments').children.length, 2);
  assert.equal(labels(h.get('deployments'))[0], 'mssh-alpha · Delete · Needs attention');
  assert.match(h.get('problem').textContent, /HTTP 422, resource_in_use/);
  assert.equal(h.get('problem').hidden, false);
  assert.equal(h.get('review').hidden, false);
  assert.equal(h.get('review').textContent, 'Continue');
  assert.equal(h.get('delete').hidden, true, 'a pending operation blocks starting another one');
  assert.match(h.get('blocked').textContent, /Delete has not finished/);
  assert.ok(!h.calls.some(call => call[0] === 'create'));
});

test('the picker keeps the chosen deployment and adds deployments only once it loses focus', async () => {
  const h = harness(fleet()); await flush();
  const select = h.get('deployments');
  select.focus(); select.value = 'beta'; select.onchange(); await flush();
  assert.equal(h.document.activeElement, null, 'a picked option gives up the focus');
  assert.equal(h.get('title').textContent, 'mssh-beta');
  assert.equal(h.get('status').textContent, 'Setup stopped · nothing created');
  assert.equal(h.get('resume').hidden, false);
  assert.ok(h.calls.some(call => call[0] === 'get' && call[1].id === 'setup-beta'), 'native voice follows the shown job');
  select.focus();
  const before = select.children, rebuilt = select.rebuilt, gamma = stoppedSetup();
  Object.assign(gamma, { id: 'setup-gamma', deploymentId: 'gamma' }); Object.assign(gamma.state, { deploymentId: 'gamma', name: 'mssh-gamma' });
  h.jobs = [job('delete-1', 'delete', 'PAUSED', 62, { pendingStep: { kind: 'http', id: 'alpha-cleanup-2-delete-0' } }), ...fleet().slice(1), gamma];
  assert.equal(await h.poll(), 10000);
  assert.equal(select.children, before, 'an open picker is not rebuilt');
  assert.equal(select.rebuilt, rebuilt);
  assert.deepEqual(labels(select), ['mssh-alpha · Delete · Paused', 'mssh-beta · Setup stopped · nothing created'], 'the options it lists are relabelled');
  assert.equal(select.value, 'beta');
  select.blur();
  assert.equal(select.rebuilt, rebuilt + 1);
  assert.deepEqual(labels(select), ['mssh-alpha · Delete · Paused', 'mssh-beta · Setup stopped · nothing created', 'mssh-gamma · Setup stopped · nothing created']);
  assert.equal(select.value, 'beta');
  assert.equal(h.get('title').textContent, 'mssh-beta');
});

test('a select that keeps the focus after its picker closes still follows the status', async () => {
  // Android WebView leaves the focus on a select whose picker was closed, so no blur redraws it.
  const h = harness(fleet()); await flush();
  const select = h.get('deployments'), before = select.children, rebuilt = select.rebuilt;
  assert.equal(labels(select)[0], 'mssh-alpha · Delete · In progress');
  select.focus();
  const step = { kind: 'http', id: 'alpha-cleanup-2-delete-0' };
  for (const [latest, shown] of [[recovery(), 'Delete · Needs attention'], [job('delete-1', 'delete', 'PAUSED', 62, { pendingStep: step }), 'Delete · Paused'],
    [job('delete-1', 'delete', 'CANCELLED', 63, { pendingStep: step }), 'Delete · Stopped']]) {
    h.jobs = [latest, ...fleet().slice(1)];
    await h.poll();
    assert.equal(h.get('status').textContent, shown);
    assert.equal(labels(select)[0], 'mssh-alpha · ' + shown, 'the closed picker reads like the status below it');
    assert.equal(h.document.activeElement, select);
  }
  assert.equal(select.children, before);
  assert.equal(select.rebuilt, rebuilt, 'relabelled in place, never rebuilt');
  assert.equal(select.value, 'alpha');
  assert.equal(h.get('resume').hidden, false);
  const clients = h.get('clients');
  clients.focus(); clients.value = '2'; clients.onchange();
  assert.equal(h.document.activeElement, null, 'a picked client gives up the focus too');
  await h.poll();
  assert.equal(clients.value, '2');
});

test('a stopped setup that still holds cloud resources says so', async () => {
  const h = harness([stoppedSetup({ server: { id: 5, owned: true, status: 'created' }, key: { id: 6, owned: false, status: 'existing' } })]);
  await flush();
  assert.deepEqual(labels(h.get('deployments')), ['mssh-beta · Setup stopped · 1 cloud resource remains']);
});

test('opening with no saved workflows shows the empty state and never creates a setup', async () => {
  const h = harness([]); await flush();
  for (let poll = 0; poll < 3; poll++) assert.equal(await h.poll(), 10000);
  assert.ok(!h.calls.some(call => call[0] === 'create'));
  assert.equal(h.get('empty').hidden, false);
  assert.equal(h.get('picker').hidden, true);
  assert.equal(h.get('current').hidden, true);
  assert.equal(h.get('notice').textContent, '');
  await h.get('new').click();
  assert.deepEqual(h.calls.filter(call => call[0] === 'create').map(call => call[1].operation), ['setup']);
  assert.equal(h.get('empty').hidden, true);
  assert.deepEqual(labels(h.get('deployments')), ['VPN · Setup · Starting']);
});

test('a refused action shows its error beside the control that was used', async () => {
  const h = harness([job('health-1', 'health', 'SUCCEEDED', 20), job('setup-alpha', 'setup', 'SUCCEEDED', 10)],
    { create: async () => { throw new Error('A deployment operation is already pending'); } });
  await flush();
  assert.equal(labels(h.get('deployments'))[0], 'mssh-alpha · Ready');
  assert.equal(h.get('manage').hidden, false);
  assert.equal(h.get('delete').hidden, false);
  await h.get('delete').click();
  assert.deepEqual(h.calls.find(call => call[0] === 'create')[1].operation, 'delete');
  assert.equal(h.calls.find(call => call[0] === 'create')[1].inputs.deploymentId, 'alpha');
  assert.equal(h.get('delete-error').hidden, false);
  assert.match(h.get('delete-error').textContent, /Another operation on this VPN has not finished/);
  assert.equal(h.get('notice').textContent, '');
  assert.equal(h.get('delete').classList.contains('busy'), false);
  for (let poll = 0; poll < 3; poll++) await h.poll();
  assert.match(h.get('delete-error').textContent, /has not finished/, 'polling keeps the error readable');
  assert.equal(h.disabled(), 0);
});

test('only the pressed action shows busy and a second tap explains the wait', async () => {
  let finish;
  const h = harness([recovery(), ...fleet().slice(2)], { review: () => new Promise(resolve => { finish = resolve; }) });
  await flush();
  const review = h.get('review');
  assert.equal(review.hidden, false);
  await review.click();
  assert.equal(review.classList.contains('busy'), true);
  assert.equal(review.attributes['aria-busy'], 'true');
  await h.poll();
  assert.equal(review.classList.contains('busy'), true, 'a background refresh does not end the action');
  await h.get('cancel').click();
  assert.match(h.get('job-error').textContent, /Wait until “Continue” finishes/);
  assert.ok(!h.calls.some(call => call[0] === 'cancel'));
  finish(recovery()); await flush();
  assert.equal(review.classList.contains('busy'), false);
  assert.equal(review.attributes['aria-busy'], 'false');
  assert.equal(h.get('job-error').hidden, true);
  assert.equal(h.disabled(), 0);
  const closed = harness([recovery()], { review: async () => { throw new Error('INPUT_CANCELLED'); } });
  await flush(); await closed.get('review').click();
  assert.equal(closed.get('job-error').hidden, true, 'closing the native review is not an error');
});

test('every wait note goes once the action it waited for ends', async () => {
  let finish;
  const h = harness([job('health-1', 'health', 'SUCCEEDED', 20), job('setup-alpha', 'setup', 'SUCCEEDED', 10)],
    { forgetCredential: () => new Promise(resolve => { finish = resolve; }) });
  await flush();
  await h.get('forget').click();
  for (const id of ['health', 'delete', 'export']) await h.get(id).click();
  const slots = ['manage-error', 'delete-error', 'client-error'];
  for (const slot of slots) {
    assert.equal(h.get(slot).hidden, false, slot);
    assert.match(h.get(slot).textContent, /Wait until “Forget cloud account credentials” finishes/);
  }
  assert.ok(!h.calls.some(call => ['create', 'export'].includes(call[0])));
  finish({ forgotten: true }); await flush();
  for (const slot of [...slots, 'forget-error']) assert.equal(h.get(slot).hidden, true, slot + ' is cleared');
  await h.get('health').click();
  assert.deepEqual(h.calls.filter(call => call[0] === 'create').map(call => call[1].operation), ['health']);
  for (let poll = 0; poll < 3; poll++) await h.poll();
  for (const slot of slots) assert.equal(h.get(slot).textContent, '', slot + ' stays clear');
});

const checked = health => [job('health-1', 'health', 'SUCCEEDED', 20, { state: { health } }), job('setup-alpha', 'setup', 'SUCCEEDED', 10)];

test('Update WireGuard is offered only from bridge 1.4.0 and only while no operation is pending', async () => {
  for (const [version, offered] of [[undefined, false], ['1.3.0', false], ['1.3.9', false], ['1.4.0-beta.1', false], ['1.4', false], ['next', false],
    ['1.4.0', true], ['1.4.0+build.7', true], ['1.4.2', true], ['1.10.0', true], ['2.0.0', true]]) {
    const h = harness(checked({ healthy: true, clients: [] }), { version }); await flush();
    assert.equal(h.get('manage').hidden, false);
    assert.equal(h.get('update').hidden, !offered, 'bridge ' + version);
    assert.equal(h.get('health').hidden, false, 'other operations stay offered');
  }
  const busy = harness(fleet(), { version: '1.4.0' }); await flush();
  assert.equal(busy.get('update').hidden, true, 'a pending operation blocks the update too');
  assert.equal(busy.get('health').hidden, true);
  const h = harness(checked({ healthy: true, clients: [] }), { version: '1.4.0' }); await flush();
  await h.get('update').click();
  assert.deepEqual(plain(h.calls.filter(call => call[0] === 'create').map(call => call[1])), [{ operation: 'update', inputs: { deploymentId: 'alpha' } }]);
  assert.match(h.get('history').children[0].textContent, /^Update WireGuard · Starting/);
  const refused = harness(checked({}), { version: '1.4.0', create: async () => { throw new Error('A deployment operation is already pending'); } });
  await flush(); await refused.get('update').click();
  assert.match(refused.get('manage-error').textContent, /Another operation on this VPN has not finished/);
});

test('a check shows the running WireGuard version and whether an update is available', async () => {
  for (const [health, shown] of [
    [{ healthy: true, clients: [], target: '15.5.0', version: '15.4.0', current: false }, 'WireGuard 15.4.0 · update to 15.5.0 available'],
    [{ healthy: true, clients: [], target: '15.5.0', version: '15.5.0', current: true, updated: true }, 'WireGuard 15.5.0 · up to date'],
    // "current" was measured against the pin of the bundle that checked: an older bundle's pin is not this release.
    [{ healthy: true, clients: [], target: '15.4.0', version: '15.4.0', current: true }, 'WireGuard 15.4.0 · update to 15.5.0 available'],
    [{ healthy: true, current: true }, 'WireGuard version unknown · update to 15.5.0 available'],
    [{ healthy: true, current: false }, 'WireGuard version unknown · update to 15.5.0 available'],
    [{ healthy: true, current: false, version: '<b>15</b>', target: 'x' }, 'WireGuard version unknown · update to 15.5.0 available'],
    [{ healthy: true, clients: [] }, ''], [undefined, '']]) {
    const h = harness(checked(health), { version: '1.3.0' }); await flush();
    assert.equal(h.get('wireguard').textContent, shown);
    assert.equal(h.get('wireguard').hidden, !shown);
  }
});

test('Update WireGuard is not offered while the last check found this release running', async () => {
  for (const [health, offered] of [
    [{ healthy: true, clients: [], target: '15.5.0', version: '15.5.0', current: true }, false],
    [{ healthy: true, clients: [], target: '15.4.0', version: '15.4.0', current: true }, true],
    [{ healthy: true, clients: [], target: '15.5.0', version: '15.4.0', current: false }, true],
    [{ healthy: true, clients: [] }, true], [undefined, true]]) {
    const h = harness(checked(health), { version: '1.4.0' }); await flush();
    assert.equal(h.get('update').hidden, !offered, JSON.stringify(health));
  }
});

// The custom properties styles.css gives :root, by the colour scheme the WebView reports and the page's data-theme.
function tokens(scheme, theme) {
  const values = {};
  const css = fs.readFileSync(path.join(ui, 'styles.css'), 'utf8');
  for (const [, media, selector, body] of css.matchAll(/(?:@media\(prefers-color-scheme:(\w+)\)\{)?(:root[^{]*)\{([^}]*)\}/g)) {
    if (media && media !== scheme) continue;
    if (![...selector.slice(':root'.length).matchAll(/(:not\()?\[data-theme=(\w+)\]\)?/g)].every(([, not, value]) => (value === theme) !== !!not)) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+):([^;]+)/g)) values[name] = value;
  }
  return values;
}
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + 0.05) / (dark + 0.05); };

test('a dark host theme brings dark error and muted text even when the WebView reports light mode', async () => {
  // PluginHostActivity.themeJson as app 2.25 sends it, in light and dark mode alike.
  const host = { accent: '#2196F3', background: '#1a1a2e', surface: '#23233a', text: '#eeeeee', isDark: true };
  const h = harness([], { theme: () => host }); await flush();
  assert.equal(h.root.properties['--surface'], '#23233a');
  assert.equal(h.root.attributes['data-theme'], 'dark');
  for (const scheme of ['light', 'dark']) {
    const page = tokens(scheme, 'dark');
    assert.equal(page['--danger'], '#ff9da1');
    assert.equal(page['--muted'], '#a6bac5');
    for (const token of ['--danger', '--muted']) for (const behind of [host.background, host.surface])
      assert.ok(contrast(page[token], behind) >= 4.5, scheme + ' mode: ' + token + ' on ' + behind);
  }
  // With no theme from the host the WebView's mode decides, and a light host theme stays light in dark mode.
  assert.equal(tokens('light')['--danger'], '#a3272d');
  assert.equal(tokens('dark')['--danger'], '#ff9da1');
  assert.equal(tokens('dark', 'light')['--muted'], '#5d6b74');
  const light = harness([], { theme: () => ({ isDark: false }) }); await flush();
  assert.equal(light.root.attributes['data-theme'], 'light');
  const older = harness([]); await flush();
  assert.equal(older.root.attributes['data-theme'], undefined);
});

// A setup stopped by its read-only checks: it waits on the settings question and created nothing.
const unchecked = (id, minutes, extra = {}) => ({ id: 'setup-' + id, pluginId: 'io.github.mobilessh.vpnsetup', deploymentId: id, operation: 'setup',
  status: 'WAITING_INPUT', revision: 7, needsCredential: false, createdAt: NOW + minutes * 60000, updatedAt: NOW + minutes * 60000,
  pendingStep: { kind: 'input', id: id + '-recovery', form: 'recovery', title: 'Check the server settings',
    message: 'Server type cx23 is sold out in fsn1 right now. Locations with it: nbg1.', fields: [] },
  ...extra,
  state: { deploymentId: id, name: 'mssh-' + id, operation: 'setup', provider: 'hetzner', mode: 'automatic', phase: 'recovery', interruptedPhase: 'preflight',
    inputs: { region: 'fsn1', size: 'cx23' }, resources: {}, error: { code: 'workflow_failed', message: 'Server type cx23 is sold out in fsn1 right now. Locations with it: nbg1.' },
    ...extra.state } });
const established = () => [job('health-1', 'health', 'SUCCEEDED', 20), job('setup-alpha', 'setup', 'SUCCEEDED', 10)];
const made = h => h.calls.filter(call => call[0] === 'create');

test('Set up a VPN continues an unfinished setup that created nothing instead of starting another', async () => {
  const h = harness([unchecked('gamma', 70), ...established()]); await flush();
  assert.equal(h.get('new').textContent, 'Continue VPN setup');
  assert.equal(h.get('new-hint').hidden, false);
  assert.equal(h.get('title').textContent, 'mssh-gamma');
  assert.equal(h.get('question').textContent, 'Check the server settings');
  assert.equal(h.get('problem').textContent, 'Server type cx23 is sold out in fsn1 right now. Locations with it: nbg1.');
  assert.equal(h.get('problem').hidden, false);
  // From another VPN too: the button brings the unfinished setup up and opens its question.
  const select = h.get('deployments'); select.focus(); select.value = 'alpha'; select.onchange(); await flush();
  assert.equal(h.get('title').textContent, 'mssh-alpha');
  assert.equal(h.get('new').textContent, 'Continue VPN setup');
  await h.get('new').click();
  assert.deepEqual(made(h), []);
  assert.deepEqual(h.calls.filter(call => call[0] === 'review').map(call => call[1].id), ['setup-gamma']);
  assert.equal(h.get('title').textContent, 'mssh-gamma');
  assert.equal(select.value, 'gamma');
  assert.equal(h.get('new-error').hidden, true);
  assert.equal(h.get('new').classList.contains('busy'), false);
});

test('the shown unfinished setup is continued first, otherwise the latest one', async () => {
  const jobs = [unchecked('older', 30), unchecked('newer', 50), ...established()];
  const latest = harness(jobs); await flush();
  const select = latest.get('deployments'); select.focus(); select.value = 'alpha'; select.onchange(); await flush();
  await latest.get('new').click();
  assert.deepEqual(latest.calls.filter(call => call[0] === 'review').map(call => call[1].id), ['setup-newer']);
  const shown = harness(jobs); await flush();
  const picker = shown.get('deployments'); picker.focus(); picker.value = 'older'; picker.onchange(); await flush();
  await shown.get('new').click();
  assert.deepEqual(shown.calls.filter(call => call[0] === 'review').map(call => call[1].id), ['setup-older']);
  assert.deepEqual(made(latest).concat(made(shown)), []);
});

test('continuing a paused or running setup resumes it, asks for credentials or just shows it', async () => {
  const credential = harness([unchecked('gamma', 70, { status: 'PAUSED', needsCredential: true, pendingStep: { kind: 'http', id: 'gamma-preflight-0' } })]);
  await flush(); await credential.get('new').click();
  assert.deepEqual(credential.calls.filter(call => ['review', 'resume', 'create'].includes(call[0])).map(call => call[0]), ['review']);
  const paused = harness([unchecked('gamma', 70, { status: 'PAUSED', pendingStep: null })]);
  await flush(); await paused.get('new').click();
  assert.deepEqual(plain(paused.calls.filter(call => ['review', 'resume', 'create'].includes(call[0]))), [['resume', { id: 'setup-gamma', revision: 7 }]]);
  const running = harness([unchecked('gamma', 70, { status: 'RUNNING', pendingStep: { kind: 'http', id: 'gamma-preflight-0' }, state: { phase: 'preflight' } }), ...established()]);
  await flush();
  assert.equal(running.get('new').textContent, 'Continue VPN setup');
  const select = running.get('deployments'); select.focus(); select.value = 'alpha'; select.onchange(); await flush();
  await running.get('new').click();
  assert.deepEqual(running.calls.filter(call => ['review', 'resume', 'create'].includes(call[0])), []);
  assert.equal(running.get('title').textContent, 'mssh-gamma');
});

test('a setup holding cloud resources, or a stopped one, does not block a new setup', async () => {
  const holding = unchecked('gamma', 70, { pendingStep: { kind: 'input', id: 'gamma-recovery', form: 'recovery', title: 'Setup needs attention', fields: [] },
    state: { interruptedPhase: 'provision', resources: { key: { id: 11, owned: true, status: 'created' } } } });
  const h = harness([holding, ...established()]); await flush();
  assert.equal(h.get('new').textContent, 'Set up a VPN');
  assert.equal(h.get('new-hint').hidden, true);
  await h.get('new').click();
  assert.deepEqual(made(h).map(call => call[1].operation), ['setup']);
  assert.ok(!h.calls.some(call => call[0] === 'review'));
  // Stop workflow is the way to start over: the stopped setup no longer takes the button.
  const s = harness([unchecked('gamma', 70)]); await flush();
  assert.equal(s.get('new').textContent, 'Continue VPN setup');
  await s.get('cancel').click();
  s.jobs = [unchecked('gamma', 71, { status: 'CANCELLED' })];
  await s.poll();
  assert.equal(s.get('new').textContent, 'Set up a VPN');
  assert.equal(s.get('status').textContent, 'Setup stopped · nothing created');
  await s.get('new').click();
  assert.deepEqual(made(s).map(call => call[1].operation), ['setup']);
});

test('nothing on the page changes between polls while a setup waits on its settings question', async () => {
  const h = harness([unchecked('gamma', 70), ...established(), stoppedSetup()]); await flush();
  assert.equal(h.get('problem').hidden, false);
  const before = h.changes(), disabled = h.disabled(), rebuilt = ['deployments', 'history', 'resources', 'clients'].map(id => h.get(id).rebuilt);
  const delays = [];
  for (let poll = 0; poll < 6; poll++) delays.push(await h.poll());
  assert.deepEqual(delays, Array(6).fill(10000));
  assert.equal(h.changes(), before, 'no text, visibility or list changed');
  assert.deepEqual(['deployments', 'history', 'resources', 'clients'].map(id => h.get(id).rebuilt), rebuilt);
  assert.equal(h.disabled(), disabled, 'no control was disabled again');
  // A real change is drawn once and then holds still.
  h.jobs = [unchecked('gamma', 72, { state: { error: { code: 'workflow_failed', message: 'Hetzner Cloud has no location fsn1.' } } }), ...established(), stoppedSetup()];
  await h.poll();
  assert.equal(h.get('problem').textContent, 'Hetzner Cloud has no location fsn1.');
  const after = h.changes();
  for (let poll = 0; poll < 3; poll++) await h.poll();
  assert.equal(h.changes(), after);
});

test('native error codes are never shown as they are', async () => {
  for (const [code, shown] of [['NATIVE_REVIEW_REQUIRED', 'The workflow could not be updated. Try again.'], ['INPUT_CANCELLED', ''],
    ['NO_PENDING_INPUT', 'This step no longer needs an answer.'], ['Workflow not found', 'Workflow not found']]) {
    const h = harness([unchecked('gamma', 70)], { review: async () => { throw new Error(code); } }); await flush();
    await h.get('new').click();
    assert.equal(h.get('new-error').textContent, shown, code);
    assert.equal(h.get('new-error').hidden, !shown, code);
    await h.get('review').click();
    assert.equal(h.get('job-error').textContent, shown, code);
  }
});

// As VPN Setup 1.0.0-1.0.2 left a setup its checks stopped: a recovery with no message, whose default checks again.
const olderCheck = (id, minutes) => unchecked(id, minutes, {
  pendingStep: { kind: 'input', id: id + '-recovery', form: 'recovery', title: 'Setup needs attention', fields: [] },
  state: { error: { code: 'workflow_failed', message: 'Droplet region and size could not be verified. Check account permissions, region, plan and Ubuntu 24.04 image.' } } });

test('setups an older VPN Setup stopped at its checks are not continued, and the page says how to clear them', async () => {
  const one = harness([olderCheck('old1', 30), ...established()]); await flush();
  assert.equal(one.get('new').textContent, 'Set up a VPN');
  assert.equal(one.get('new-hint').hidden, false);
  assert.equal(one.get('new-hint').textContent, 'An earlier setup stopped at its checks and created nothing. Choose Stop workflow on it to clear it.');
  // Its reason still shows when it is the VPN on the page.
  assert.equal(one.get('title').textContent, 'mssh-old1');
  assert.equal(one.get('problem').textContent, 'Droplet region and size could not be verified. Check account permissions, region, plan and Ubuntu 24.04 image.');
  await one.get('new').click();
  assert.deepEqual(made(one).map(call => call[1].operation), ['setup']);
  assert.ok(!one.calls.some(call => call[0] === 'review'));
  const three = harness([olderCheck('old1', 30), olderCheck('old2', 31), olderCheck('old3', 32), ...established()]); await flush();
  assert.equal(three.get('new-hint').textContent, '3 earlier setups stopped at their checks and created nothing. Choose Stop workflow on each to clear them.');
  // A setup of this version beside them is the one continued, with its own hint.
  const mixed = harness([olderCheck('old1', 30), unchecked('gamma', 20)]); await flush();
  assert.equal(mixed.get('new').textContent, 'Continue VPN setup');
  assert.equal(mixed.get('new-hint').textContent, 'This continues your unfinished setup. To start over instead, choose Stop workflow on it first.');
  await mixed.get('new').click();
  assert.deepEqual(mixed.calls.filter(call => call[0] === 'review').map(call => call[1].id), ['setup-gamma']);
});

test('Set up a VPN reads the journal first: a setup started since the last poll is continued, not doubled', async () => {
  const h = harness(established()); await flush();
  assert.equal(h.get('new').textContent, 'Set up a VPN');
  // Voice started a setup; the page has not polled since.
  h.jobs = [unchecked('gamma', 70, { pendingStep: { kind: 'input', id: 'gamma-provider', form: 'provider', title: 'Where should your VPN run?', fields: [] },
    state: { phase: 'provider', interruptedPhase: undefined, error: null } }), ...established()];
  await h.get('new').click();
  assert.deepEqual(made(h), []);
  assert.deepEqual(h.calls.filter(call => call[0] === 'review').map(call => call[1].id), ['setup-gamma']);
  assert.equal(h.get('title').textContent, 'mssh-gamma');
});

test('a setup whose create may be under way is not offered as nothing created', async () => {
  const cut = unchecked('gamma', 70, { status: 'PAUSED', pendingStep: { kind: 'http', id: 'gamma-provision-0-create-0', method: 'POST' },
    state: { phase: 'provision', interruptedPhase: undefined, error: null } });
  const h = harness([cut, ...established()]); await flush();
  assert.equal(h.get('new').textContent, 'Set up a VPN');
  assert.equal(h.get('new-hint').hidden, true);
  for (const [stopped, why] of [
    [{ ...cut, status: 'CANCELLED' }, 'POST cut off, then Stop workflow'],
    [unchecked('gamma', 71, { status: 'SUCCEEDED', pendingStep: null, state: { phase: 'cancelled', interruptedPhase: 'provision' } }), 'kept after a failed create'],
    [unchecked('gamma', 71, { status: 'CANCELLED', pendingStep: null, state: { phase: 'wait', interruptedPhase: undefined } }), 'stopped while waiting for the server']]) {
    const s = harness([stopped]); await flush();
    assert.equal(s.get('status').textContent, 'Setup stopped · cloud resources may exist', why);
    assert.equal(s.get('new').textContent, 'Set up a VPN', why);
  }
  // Stopped at its checks: nothing was sent that creates anything.
  const checks = harness([unchecked('gamma', 71, { status: 'CANCELLED' })]); await flush();
  assert.equal(checks.get('status').textContent, 'Setup stopped · nothing created');
});

test('a setting asked again shows why under its question', async () => {
  const reason = 'Use only letters, digits, dots, underscores, colons and hyphens, with no spaces.';
  const h = harness([unchecked('gamma', 70, { pendingStep: { kind: 'input', id: 'gamma-options-0', form: 'instance', title: 'Location', message: reason,
    error: { code: 'invalid_setting', message: reason }, fields: [{ key: 'region', label: 'Location', default: 'fsn1' }] }, state: { phase: 'options' } })]);
  await flush();
  assert.equal(h.get('question').textContent, 'Location');
  assert.equal(h.get('problem').textContent, reason);
  assert.equal(h.get('problem').hidden, false);
});

test('native codes a retry cannot change say so, and stale answers read as a change', async () => {
  for (const [code, shown] of [['STALE_WORKFLOW_ANSWER', 'The workflow changed in the meantime. Check its current state and try again.'],
    ['WORKFLOW_RUNTIME_UNAVAILABLE', 'This version of Mobile SSH can\'t run this step. Update Mobile SSH.'],
    ['CREDENTIAL_FORM_REQUIRED', 'This version of Mobile SSH can\'t run this step. Update Mobile SSH.'],
    ['constructor', 'constructor'], ['toString', 'toString']]) {
    const h = harness([unchecked('gamma', 70)], { review: async () => { throw new Error(code); } }); await flush();
    await h.get('review').click();
    assert.equal(h.get('job-error').textContent, shown, code);
  }
});
