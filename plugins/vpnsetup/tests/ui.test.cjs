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
      // Bridge 1.5.0: the native confirmation was accepted and every entry asked for held nothing.
      remove: respond('remove', ({ deploymentIds }) => {
        jobs = jobs.filter(job => !deploymentIds.includes(job.deploymentId)); return { removed: deploymentIds, refused: [] };
      }),
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
// The recording's VPN: VPN Setup 1.0.0's delete paused when Hetzner refused the firewall (still in use) after the server and
// its IPv4 were gone, and the user then stopped it: CANCELLED, still holding its recovery question.
const halfway = (status = 'CANCELLED', extra = {}) => job('delete-1', 'delete', status, 61, {
  revision: 6, pendingStep: { kind: 'input', id: 'alpha-recovery', form: 'recovery', title: 'Setup needs attention', fields: [] }, ...extra,
  state: { phase: 'recovery', interruptedPhase: 'cleanup',
    error: { code: 'workflow_failed', message: 'Cloud firewall deletion failed (HTTP 422, resource_in_use: firewall with ID 22 is still in use). Remaining resources are retained for retry.' },
    resources: { key: { provider: 'hetzner', type: 'key', id: 11, owned: true, status: 'created' }, firewall: { provider: 'hetzner', type: 'firewall', id: 22, owned: true, status: 'created' },
      address: { provider: 'hetzner', type: 'address', id: 44, owned: true, status: 'deleted' }, server: { provider: 'hetzner', type: 'server', id: 33, owned: true, status: 'deleted' } },
    ...extra.state } });
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
  // Beside it: a delete stopped part-way, a stopped setup and one an older VPN Setup left at its checks. From bridge 1.5.0
  // they bring Delete VPN, the cloud list, Remove from list and the clear line, which must hold still as well.
  for (const version of [undefined, '1.5.0']) {
    const others = () => [halfway(), ...established(), stoppedSetup(), olderCheck('old1', 5)], lists = ['deployments', 'history', 'resources', 'clients', 'cloud'];
    const h = harness([unchecked('gamma', 70), ...others()], { version }); await flush();
    assert.equal(h.get('problem').hidden, false);
    assert.equal(h.get('leftover').hidden, !version, version);
    const idle = async () => {
      const before = h.changes(), disabled = h.disabled(), rebuilt = lists.map(id => h.get(id).rebuilt);
      const delays = [];
      for (let poll = 0; poll < 6; poll++) delays.push(await h.poll());
      assert.deepEqual(delays, Array(6).fill(10000));
      assert.equal(h.changes(), before, 'no text, visibility or list changed');
      assert.deepEqual(lists.map(id => h.get(id).rebuilt), rebuilt);
      assert.equal(h.disabled(), disabled, 'no control was disabled again');
    };
    await idle();
    const select = h.get('deployments');
    for (const [id, shown] of [['alpha', 'cloud'], ['beta', version ? 'remove' : 'resume']]) {
      select.focus(); select.value = id; select.onchange(); await flush();
      assert.equal(h.get(shown).hidden, false, id + ' on bridge ' + version);
      assert.equal(h.get('finish').hidden, !(version && id === 'alpha'));
      await idle();
    }
    select.focus(); select.value = 'gamma'; select.onchange(); await flush();
    // A real change is drawn once and then holds still.
    h.jobs = [unchecked('gamma', 72, { state: { error: { code: 'workflow_failed', message: 'Hetzner Cloud has no location fsn1.' } } }), ...others()];
    await h.poll();
    assert.equal(h.get('problem').textContent, 'Hetzner Cloud has no location fsn1.');
    const after = h.changes();
    for (let poll = 0; poll < 3; poll++) await h.poll();
    assert.equal(h.changes(), after);
  }
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

test('setups an older VPN Setup stopped at its checks are not continued, and before bridge 1.5.0 the page says an update clears them', async () => {
  const one = harness([olderCheck('old1', 30), ...established()]); await flush();
  assert.equal(one.get('new').textContent, 'Set up a VPN');
  assert.equal(one.get('new-hint').hidden, false);
  // Stopping one never removed it from the list, so the hint does not send the user there.
  assert.equal(one.get('new-hint').textContent, 'An earlier setup stopped at its checks and created nothing. Update Mobile SSH to clear it from this list.');
  assert.equal(one.get('leftover').hidden, true, 'no clear action before bridge 1.5.0');
  // Its reason still shows when it is the VPN on the page.
  assert.equal(one.get('title').textContent, 'mssh-old1');
  assert.equal(one.get('problem').textContent, 'Droplet region and size could not be verified. Check account permissions, region, plan and Ubuntu 24.04 image.');
  await one.get('new').click();
  assert.deepEqual(made(one).map(call => call[1].operation), ['setup']);
  assert.ok(!one.calls.some(call => call[0] === 'review'));
  const three = harness([olderCheck('old1', 30), olderCheck('old2', 31), olderCheck('old3', 32), ...established()]); await flush();
  assert.equal(three.get('new-hint').textContent, '3 earlier setups stopped at their checks and created nothing. Update Mobile SSH to clear them from this list.');
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

const demo = (latest = halfway()) => [latest, job('health-2', 'health', 'SUCCEEDED', 40), job('client-1', 'createClient', 'SUCCEEDED', 30), ...established()];
const texts = list => list.children.map(item => item.textContent);

test('a delete stopped part-way says what it left in the cloud, by kind, on every bridge', async () => {
  for (const version of [undefined, '1.3.0', '1.4.0', '1.5.0']) {
    const h = harness(demo(), { version }); await flush();
    assert.deepEqual(labels(h.get('deployments')), ['mssh-alpha · Delete stopped · 2 cloud resources remain'], 'bridge ' + version);
    assert.equal(h.get('status').textContent, 'Delete stopped · 2 cloud resources remain');
    assert.equal(h.get('cloud').hidden, false);
    assert.deepEqual(texts(h.get('cloud')), ['SSH key · remains', 'Firewall · remains', 'Public IP · deleted', 'Server · deleted']);
    assert.ok(texts(h.get('cloud')).every(line => !/\d/.test(line)), 'no provider ids');
    assert.match(h.get('problem').textContent, /HTTP 422, resource_in_use/, 'why it stopped');
  }
  for (const [latest, shown] of [
    [halfway('FAILED'), 'Delete failed · 2 cloud resources remain'],
    // Kept after its recovery: the worker ended it, but the VPN is half gone, not ready.
    [halfway('SUCCEEDED', { pendingStep: null, state: { phase: 'cancelled' } }), 'Delete stopped · 2 cloud resources remain'],
    [halfway('CANCELLED', { pendingStep: null, state: { phase: 'cleanupLocal', interruptedPhase: undefined, error: null,
      resources: { server: { type: 'server', id: 33, owned: true, status: 'deleted' }, key: { type: 'key', id: 11, owned: false, status: 'existing' } } } }),
    'Delete stopped · cloud resources deleted'],
    // Declined at its approval: nothing was removed.
    [job('delete-1', 'delete', 'SUCCEEDED', 61, { state: { phase: 'cancelled' } }), 'Ready']]) {
    const h = harness(demo(latest), { version: '1.5.0' }); await flush();
    assert.equal(h.get('status').textContent, shown);
    assert.equal(h.get('cloud').hidden, shown === 'Ready');
    assert.equal(h.get('finish').hidden, shown === 'Ready');
    // Kept after its recovery, it has nothing left to resume.
    if (latest.status === 'SUCCEEDED' && shown !== 'Ready') {
      assert.equal(h.get('resume').hidden, true);
      assert.equal(h.get('finish-note').textContent, 'Delete VPN removes what remains with this version of VPN Setup.');
    }
  }
  const odd = halfway('CANCELLED', { state: { resources: { constructor: { type: 'toString', id: 'x', owned: true, status: 'created' } } } });
  const h = harness(demo(odd), { version: '1.5.0' }); await flush();
  assert.deepEqual(texts(h.get('cloud')), ['Cloud resource · remains']);
});

test('before bridge 1.5.0 a stopped delete still blocks and offers only Resume', async () => {
  const h = harness(demo(), { version: '1.4.0' }); await flush();
  assert.equal(h.get('finish').hidden, true);
  assert.equal(h.get('finish-note').hidden, true);
  assert.equal(h.get('resume').hidden, false);
  assert.equal(h.get('resume').textContent, 'Resume');
  assert.equal(h.get('remove').hidden, true);
  assert.match(h.get('blocked').textContent, /Delete has not finished/);
  assert.equal(h.get('delete').hidden, true);
});

test('from bridge 1.5.0 a stopped delete offers Delete VPN with this version, and Resume continues the earlier attempt', async () => {
  const h = harness(demo(), { version: '1.5.0' }); await flush();
  assert.equal(h.get('finish').hidden, false);
  assert.equal(h.get('finish').textContent, 'Delete VPN');
  assert.equal(h.get('finish-note').textContent, 'Delete VPN removes what remains with this version of VPN Setup. Resume continues the earlier attempt as it was.');
  assert.equal(h.get('resume').textContent, 'Resume earlier delete');
  assert.equal(h.get('resume').hidden, false);
  assert.equal(h.get('cancel').hidden, true);
  // Its server may be gone: checks, clients and updates are not offered, and nothing says it is blocked.
  assert.equal(h.get('manage').hidden, true);
  assert.equal(h.get('blocked').hidden, true);
  assert.equal(h.get('remove').hidden, true, 'it still holds cloud resources');
  await h.get('finish').click();
  assert.deepEqual(plain(made(h).map(call => call[1])), [{ operation: 'delete', inputs: { deploymentId: 'alpha' } }]);
  assert.equal(h.get('job-error').hidden, true);
  // The new delete is the one shown now; the stopped one stays in the history.
  assert.deepEqual(h.get('history').children.slice(0, 2).map(li => li.textContent.split(' · ').slice(0, 2).join(' · ')), ['Delete · Starting', 'Delete · Stopped']);
  assert.equal(h.get('finish').hidden, true);
  assert.equal(h.get('resume').textContent, 'Resume');
  assert.equal(h.get('cloud').hidden, true);
  const r = harness(demo(), { version: '1.5.0' }); await flush();
  await r.get('resume').click();
  assert.deepEqual(plain(r.calls.filter(call => call[0] === 'resume')), [['resume', { id: 'delete-1', revision: 6 }]]);
  const refused = harness(demo(), { version: '1.5.0', create: async () => { throw new Error('A deployment operation is already pending'); } });
  await flush(); await refused.get('finish').click();
  assert.match(refused.get('job-error').textContent, /Another operation on this VPN has not finished/);
});

test('from bridge 1.5.0 a stopped or failed job holding only a question no longer blocks new operations', async () => {
  const question = { kind: 'input', id: 'alpha-recovery', form: 'recovery', title: 'Setup needs attention', fields: [] };
  const stopped = (status, step) => [job('health-3', 'health', status, 50, { pendingStep: step, state: { phase: 'recovery', interruptedPhase: 'health' } }), ...established()];
  for (const [version, status, step, blocked] of [['1.4.0', 'CANCELLED', question, true], ['1.5.0', 'CANCELLED', question, false], ['1.5.0', 'FAILED', question, false],
    // A request that may be in flight still blocks, as does a job that has not stopped.
    ['1.5.0', 'CANCELLED', { kind: 'ssh', id: 'alpha-health-0' }, true], ['1.5.0', 'WAITING_INPUT', question, true]]) {
    const h = harness(stopped(status, step), { version }); await flush();
    const why = version + ' ' + status + ' ' + step.kind;
    assert.equal(h.get('blocked').hidden, !blocked, why);
    assert.equal(h.get('health').hidden, blocked, why);
    assert.equal(h.get('delete').hidden, blocked, why);
    assert.equal(h.get('finish').hidden, true, 'not a delete: ' + why);
  }
  // Native says which jobs block: a stopped job whose last result its worker never read holds no step, yet still does.
  const unread = harness([job('health-3', 'health', 'CANCELLED', 50, { blocking: true, state: { phase: 'health' } }), ...established()], { version: '1.5.0' });
  await flush();
  assert.equal(unread.get('blocked').hidden, false);
  assert.equal(unread.get('health').hidden, true);
  assert.equal(unread.get('remove').hidden, true);
  const freed = harness(stopped('CANCELLED', question).map(item => ({ ...item, blocking: false })), { version: '1.5.0' }); await flush();
  assert.equal(freed.get('blocked').hidden, true);
});

test('Remove from list is offered from bridge 1.5.0 only for entries that hold nothing', async () => {
  const deleted = () => [job('delete-1', 'delete', 'SUCCEEDED', 60, { state: { phase: 'deleted',
    resources: Object.fromEntries(Object.entries(ready.resources).map(([name, value]) => [name, { ...value, status: 'deleted' }])) } }), ...established()];
  const setupWith = (id, extra) => [unchecked(id, 70, { status: 'CANCELLED', ...extra })];
  for (const [jobs, offered, why] of [
    [[stoppedSetup()], true, 'a setup stopped at its first question'],
    [setupWith('gamma'), true, 'a setup stopped at its checks'],
    [deleted(), true, 'a deleted VPN, whose setup receipts the delete superseded'],
    [established(), false, 'a VPN that still exists'],
    [demo(), false, 'a delete that left cloud resources'],
    [[stoppedSetup({ server: { type: 'server', id: 5, owned: true, status: 'created' } })], false, 'a setup holding a server'],
    [setupWith('gamma', { pendingStep: { kind: 'http', id: 'gamma-provision-0-create-0', method: 'POST' }, state: { phase: 'provision', interruptedPhase: undefined } }),
      false, 'a setup whose create may have been sent'],
    [setupWith('gamma', { pendingStep: null, state: { phase: 'recovery', interruptedPhase: 'bootstrap', mode: 'manual' } }), false, 'a setup that began installing on a server'],
    [[unchecked('gamma', 70)], false, 'a setup of this version still open']]) {
    const h = harness(jobs, { version: '1.5.0' }); await flush();
    assert.equal(h.get('remove').hidden, !offered, why);
    const older = harness(jobs, { version: '1.4.0' }); await flush();
    assert.equal(older.get('remove').hidden, true, 'bridge 1.4.0: ' + why);
  }
  const manual = harness([unchecked('gamma', 70, { status: 'CANCELLED', pendingStep: null, state: { phase: 'recovery', interruptedPhase: 'bootstrap', mode: 'manual' } })]);
  await flush();
  assert.equal(manual.get('status').textContent, 'Setup stopped · server may be partly set up');
});

test('removing an entry selects another one, or shows the empty state after the last', async () => {
  const h = harness([stoppedSetup(), ...established()], { version: '1.5.0' }); await flush();
  const select = h.get('deployments'); select.focus(); select.value = 'beta'; select.onchange(); await flush();
  assert.equal(h.get('remove').hidden, false);
  await h.get('remove').click();
  assert.deepEqual(plain(h.calls.filter(call => ['remove', 'cancel'].includes(call[0]))), [['remove', { deploymentIds: ['beta'] }]]);
  assert.deepEqual(labels(select), ['mssh-alpha · Ready']);
  assert.equal(h.get('title').textContent, 'mssh-alpha');
  assert.equal(h.get('remove').hidden, true);
  assert.equal(h.get('job-error').hidden, true);
  const last = harness([stoppedSetup()], { version: '1.5.0' }); await flush();
  await last.get('remove').click();
  assert.equal(last.get('empty').hidden, false);
  assert.equal(last.get('picker').hidden, true);
  assert.equal(last.get('current').hidden, true);
});

test('a declined confirmation shows nothing and each refusal reads as a plain sentence', async () => {
  for (const [code, shown] of [['INPUT_CANCELLED', ''],
    ['WORKFLOW_IN_PROGRESS', 'An operation of this entry has not finished. Stop it or let it finish first.'],
    ['WORKFLOW_RESOURCES_REMAIN', 'This entry may still hold cloud resources, so it stays in the list. Delete them first.'],
    ['VPN_STILL_EXISTS', 'This VPN still exists. Delete it first: removing it from the list would not delete it.'],
    ['WORKFLOW_NOT_FOUND', 'This entry is no longer saved.']]) {
    const h = harness([stoppedSetup()], { version: '1.5.0', remove: async () => { throw new Error(code); } }); await flush();
    await h.get('remove').click();
    assert.equal(h.get('job-error').textContent, shown, code);
    assert.equal(h.get('job-error').hidden, !shown, code);
    assert.deepEqual(labels(h.get('deployments')), ['mssh-beta · Setup stopped · nothing created'], 'still listed');
    assert.equal(h.get('remove').classList.contains('busy'), false);
  }
  // Resolved, yet kept: the reason for this one entry.
  const kept = harness([stoppedSetup()], { version: '1.5.0', remove: async () => ({ removed: [], refused: [{ deploymentId: 'beta', code: 'WORKFLOW_RESOURCES_REMAIN' }] }) });
  await flush(); await kept.get('remove').click();
  assert.match(kept.get('job-error').textContent, /may still hold cloud resources/);
});

test('one action clears every setup that created nothing, stopping open older ones first, with one confirmation', async () => {
  const stoppedAt = (id, minutes) => unchecked(id, minutes, { status: 'CANCELLED' });
  const holding = unchecked('delta', 3, { status: 'CANCELLED', state: { interruptedPhase: 'provision', resources: { key: { type: 'key', id: 9, owned: true, status: 'created' } } } });
  const jobs = () => [unchecked('eps', 80), olderCheck('old1', 30), olderCheck('old2', 31), stoppedAt('gamma', 20), stoppedSetup(), ...established(), holding];
  const cancel = h => async ({ id }) => { const found = h.jobs.find(item => item.id === id); h.jobs = h.jobs.map(item => item.id === id ? { ...item, status: 'CANCELLED', revision: item.revision + 1 } : item); return plain(found); };
  let h; h = harness(jobs(), { version: '1.5.0', cancel: args => cancel(h)(args) }); await flush();
  assert.equal(h.get('leftover').hidden, false);
  assert.equal(h.get('leftover-text').textContent, '4 earlier setups created nothing.');
  assert.equal(h.get('clear').textContent, 'Clear them');
  // The setup of this version is continued as before, beside the line.
  assert.equal(h.get('new-hint').textContent, 'This continues your unfinished setup. To start over instead, choose Stop workflow on it first.');
  await h.get('clear').click();
  const used = plain(h.calls.filter(call => ['cancel', 'remove', 'create', 'review'].includes(call[0])));
  assert.deepEqual(used, [['cancel', { id: 'setup-old1', revision: 7 }], ['cancel', { id: 'setup-old2', revision: 7 }],
    ['remove', { deploymentIds: ['old1', 'old2', 'gamma', 'beta'] }]], 'stops only the open older setups, then one removal');
  assert.deepEqual(h.get('deployments').children.map(option => option.value), ['eps', 'alpha', 'delta']);
  assert.equal(h.get('leftover').hidden, true);
  assert.equal(h.get('clear-error').hidden, true);
  // One left: singular wording.
  const one = harness([stoppedSetup(), ...established()], { version: '1.5.0' }); await flush();
  assert.equal(one.get('leftover-text').textContent, 'An earlier setup created nothing.');
  assert.equal(one.get('clear').textContent, 'Clear it');
  assert.equal(one.get('new-hint').hidden, true);
  // Before bridge 1.5.0 there is no clear action.
  const older = harness(jobs(), { version: '1.4.0' }); await flush();
  assert.equal(older.get('leftover').hidden, true);
  // Declined: the older setups stay stopped and listed, and no error shows.
  const declined = harness(jobs(), { version: '1.5.0', remove: async () => { throw new Error('INPUT_CANCELLED'); } }); await flush();
  await declined.get('clear').click();
  assert.equal(declined.get('clear-error').hidden, true);
  assert.equal(declined.get('deployments').children.length, 7);
  // Some kept: say how many, and where to look.
  const partly = harness(jobs(), { version: '1.5.0', remove: async ({ deploymentIds }) => {
    partly.jobs = partly.jobs.filter(item => !['gamma', 'beta'].includes(item.deploymentId));
    return { removed: ['gamma', 'beta'], refused: deploymentIds.filter(id => id.startsWith('old')).map(deploymentId => ({ deploymentId, code: 'WORKFLOW_IN_PROGRESS' })) };
  } });
  await flush(); await partly.get('clear').click();
  assert.equal(partly.get('clear-error').textContent, '2 of them stayed in the list. Open each to see why.');
  assert.equal(partly.get('clear-error').hidden, false);
});

test('a delete refused before it removed anything leaves its VPN to manage, and one whose server went leaves none, on every bridge', async () => {
  // "Keep resources and stop" after the server DELETE was refused (a read-only token): nothing was deleted.
  const kept = job('delete-1', 'delete', 'SUCCEEDED', 61, { state: { phase: 'cancelled', interruptedPhase: 'cleanup',
    resources: Object.fromEntries(Object.entries(ready.resources).map(([name, value]) => [name, { ...value, type: name }])) } });
  for (const version of ['1.3.0', '1.4.0', '1.5.0']) {
    const h = harness(demo(kept), { version }); await flush();
    assert.equal(h.get('status').textContent, 'Delete stopped · 3 cloud resources remain', version);
    assert.equal(h.get('manage').hidden, false, version);
    for (const id of ['health', 'client', 'revoke']) assert.equal(h.get(id).hidden, false, version + ' ' + id);
    // One delete control: Delete VPN, which every bridge takes once nothing blocks.
    assert.equal(h.get('finish').hidden, false, version);
    assert.equal(h.get('delete').hidden, true, version);
  }
  // The recording's delete took the server and its IPv4: no profiles, exports or admin for it on any bridge.
  for (const version of [undefined, '1.4.0', '1.5.0']) {
    const h = harness(demo(), { version }); await flush();
    assert.equal(h.get('manage').hidden, true, 'bridge ' + version);
  }
  // A new delete waiting at its recovery after the server went: what remains shows, and nothing to manage.
  const h = harness(demo(halfway('WAITING_INPUT')), { version: '1.5.0' }); await flush();
  assert.equal(h.get('status').textContent, 'Delete · Needs attention');
  assert.deepEqual(texts(h.get('cloud')), ['SSH key · remains', 'Firewall · remains', 'Public IP · deleted', 'Server · deleted']);
  assert.equal(h.get('manage').hidden, true);
  assert.equal(h.get('review').hidden, false);
  // A delete that removed only a resource holding no server or address keeps its VPN manageable.
  const rule = halfway('CANCELLED', { pendingStep: null, state: { phase: 'cancelled', resources: { server: { type: 'server', id: 33, owned: true, status: 'created' },
    firewall: { type: 'firewall', id: 22, owned: true, status: 'deleted' } } } });
  const r = harness(demo(rule), { version: '1.5.0' }); await flush();
  assert.equal(r.get('status').textContent, 'Delete stopped · 1 cloud resource remains');
  assert.equal(r.get('manage').hidden, false);
});

test('a setup on a server the user made stays out of the clear action and says the server remains', async () => {
  const manual = (id, provider) => unchecked(id, 40, { status: 'CANCELLED', pendingStep: { kind: 'input', id: id + '-confirm', form: 'confirm', title: 'Review VPN setup', fields: [] },
    state: { phase: 'confirm', interruptedPhase: undefined, error: null, provider, mode: 'manual', host: '192.0.2.40', user: 'ubuntu' } });
  const h = harness([manual('m1', 'hetzner'), stoppedSetup()], { version: '1.5.0' }); await flush();
  assert.deepEqual(labels(h.get('deployments')), ['mssh-m1 · Setup stopped · your server remains', 'mssh-beta · Setup stopped · nothing created']);
  assert.equal(h.get('leftover-text').textContent, 'An earlier setup created nothing.');
  await h.get('clear').click();
  assert.deepEqual(plain(h.calls.filter(call => call[0] === 'remove')), [['remove', { deploymentIds: ['beta'] }]]);
  // Removed only on its own, saying what stays and what is forgotten.
  assert.equal(h.get('title').textContent, 'mssh-m1');
  assert.equal(h.get('remove').hidden, false);
  assert.equal(h.get('remove-note').textContent,
    'Your server at 192.0.2.40 stays as it is. Any SSH key this setup created for it is forgotten: delete the server in your cloud console if you no longer need it.');
  const brought = harness([manual('m2', 'existing')], { version: '1.5.0' }); await flush();
  assert.equal(brought.get('leftover').hidden, true);
  assert.equal(brought.get('remove-note').textContent, 'Your server at 192.0.2.40 stays as it is. Any SSH key this setup created for it is forgotten.');
  const older = harness([manual('m2', 'existing')], { version: '1.4.0' }); await flush();
  assert.equal(older.get('remove-note').hidden, true);
  // Before it names a server, a manual setup created nothing.
  const early = harness([unchecked('m3', 40, { status: 'CANCELLED', pendingStep: null, state: { phase: 'manual', interruptedPhase: undefined, mode: 'manual' } })], { version: '1.5.0' });
  await flush();
  assert.equal(early.get('status').textContent, 'Setup stopped · nothing created');
  assert.equal(early.get('leftover').hidden, false);
  assert.equal(early.get('remove-note').hidden, true);
});

test('a setup whose recovery moved on from a create is not offered as nothing created', async () => {
  for (const [state, why] of [[{ phase: 'credential', interruptedPhase: 'provision', accountResumePhase: 'provision' }, 'new credentials asked'],
    [{ phase: 'options', interruptedPhase: 'provision' }, 'settings changed'], [{ phase: 'deleteConfirm', interruptedPhase: 'provision' }, 'removal reviewed'],
    [{ phase: 'recreateConfirm', interruptedPhase: 'provision' }, 'recreation reviewed'],
    // Its checks failed again after the change: only VPN Setup 1.0.4's note still shows the create.
    [{ phase: 'recovery', interruptedPhase: 'preflight', creationSent: true }, 'checks failed again']]) {
    const stopped = unchecked('gamma', 70, { status: 'CANCELLED', pendingStep: { kind: 'input', id: 'gamma-next', form: 'instance', title: 'Next', fields: [] }, state });
    const h = harness([stopped, stoppedSetup()], { version: '1.5.0' }); await flush();
    assert.equal(h.get('status').textContent, 'Setup stopped · cloud resources may exist', why);
    assert.equal(h.get('remove').hidden, true, why);
    assert.equal(h.get('leftover-text').textContent, 'An earlier setup created nothing.', why);
  }
});

// States the real worker produces, as the second review drove it.
const workerContext = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8'), workerContext);
const flow = workerContext.MobileSSHWorkflow;
const step = (t, event) => plain(flow.next(t.state, event));
const answer = (t, body, status = 200) => step(t, { type: 'result', requestId: t.step.id, result: { status, body } });
const hetznerReady = () => ({ version: 1, operation: 'setup', deploymentId: 'alpha', name: 'mssh-alpha', phase: 'ready', mode: 'automatic', provider: 'hetzner',
  inputs: { region: 'fsn1', size: 'cx23', sshCidr: '198.51.100.0/24' }, credentialRef: 'cloud-ref', sshCredentialRef: 'ssh-ref', publicKey: 'ssh-ed25519 AAAA',
  host: '203.0.113.10', user: 'root', clientSequence: 1, clients: [{ clientId: '1', profileId: 'p1' }],
  resources: { key: { provider: 'hetzner', type: 'key', id: 11, owned: true, status: 'created' }, firewall: { provider: 'hetzner', type: 'firewall', id: 22, owned: true, status: 'created' },
    address: { provider: 'hetzner', type: 'address', id: 44, owned: true, status: 'created' }, server: { provider: 'hetzner', type: 'server', id: 33, owned: true, status: 'created' } } });
const shownControls = h => ['finish', 'resume', 'remove', 'delete', 'health', 'connect'].filter(id => !h.get(id).hidden && !(['delete', 'health', 'connect'].includes(id) && h.get('manage').hidden));

test('a delete stopped part-way and kept offers Delete VPN on every bridge, as 1.0.3 offered its delete', async () => {
  // Second review, F2: the server went, the primary IPv4 check paused, and the user kept what remained.
  let t = plain(flow.next({ operation: 'delete', inputs: { deploymentId: 'alpha', deployment: hetznerReady() } }, { type: 'start' }));
  t = step(t, { type: 'input', value: { approved: true } });
  t = answer(answer(t, {}, 404), { primary_ip: { id: 44, assignee_id: 999 } });
  assert.equal(t.step.form, 'recovery');
  t = step(t, { type: 'input', value: { action: 'keep' } });
  const kept = job('delete-1', 'delete', 'SUCCEEDED', 61, { state: t.state });
  for (const version of [undefined, '1.3.0', '1.4.0', '1.5.0']) {
    const h = harness(demo(kept), { version }); await flush();
    assert.equal(h.get('status').textContent, 'Delete stopped · 3 cloud resources remain', version);
    assert.deepEqual(shownControls(h), ['finish'], 'bridge ' + version);
    assert.equal(h.get('finish-note').textContent, 'Delete VPN removes what remains with this version of VPN Setup.');
    await h.get('finish').click();
    assert.deepEqual(plain(made(h).map(call => call[1])), [{ operation: 'delete', inputs: { deploymentId: 'alpha' } }], 'bridge ' + version);
  }
  // Declining that new delete leaves the same choice.
  const declined = halfway('SUCCEEDED', { pendingStep: null, state: { phase: 'cancelled', interruptedPhase: undefined, error: null } });
  for (const version of ['1.3.0', '1.4.0']) {
    const h = harness(demo(declined), { version }); await flush();
    assert.deepEqual(shownControls(h), ['finish'], 'declined on ' + version);
  }
});

test('a setup whose own cleanup deleted part of it and was kept offers Delete VPN on every bridge', async () => {
  // Second review, F3: bootstrap failed, its recovery's cleanup removed the server and IPv4, the firewall stayed refused, then kept.
  let t = plain(flow.next(Object.assign(hetznerReady(), { phase: 'bootstrap', index: 4, attempt: 0, creationSent: true, clients: [], clientSequence: 0 }), { type: 'resume' }));
  t = step(t, { type: 'error', requestId: t.step.id, code: 'operation_interrupted' });
  t = step(t, { type: 'input', value: { action: 'cleanup' } });
  t = step(t, { type: 'input', value: { approved: true } });
  t = answer(answer(answer(t, {}, 404), { primary_ip: { id: 44, assignee_id: null } }), {}, 404);
  for (let i = 0; i < 100 && t.step.kind !== 'input'; i++) t = t.step.kind === 'delay' ? answer(t, {}) : answer(t, { code: 'CLOUD_HTTP_ERROR' }, 422);
  t = step(t, { type: 'input', value: { action: 'keep' } });
  const kept = { ...stoppedSetup(), id: 'setup-alpha', deploymentId: 'alpha', status: 'SUCCEEDED', pendingStep: null, state: t.state };
  for (const version of [undefined, '1.3.0', '1.4.0', '1.5.0']) {
    const h = harness([kept], { version }); await flush();
    assert.equal(h.get('status').textContent, 'Setup stopped · 2 cloud resources remain', version);
    assert.deepEqual(shownControls(h), ['finish'], 'bridge ' + version);
    assert.equal(h.get('finish-note').textContent, 'Delete VPN deletes what this setup left in the cloud, with this version of VPN Setup.');
    assert.deepEqual(texts(h.get('cloud')), ['SSH key · remains', 'Firewall · remains', 'Public IP · deleted', 'Server · deleted']);
  }
  // Stopped at its recovery instead: on bridge 1.5.0 Delete VPN or Resume, before it Resume alone.
  const asking = { ...kept, status: 'CANCELLED', pendingStep: { kind: 'input', id: 'alpha-recovery', form: 'recovery', title: 'Setup needs attention', fields: [] },
    state: { ...t.state, phase: 'recovery' } };
  const fresh = harness([asking], { version: '1.5.0' }); await flush();
  assert.deepEqual(shownControls(fresh), ['finish', 'resume']);
  assert.equal(fresh.get('resume').textContent, 'Resume');
  assert.match(fresh.get('finish-note').textContent, /Resume continues it as it was\.$/);
  const older = harness([asking], { version: '1.4.0' }); await flush();
  assert.deepEqual(shownControls(older), ['resume']);
  // A setup kept after a create that got no answer has no server to manage, yet Delete VPN looks up and deletes what it made.
  const cut = unchecked('gamma', 71, { status: 'SUCCEEDED', pendingStep: null, state: { phase: 'cancelled', interruptedPhase: 'provision',
    unanswered: { 'gamma-provision-0-create-0': 'server' } } });
  for (const version of ['1.4.0', '1.5.0']) {
    const h = harness([cut], { version }); await flush();
    assert.equal(h.get('status').textContent, 'Setup stopped · cloud resources may exist');
    assert.deepEqual(shownControls(h), ['finish'], version);
  }
  // One that created nothing still offers only removal.
  const nothing = harness([stoppedSetup()], { version: '1.5.0' }); await flush();
  assert.deepEqual(shownControls(nothing), ['resume', 'remove']);
});

test('from bridge 1.5.0 an operation stopped at its approval leaves its VPN to manage', async () => {
  for (const [operationName, phase] of [['update', 'updateConfirm'], ['createClient', 'clientConfirm'], ['delete', 'deleteConfirm']]) {
    const stoppedAt = job('op-3', operationName, 'CANCELLED', 50, { blocking: false, state: { phase },
      pendingStep: { kind: 'input', id: 'alpha-' + phase, form: 'confirm', title: 'Review', fields: [] } });
    const h = harness([stoppedAt, ...established()], { version: '1.5.0' }); await flush();
    assert.deepEqual(shownControls(h), ['resume', 'delete', 'health', 'connect'], phase);
    assert.equal(h.get('blocked').hidden, true, phase);
    // Before it, that stopped approval still blocks: Resume alone, as in 1.0.3.
    const older = harness([stoppedAt, ...established()], { version: '1.4.0' }); await flush();
    assert.deepEqual(shownControls(older), ['resume'], phase + ' on 1.4.0');
  }
  // An approval still open is a question to answer first.
  const open = harness([job('op-3', 'update', 'WAITING_INPUT', 50, { state: { phase: 'updateConfirm' },
    pendingStep: { kind: 'input', id: 'alpha-updateConfirm', form: 'confirm', title: 'Review', fields: [] } }), ...established()], { version: '1.5.0' });
  await flush();
  assert.equal(open.get('manage').hidden, true);
});

test('fields an older VPN Setup copied into a later operation never hide its VPN', async () => {
  // Second review, F7: a 1.0.3 manual delete failed at its SSH step and was kept; Check server then found the VPN running.
  const manual = { mode: 'manual', provider: 'existing', resources: {} };
  for (const extra of [{ interruptedPhase: 'deleteServer' }, { suspendedPhase: 'cleanupLocal' }, { interruptedPhase: 'cleanup' }]) {
    const checked = job('health-3', 'health', 'SUCCEEDED', 70, { state: { ...manual, phase: 'ready', ...extra } });
    for (const version of [undefined, '1.4.0', '1.5.0']) {
      const h = harness([checked, job('delete-2', 'delete', 'SUCCEEDED', 60, { state: { ...manual, phase: 'cancelled', interruptedPhase: 'deleteServer' } }),
        { ...job('setup-alpha', 'setup', 'SUCCEEDED', 10), state: { ...ready, ...manual } }], { version }); await flush();
      assert.equal(h.get('status').textContent, 'Ready', JSON.stringify(extra));
      assert.equal(h.get('manage').hidden, false, JSON.stringify(extra) + ' ' + version);
      assert.deepEqual(shownControls(h), ['delete', 'health', 'connect']);
      assert.equal(h.get('cloud').hidden, true);
    }
  }
  // A delete's own stop there still means its VPN went.
  const own = job('delete-2', 'delete', 'CANCELLED', 60, { state: { ...manual, phase: 'recovery', interruptedPhase: 'cleanupLocal' },
    pendingStep: { kind: 'input', id: 'alpha-recovery', form: 'recovery', title: 'Delete needs attention', fields: [] } });
  const h = harness([own, ...established()], { version: '1.5.0' }); await flush();
  assert.equal(h.get('manage').hidden, true);
});

test('an entry with a create no read settled, or one native found holding more, is offered Delete VPN, not removal', async () => {
  // VPN Setup 1.0.4 notes a create that got no answer until a lookup settles it.
  const noted = unchecked('gamma', 71, { status: 'CANCELLED', pendingStep: null, state: { phase: 'cancelled', interruptedPhase: 'preflight',
    unanswered: { 'gamma-provision-0-create-0': 'server' } } });
  const h = harness([noted, stoppedSetup()], { version: '1.5.0' }); await flush();
  assert.equal(h.get('remove').hidden, true);
  assert.equal(h.get('leftover-text').textContent, 'An earlier setup created nothing.');
  assert.equal(h.get('finish').hidden, false);
  // An older VPN Setup's entry the page counts as empty: native refuses it for a create it cannot see, and Delete VPN takes over.
  const older = harness([stoppedSetup()], { version: '1.5.0', remove: async () => { throw new Error('WORKFLOW_RESOURCES_REMAIN'); } }); await flush();
  assert.deepEqual(shownControls(older), ['resume', 'remove']);
  await older.get('remove').click();
  assert.match(older.get('job-error').textContent, /may still hold cloud resources/);
  assert.deepEqual(shownControls(older), ['finish', 'resume']);
  assert.equal(older.get('leftover').hidden, true, 'not counted as created nothing any more');
  await older.get('finish').click();
  assert.deepEqual(plain(made(older).map(call => call[1])), [{ operation: 'delete', inputs: { deploymentId: 'beta' } }]);
  // A new operation on it shows its own controls again.
  assert.equal(older.get('finish').hidden, true);
  // Refused among several: each refused one is remembered.
  const several = harness([stoppedSetup(), unchecked('gamma', 20, { status: 'CANCELLED' })], { version: '1.5.0', remove: async () => {
    several.jobs = several.jobs.filter(item => item.deploymentId !== 'gamma');
    return { removed: ['gamma'], refused: [{ deploymentId: 'beta', code: 'WORKFLOW_RESOURCES_REMAIN' }] };
  } }); await flush();
  await several.get('clear').click();
  assert.equal(several.get('clear-error').textContent, 'One of them stayed in the list. Open it to see why.');
  assert.equal(several.get('leftover').hidden, true);
});

test('a delete that finished after a setup stopped while creating leaves an entry Remove from list may clear', async () => {
  // The setup's droplet POST got a 503 and it was stopped; a delete then looked the droplet up, found none, and finished.
  const setup = unchecked('gamma', 30, { status: 'CANCELLED', pendingStep: null, state: { phase: 'recovery', interruptedPhase: 'provision', creationSent: true,
    unanswered: { 'gamma-provision-1-create-0': 'server' }, resources: { key: { provider: 'digitalocean', type: 'key', id: 11, owned: true, status: 'created' } } } });
  const deleted = { ...setup, id: 'delete-gamma', operation: 'delete', status: 'SUCCEEDED', updatedAt: NOW + 40 * 60000, state: { ...setup.state, phase: 'deleted',
    interruptedPhase: undefined, unanswered: {}, reconciled: { 'gamma-provision-1-create-0': 'gamma-cleanupFind-1-find-0' },
    resources: { key: { provider: 'digitalocean', type: 'key', id: 11, owned: true, status: 'deleted' } } } };
  const h = harness([deleted, setup], { version: '1.5.0' }); await flush();
  assert.equal(h.get('status').textContent, 'Deleted');
  assert.deepEqual(shownControls(h), ['remove']);
  // Before that delete finished, the stopped setup still may hold its droplet.
  const before = harness([setup], { version: '1.5.0' }); await flush();
  assert.equal(before.get('remove').hidden, true);
  // A setup stopped while creating after the last finished delete still keeps the entry.
  const later = { ...setup, id: 'setup-later', updatedAt: NOW + 50 * 60000, state: { ...setup.state, unanswered: {}, resources: {} } };
  const again = harness([later, deleted], { version: '1.5.0' }); await flush();
  assert.equal(again.get('remove').hidden, true);
});

test('a stopped delete of a setup that never reached its server still offers Delete VPN, on every bridge', async () => {
  // Third review: every Hetzner resource was made but the server never ran; the setup was kept, then Delete VPN was declined.
  const keptState = { ...hetznerReady(), host: undefined, clients: [], clientSequence: 0, phase: 'cancelled', interruptedPhase: 'provision', creationSent: true };
  const setup = { ...stoppedSetup(), id: 'setup-alpha', deploymentId: 'alpha', status: 'SUCCEEDED', pendingStep: null, state: keptState };
  const start = plain(flow.next({ operation: 'delete', inputs: { deploymentId: 'alpha', deployment: keptState } }, { type: 'start' }));
  const declined = step(start, { type: 'input', value: { approved: false } });
  assert.equal(declined.state.phase, 'cancelled');
  // job() fills in a ready VPN's fields; this one has no server address.
  const noHost = state => ({ state: { ...state, host: undefined, clients: [] } });
  const deleteJob = job('delete-1', 'delete', 'SUCCEEDED', 61, noHost(declined.state));
  for (const version of ['1.3.0', '1.4.0', '1.5.0']) {
    const h = harness([deleteJob, setup], { version }); await flush();
    assert.equal(h.get('status').textContent, 'Delete stopped · 4 cloud resources remain', version);
    assert.deepEqual(shownControls(h), ['finish'], version);
    assert.equal(h.get('finish-note').textContent, 'Delete VPN removes what remains with this version of VPN Setup.');
    await h.get('finish').click();
    assert.deepEqual(plain(made(h).map(call => call[1])), [{ operation: 'delete', inputs: { deploymentId: 'alpha' } }], version);
  }
  // A Linode setup whose server POST got no answer holds nothing, yet may have made it: kept after the delete's lookup failed.
  const cut = { ...keptState, provider: 'linode', inputs: { region: 'us-east', size: 'g6-nanode-1', sshCidr: '198.51.100.0/24' }, resources: {},
    unanswered: { 'alpha-provision-0-create-0': 'server' } };
  let lookup = step(plain(flow.next({ operation: 'delete', inputs: { deploymentId: 'alpha', deployment: cut } }, { type: 'start' })), { type: 'input', value: { approved: true } });
  lookup = answer(lookup, { code: 'CLOUD_HTTP_ERROR' }, 500);
  const keptDelete = job('delete-1', 'delete', 'SUCCEEDED', 61, noHost(step(lookup, { type: 'input', value: { action: 'keep' } }).state));
  for (const version of ['1.3.0', '1.4.0', '1.5.0']) {
    const h = harness([keptDelete, { ...setup, state: cut }], { version }); await flush();
    assert.equal(h.get('status').textContent, 'Delete stopped · cloud resources may exist', version);
    assert.deepEqual(shownControls(h), ['finish'], version);
  }
  // From bridge 1.5.0 one stopped at its approval offers it too, beside Resume; before it, that approval blocks and Resume alone stays.
  const atApproval = job('delete-1', 'delete', 'CANCELLED', 61, { ...noHost(start.state), pendingStep: start.step });
  const fresh = harness([{ ...atApproval, blocking: false }, setup], { version: '1.5.0' }); await flush();
  assert.deepEqual(shownControls(fresh), ['finish', 'resume']);
  assert.equal(fresh.get('resume').textContent, 'Resume earlier delete');
  const older = harness([atApproval, setup], { version: '1.4.0' }); await flush();
  assert.deepEqual(shownControls(older), ['resume']);
  // A declined delete of a VPN with its server leaves it to manage, as before; one of a setup that made nothing offers nothing.
  const vpn = harness([job('delete-1', 'delete', 'SUCCEEDED', 61, { state: { phase: 'cancelled' } }), ...established()], { version: '1.4.0' }); await flush();
  assert.deepEqual(shownControls(vpn), ['delete', 'health', 'connect']);
  const nothing = { ...keptState, resources: {}, creationSent: undefined, interruptedPhase: 'preflight' };
  const empty = harness([job('delete-1', 'delete', 'SUCCEEDED', 61, noHost(nothing)), { ...setup, state: nothing }], { version: '1.4.0' }); await flush();
  assert.deepEqual(shownControls(empty), []);
});

test('a setup reading the Hetzner catalog, or asking from its lists, created nothing and is continued', async () => {
  const read = { kind: 'http', id: 'gamma-catalog-server_types-1', method: 'GET', url: 'https://api.hetzner.cloud/v1/server_types?per_page=50&page=1' };
  const asking = { phase: 'catalog', interruptedPhase: undefined, error: undefined, inputs: {} };
  // Paused natively by a failed read (no network, say): Continue resumes it, which sends the read again.
  const paused = harness([unchecked('gamma', 70, { status: 'PAUSED', pendingStep: read, state: asking }), ...established()]); await flush();
  assert.equal(paused.get('new').textContent, 'Continue VPN setup');
  await paused.get('new').click();
  assert.deepEqual(plain(paused.calls.filter(call => ['review', 'resume', 'create'].includes(call[0]))), [['resume', { id: 'setup-gamma', revision: 7 }]]);
  // Stopped there: nothing was created.
  const stopped = harness([unchecked('gamma', 71, { status: 'CANCELLED', pendingStep: read, state: { ...asking, phase: 'cancelled', suspendedPhase: 'catalog' } })]); await flush();
  assert.equal(stopped.get('status').textContent, 'Setup stopped · nothing created');
  // Its listed question shows the question as asked, not the field's label.
  const question = { kind: 'input', id: 'gamma-options-0', form: 'instance', title: 'Where should the VPN server run?',
    message: 'Where should the VPN server run? These Hetzner locations can take a new server in your account now. For another one, choose Other.',
    fields: [{ key: 'region', label: 'Location', type: 'select', default: 'nbg1', options: [{ value: 'nbg1', label: 'nbg1 (suggested) · Nuremberg, DE' }, { value: '(other)', label: 'Other (type a value)' }] }] };
  const waiting = harness([unchecked('gamma', 72, { pendingStep: question, state: { ...asking, phase: 'options', catalog: { locations: [['nbg1', 'Nuremberg, DE']], types: [] } } })]); await flush();
  assert.equal(waiting.get('question').textContent, 'Where should the VPN server run?');
  assert.equal(waiting.get('problem').hidden, true);
  assert.equal(waiting.get('new').textContent, 'Continue VPN setup');
  await waiting.get('new').click();
  assert.deepEqual(waiting.calls.filter(call => call[0] === 'review').map(call => call[1].id), ['setup-gamma']);
});

test('a setup paused or stopped at one of its lists\' lookups created nothing, a Lightsail read-only POST included', async () => {
  const lookup = { kind: 'http', id: 'delta-catalog-regions-1', method: 'POST', url: 'https://lightsail.us-east-1.amazonaws.com/', readOnly: true,
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'Lightsail_20161128.GetRegions' }, body: { includeAvailabilityZones: false } };
  const asking = { provider: 'aws', phase: 'catalog', interruptedPhase: undefined, error: undefined, inputs: {}, catalog: { read: {} }, catalogRead: { name: 'regions', page: 1, attempt: 0 } };
  const paused = harness([unchecked('delta', 70, { status: 'PAUSED', pendingStep: lookup, state: asking }), ...established()]); await flush();
  assert.equal(paused.get('new').textContent, 'Continue VPN setup');
  const stopped = harness([unchecked('delta', 71, { status: 'CANCELLED', pendingStep: lookup, state: { ...asking, phase: 'cancelled', suspendedPhase: 'catalog' } })]); await flush();
  assert.equal(stopped.get('status').textContent, 'Setup stopped · nothing created');
  // A Lightsail action that changes something is still counted as a create that may have gone out.
  const create = { ...lookup, readOnly: undefined, headers: { ...lookup.headers, 'X-Amz-Target': 'Lightsail_20161128.CreateInstances' } };
  const creating = harness([unchecked('delta', 72, { status: 'CANCELLED', pendingStep: create, state: { ...asking, phase: 'cancelled', suspendedPhase: 'catalog' } })]); await flush();
  assert.notEqual(creating.get('status').textContent, 'Setup stopped · nothing created');
});
