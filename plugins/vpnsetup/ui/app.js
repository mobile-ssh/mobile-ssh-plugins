(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  // The wg-easy release this bundle installs; tools/check-image-pins.mjs keeps it equal to worker.js's pin.
  const RELEASE = '15.5.0';
  const OPERATIONS = {setup:'Setup',health:'Check server',createClient:'Add client',revokeClient:'Revoke client',update:'Update WireGuard',delete:'Delete'};
  const STATUS = {READY:'Starting',RUNNING:'In progress',WAITING_INPUT:'Waiting for you',PAUSED:'Paused',SUCCEEDED:'Done',FAILED:'Failed',CANCELLED:'Stopped'};
  // Each control reports its errors in the slot beside it, where the tap happened.
  const SLOTS = {new:'new-error',review:'job-error',resume:'job-error',cancel:'job-error',connect:'manage-error',health:'manage-error',
    client:'manage-error',update:'manage-error',revoke:'client-error',export:'client-error',admin:'client-error',delete:'delete-error',forget:'forget-error'};
  const CHANGED = 'The workflow changed in the meantime. Check its current state and try again.';
  const ERRORS = {'A deployment operation is already pending':'Another operation on this VPN has not finished. Continue or resume it first.',
    'Workflow changed':CHANGED,'Workflow cannot resume':CHANGED,NO_PENDING_INPUT:'This step no longer needs an answer.',
    NO_PENDING_CREDENTIAL_INPUT:'The cloud credentials are available again. Resume the workflow instead.',
    INPUT_EXPIRED:'The review timed out. Open it again to continue.',DEPLOYMENT_NOT_READY:'This VPN has no finished setup to work on yet.',
    BRIDGE_UPGRADE_REQUIRED:'Update Mobile SSH to use this version of VPN Setup.',STALE_WORKFLOW_ANSWER:CHANGED};
  // Codes a retry cannot change: no "Try again" for them.
  ['WORKFLOW_CAPABILITY_DENIED','WORKFLOW_RUNTIME_UNAVAILABLE','WORKFLOW_UNAVAILABLE','INVALID_OPERATION','CREDENTIAL_FORM_REQUIRED']
    .forEach(code => { ERRORS[code] = 'This version of Mobile SSH can\'t run this step. Update Mobile SSH.'; });
  // Other native codes are not for reading: they get a plain sentence instead.
  const readable = reason => (Object.prototype.hasOwnProperty.call(ERRORS, reason) ? ERRORS[reason]
    : /^[A-Z][A-Z0-9_]*$/.test(reason) ? 'The workflow could not be updated. Try again.' : reason) || 'The workflow could not be updated.';
  let groups = [], chosen = null, followed = null, running = null, timer = null, stopped = false, requested = 0, applied = 0;
  // Slots showing "Wait until … finishes", one per control tapped while an action ran.
  const drawn = {}, waiting = new Set();
  const status = job => String(job.status || '').toUpperCase();
  const operation = job => job.operation || (job.state || {}).operation || 'setup';
  const finished = job => ['SUCCEEDED','FAILED','CANCELLED','COMPLETED'].includes(status(job));
  // Mirrors the native journal: an unfinished job, or one still holding a step, blocks new operations on its deployment.
  const pending = job => !finished(job) || !!job.pendingStep;
  // Only these advance on their own; paused and waiting jobs need the user first.
  const progressing = job => ['READY','RUNNING'].includes(status(job));
  // Cloud resources the job's receipts still hold.
  const held = job => Object.values((job.state || {}).resources || {}).filter(value => value && value.owned && value.status !== 'deleted').length;
  // A setup that reached its creates may hold one no receipt shows yet: a create cut off, or still in flight.
  const creating = job => {
    const state = job.state || {}, step = job.pendingStep || {}, at = ['recovery','cancelled'].includes(state.phase) ? state.interruptedPhase : state.phase;
    return ['provision','wait'].includes(at) || step.kind === 'http' && String(step.method || 'GET').toUpperCase() !== 'GET';
  };
  // A setup VPN Setup 1.0.0-1.0.2 stopped at its read-only checks: its recovery has no message, and its first answer only
  // repeats the failing check. It created nothing; a new setup asks the settings question instead.
  const oldCheck = job => (job.pendingStep || {}).form === 'recovery' && !(job.pendingStep || {}).message && (job.state || {}).interruptedPhase === 'preflight';
  const CONTINUES = 'This continues your unfinished setup. To start over instead, choose Stop workflow on it first.';
  const selection = () => groups.find(item => item.id === chosen);
  const current = () => { const deployment = selection(); return deployment && deployment.current; };
  function message(value) { if ($('notice').textContent !== value) $('notice').textContent = value; }
  function text(id, value) { if ($(id).textContent !== value) $(id).textContent = value; }
  function show(id, value) { text(id, value); $(id).hidden = !value; }
  function statusText(job) {
    const st = status(job), state = job.state || {}, step = job.pendingStep || {};
    if (st === 'WAITING_INPUT') return step.form === 'recovery' ? 'Needs attention' : STATUS[st];
    if (st === 'PAUSED' && job.needsCredential === true) return 'Needs cloud credentials';
    if (st === 'SUCCEEDED' && state.phase === 'cancelled') return 'Stopped';
    if (st === 'SUCCEEDED' && state.phase === 'deleted') return 'Deleted';
    return STATUS[st] || st.replace(/_/g, ' ').toLowerCase() || 'Unknown';
  }
  const named = job => OPERATIONS[operation(job)] || operation(job);
  // Semver at least: bridge 1.4.0 runs the update operation; older hosts refuse it, so it is not offered there.
  function atLeast(version, wanted) {
    const parse = value => { const part = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value || '')); return part && [+part[1], +part[2], +part[3], !part[4]]; };
    const have = parse(version), need = parse(wanted);
    if (!have) return false;
    for (let at = 0; at < 3; at++) if (have[at] !== need[at]) return have[at] > need[at];
    return have[3] || !need[3]; // A prerelease comes before its release.
  }
  // The last check's result: health and update receipts carry the running wg-easy version and whether it ran the pin of the
  // bundle that checked (its target). It is up to date only if that pin is this bundle's: a newer bundle has a newer release.
  const latest = health => !!health && health.current === true && health.target === RELEASE;
  function wireguard(health) {
    const value = health || {}, plain = item => typeof item === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(item) ? item : '';
    if (typeof value.current !== 'boolean') return '';
    return 'WireGuard ' + (plain(value.version) || 'version unknown') + ' · ' + (latest(value) ? 'up to date' : 'update to ' + RELEASE + ' available');
  }
  // One line per deployment: what it is now, not every job that ever ran for it.
  function summary(deployment) {
    const job = deployment.current, state = job.state || {}, st = status(job);
    const established = deployment.jobs.some(item => operation(item) === 'setup' && status(item) === 'SUCCEEDED' && (item.state || {}).phase === 'ready');
    if (!established && operation(job) === 'setup' && (['CANCELLED','FAILED'].includes(st) || state.phase === 'cancelled')) {
      const count = held(job), touched = (state.clients || []).length || ['bootstrap','import'].includes(state.phase);
      return 'Setup stopped · ' + (count ? count + ' cloud resource' + (count === 1 ? ' remains' : 's remain') : creating(job) ? 'cloud resources may exist'
        : touched ? 'server may be partly set up' : 'nothing created');
    }
    if (!pending(job) && state.phase === 'deleted') return 'Deleted';
    if (!pending(job) && established && st === 'SUCCEEDED') return 'Ready';
    return named(job) + ' · ' + statusText(job);
  }
  function group(list) {
    const byId = new Map();
    list.forEach(job => { const id = job.deploymentId || (job.state || {}).deploymentId || job.id; if (!byId.has(id)) byId.set(id, []); byId.get(id).push(job); });
    return [...byId].map(([id, jobs]) => {
      jobs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return {id, jobs, current: jobs.find(pending) || jobs[0]};
    });
  }
  const ongoing = job => operation(job) === 'setup' && ['READY','RUNNING','WAITING_INPUT','PAUSED'].includes(status(job));
  // A setup that has not stopped and holds no cloud resource is continued rather than started again beside it:
  // the shown one first, else the latest. "Stop workflow" on it is the way to start over.
  function unfinished() {
    const found = groups.filter(item => ongoing(item.current) && !held(item.current) && !creating(item.current) && !oldCheck(item.current));
    return found.find(item => item.id === chosen) || found.sort((a, b) => (b.current.updatedAt || 0) - (a.current.updatedAt || 0))[0];
  }
  function when(job) {
    if (!Number.isFinite(job.updatedAt)) return '';
    try { return ' · ' + new Date(job.updatedAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); } catch (_) { return ''; }
  }
  // Polling redraws only what changed. It never rebuilds or reselects a focused select, since rebuilding closes an open
  // picker, but relabels the options it already lists: Android WebView keeps the focus on a select after its picker closes.
  function options(id, items, value) {
    const select = $(id), key = JSON.stringify(items), focused = document.activeElement === select;
    if (drawn[id] !== key) {
      const shown = Array.from(select.children), labels = new Map(items);
      const same = shown.length === items.length && shown.every((option, at) => option.value === items[at][0]);
      if (same || focused) shown.forEach(option => { const label = labels.get(option.value); if (label !== undefined && option.textContent !== label) option.textContent = label; });
      else select.replaceChildren(...items.map(([itemValue, label]) => { const option = document.createElement('option'); option.value = itemValue; option.textContent = label; return option; }));
      // Options added, removed or moved while the select is focused wait for its blur, which draws again.
      if (same || !focused) drawn[id] = key;
    }
    if (!focused && select.value !== value) select.value = value;
  }
  function list(id, items) {
    const key = JSON.stringify(items);
    if (drawn[id] === key) return;
    drawn[id] = key;
    $(id).replaceChildren(...items.map(([value, mark]) => { const li = document.createElement('li'); li.textContent = value; if (mark) li.className = 'current'; return li; }));
  }
  function draw() {
    const deployment = selection(), job = deployment && deployment.current, resumable = !!unfinished();
    const old = groups.filter(item => ongoing(item.current) && oldCheck(item.current)).length;
    text('new', resumable ? 'Continue VPN setup' : 'Set up a VPN');
    show('new-hint', resumable ? CONTINUES : old === 1 ? 'An earlier setup stopped at its checks and created nothing. Choose Stop workflow on it to clear it.'
      : old ? old + ' earlier setups stopped at their checks and created nothing. Choose Stop workflow on each to clear them.' : '');
    $('empty').hidden = groups.length > 0; $('picker').hidden = !groups.length;
    options('deployments', groups.map(item => [item.id, ((item.current.state || {}).name || 'VPN') + ' · ' + summary(item)]), chosen || '');
    $('current').hidden = !job; if (!job) return;
    const state = job.state || {}, step = job.pendingStep || {}, st = status(job), blocked = pending(job);
    text('title', state.name || 'VPN'); text('status', summary(deployment));
    text('endpoint', state.host ? 'Server: ' + state.host : '');
    text('question', state.phase === 'deleted' && state.mode === 'manual'
      ? 'VPN removed. Delete any unused VM, disks and public IP in your cloud console to stop their charges.'
      : st === 'WAITING_INPUT' && step.title || '');
    // A recovery's reason, or why a setting is asked again.
    show('problem', step.form === 'recovery' && state.error && state.error.message || step.error && step.error.message || '');
    const credential = st === 'PAUSED' && job.needsCredential === true;
    $('review').hidden = !(st === 'WAITING_INPUT' && step.kind === 'input') && !credential;
    text('review', credential ? 'Review cloud credentials' : step.form === 'confirm' ? 'Review and approve' : 'Continue');
    $('resume').hidden = !['PAUSED','FAILED','CANCELLED'].includes(st); $('cancel').hidden = finished(job);
    list('history', deployment.jobs.slice(0, 8).map(item => [named(item) + ' · ' + statusText(item) + when(item), item === job]));
    list('resources', Object.entries(state.resources || {}).map(([key, value]) => [key + ': ' + (value.id || 'pending') + ' · ' + (value.status || 'created')]));
    $('manage').hidden = !state.host || !['ready','cancelled','recovery'].includes(state.phase);
    // The journal refuses another operation until this one finishes, so do not offer one.
    show('blocked', blocked ? named(job) + ' has not finished. Continue or resume it before starting another operation on this VPN.' : '');
    ['health','client','revoke','delete'].forEach(id => { $(id).hidden = blocked; });
    // Not offered while the last check found this release running: an update would only stop this phone's VPN for nothing.
    $('update').hidden = blocked || !atLeast(window.MobileSSH.version, '1.4.0') || latest(state.health);
    show('wireguard', wireguard(state.health));
    const clients = (state.clients || []).map(client => [String(client.clientId), 'Client ' + client.clientId]), picked = $('clients').value;
    options('clients', clients, clients.some(([value]) => value === picked) ? picked : clients.length ? clients[0][0] : '');
    $('revoke').disabled = !clients.length; $('export').disabled = !clients.length; $('forget').hidden = !state.credentialRef;
  }
  // Native voice answers for the job this page acts on.
  function follow() {
    const job = current();
    if (!job || job.id === followed) return;
    followed = job.id; MobileSSH.workflows.get({id: job.id}).catch(() => {});
  }
  async function refresh() {
    const mine = ++requested;
    const value = await MobileSSH.workflows.list();
    if (mine < applied) return;
    applied = mine; groups = group(Array.isArray(value) ? value : value && value.jobs || []);
    if (!selection()) { const next = groups.find(item => progressing(item.current)) || groups.find(item => pending(item.current)) || groups[0]; chosen = next ? next.id : null; }
    follow(); draw();
  }
  function schedule() {
    clearTimeout(timer);
    if (stopped || document.hidden) return;
    const job = current();
    timer = setTimeout(update, job && progressing(job) ? 1000 : 10000);
  }
  async function update() {
    try { await refresh(); message(''); } catch (_) { message('Saved VPN workflows could not be loaded. Retrying shortly.'); }
    schedule();
  }
  // Only a user action shows progress, and only on the control that started it.
  async function action(id, task) {
    const control = $(id), slot = SLOTS[id];
    if (running) { waiting.add(slot); show(slot, 'Wait until “' + running + '” finishes, then try again.'); return; }
    running = control.textContent; control.classList.add('busy'); control.setAttribute('aria-busy', 'true'); show(slot, '');
    let failure = '';
    try { await task(); }
    catch (error) { const reason = String(error && error.message || ''); if (reason !== 'INPUT_CANCELLED') failure = readable(reason); }
    // Every wait note goes when the action it waited for ends, beside whichever control showed it.
    waiting.forEach(item => show(item, '')); waiting.clear();
    show(slot, failure);
    running = null; control.classList.remove('busy'); control.setAttribute('aria-busy', 'false');
    await update();
  }
  async function create(operationName, inputs) {
    const job = await MobileSSH.workflows.create({operation: operationName, inputs: inputs || {}});
    if (job && job.deploymentId) chosen = job.deploymentId;
    return job;
  }
  async function manage(operationName) { await create(operationName, {deploymentId: chosen, clientId: operationName === 'revokeClient' ? $('clients').value : undefined}); }
  // Shows the unfinished setup and opens its question, or resumes it, instead of creating another.
  async function setup() {
    // The journal as it is now, not as of the last poll: a setup voice started meanwhile is continued, not doubled.
    await refresh();
    const found = unfinished();
    if (!found) return create('setup');
    if (chosen !== found.id) { chosen = found.id; new Set(Object.values(SLOTS)).forEach(slot => show(slot, '')); follow(); draw(); }
    const job = found.current, st = status(job);
    if (st === 'WAITING_INPUT' && (job.pendingStep || {}).kind === 'input' || st === 'PAUSED' && job.needsCredential === true) await MobileSSH.workflows.review({id: job.id});
    else if (st === 'PAUSED') await MobileSSH.workflows.resume({id: job.id, revision: job.revision});
  }
  $('new').onclick = () => action('new', setup);
  // A picked option gives up the focus: Android WebView would keep it on the closed select, holding back its redraws.
  $('deployments').onchange = () => { chosen = $('deployments').value; new Set(Object.values(SLOTS)).forEach(slot => show(slot, '')); $('deployments').blur(); follow(); draw(); schedule(); };
  $('clients').onchange = () => $('clients').blur();
  $('deployments').onblur = draw; $('clients').onblur = draw;
  $('review').onclick = () => action('review', () => MobileSSH.workflows.review({id: current().id}));
  $('resume').onclick = () => action('resume', () => MobileSSH.workflows.resume({id: current().id, revision: current().revision}));
  $('cancel').onclick = () => action('cancel', () => MobileSSH.workflows.cancel({id: current().id, revision: current().revision}));
  $('health').onclick = () => action('health', () => manage('health')); $('client').onclick = () => action('client', () => manage('createClient'));
  $('update').onclick = () => action('update', () => manage('update'));
  $('connect').onclick = () => action('connect', () => MobileSSH.workflows.openVpn({id: current().id}));
  $('export').onclick = () => action('export', () => MobileSSH.workflows.export({id: current().id, clientId: $('clients').value}));
  $('admin').onclick = () => action('admin', () => MobileSSH.workflows.openAdmin({id: current().id}));
  $('forget').onclick = () => action('forget', () => MobileSSH.workflows.forgetCredential({id: current().id}));
  $('revoke').onclick = () => action('revoke', () => manage('revokeClient')); $('delete').onclick = () => action('delete', () => manage('delete'));
  async function init() {
    if (!window.MobileSSH || !MobileSSH.workflows) { message('VPN Setup requires Mobile SSH with workflow bridge 1.3.0 or newer.'); $('new').disabled = true; return; }
    try {
      const theme = await MobileSSH.ui.theme();
      for (const [key, value] of Object.entries({accent: theme.accent, bg: theme.background, surface: theme.surface, text: theme.text})) if (value) document.documentElement.style.setProperty('--' + key, value);
      // The host's colours keep their mode whatever the WebView reports: the tokens it sends none of (error, muted) follow them.
      if (typeof theme.isDark === 'boolean') document.documentElement.setAttribute('data-theme', theme.isDark ? 'dark' : 'light');
    } catch (_) {}
    // Opening the page never starts a setup; the empty state offers "Set up a VPN".
    await update();
  }
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); });
  window.addEventListener('pageshow', () => { if (stopped) { stopped = false; update(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else if (!stopped) update(); });
  init();
})();
