(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const OPERATIONS = {setup:'Setup',health:'Check server',createClient:'Add client',revokeClient:'Revoke client',delete:'Delete'};
  const STATUS = {READY:'Starting',RUNNING:'In progress',WAITING_INPUT:'Waiting for you',PAUSED:'Paused',SUCCEEDED:'Done',FAILED:'Failed',CANCELLED:'Stopped'};
  // Each control reports its errors in the slot beside it, where the tap happened.
  const SLOTS = {new:'new-error',review:'job-error',resume:'job-error',cancel:'job-error',connect:'manage-error',health:'manage-error',
    client:'manage-error',revoke:'client-error',export:'client-error',admin:'client-error',delete:'delete-error',forget:'forget-error'};
  const CHANGED = 'The workflow changed in the meantime. Check its current state and try again.';
  const ERRORS = {'A deployment operation is already pending':'Another operation on this VPN has not finished. Continue or resume it first.',
    'Workflow changed':CHANGED,'Workflow cannot resume':CHANGED,NO_PENDING_INPUT:'This step no longer needs an answer.',
    NO_PENDING_CREDENTIAL_INPUT:'The cloud credentials are available again. Resume the workflow instead.',
    INPUT_EXPIRED:'The review timed out. Open it again to continue.',DEPLOYMENT_NOT_READY:'This VPN has no finished setup to work on yet.'};
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
  // One line per deployment: what it is now, not every job that ever ran for it.
  function summary(deployment) {
    const job = deployment.current, state = job.state || {}, st = status(job);
    const established = deployment.jobs.some(item => operation(item) === 'setup' && status(item) === 'SUCCEEDED' && (item.state || {}).phase === 'ready');
    if (!established && operation(job) === 'setup' && (['CANCELLED','FAILED'].includes(st) || state.phase === 'cancelled')) {
      const held = Object.values(state.resources || {}).filter(value => value && value.owned && value.status !== 'deleted').length;
      const touched = (state.clients || []).length || ['bootstrap','import'].includes(state.phase);
      return 'Setup stopped · ' + (held ? held + ' cloud resource' + (held === 1 ? ' remains' : 's remain') : touched ? 'server may be partly set up' : 'nothing created');
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
    const deployment = selection(), job = deployment && deployment.current;
    $('empty').hidden = groups.length > 0; $('picker').hidden = !groups.length;
    options('deployments', groups.map(item => [item.id, ((item.current.state || {}).name || 'VPN') + ' · ' + summary(item)]), chosen || '');
    $('current').hidden = !job; if (!job) return;
    const state = job.state || {}, step = job.pendingStep || {}, st = status(job), blocked = pending(job);
    text('title', state.name || 'VPN'); text('status', summary(deployment));
    text('endpoint', state.host ? 'Server: ' + state.host : '');
    text('question', state.phase === 'deleted' && state.mode === 'manual'
      ? 'VPN removed. Delete any unused VM, disks and public IP in your cloud console to stop their charges.'
      : st === 'WAITING_INPUT' && step.title || '');
    show('problem', step.form === 'recovery' && state.error && state.error.message || '');
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
    catch (error) { const reason = error && error.message || ''; if (reason !== 'INPUT_CANCELLED') failure = ERRORS[reason] || reason || 'The workflow could not be updated.'; }
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
  $('new').onclick = () => action('new', () => create('setup'));
  // A picked option gives up the focus: Android WebView would keep it on the closed select, holding back its redraws.
  $('deployments').onchange = () => { chosen = $('deployments').value; new Set(Object.values(SLOTS)).forEach(slot => show(slot, '')); $('deployments').blur(); follow(); draw(); schedule(); };
  $('clients').onchange = () => $('clients').blur();
  $('deployments').onblur = draw; $('clients').onblur = draw;
  $('review').onclick = () => action('review', () => MobileSSH.workflows.review({id: current().id}));
  $('resume').onclick = () => action('resume', () => MobileSSH.workflows.resume({id: current().id, revision: current().revision}));
  $('cancel').onclick = () => action('cancel', () => MobileSSH.workflows.cancel({id: current().id, revision: current().revision}));
  $('health').onclick = () => action('health', () => manage('health')); $('client').onclick = () => action('client', () => manage('createClient'));
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
