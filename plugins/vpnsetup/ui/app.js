(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  // The wg-easy release this bundle installs; tools/check-image-pins.mjs keeps it equal to worker.js's pin.
  const RELEASE = '15.5.0';
  const OPERATIONS = {setup:'Setup',health:'Check server',createClient:'Add client',revokeClient:'Revoke client',update:'Update WireGuard',delete:'Delete'};
  const STATUS = {READY:'Starting',RUNNING:'In progress',WAITING_INPUT:'Waiting for you',PAUSED:'Paused',SUCCEEDED:'Done',FAILED:'Failed',CANCELLED:'Stopped'};
  // Each control reports its errors in the slot beside it, where the tap happened.
  const SLOTS = {new:'new-error',clear:'clear-error',review:'job-error',finish:'job-error',resume:'job-error',cancel:'job-error',remove:'job-error',
    connect:'manage-error',health:'manage-error',client:'manage-error',update:'manage-error',revoke:'client-error',export:'client-error',admin:'client-error',
    delete:'delete-error',forget:'forget-error'};
  const CHANGED = 'The workflow changed in the meantime. Check its current state and try again.';
  const ERRORS = {'A deployment operation is already pending':'Another operation on this VPN has not finished. Continue or resume it first.',
    'Workflow changed':CHANGED,'Workflow cannot resume':CHANGED,NO_PENDING_INPUT:'This step no longer needs an answer.',
    NO_PENDING_CREDENTIAL_INPUT:'The cloud credentials are available again. Resume the workflow instead.',
    INPUT_EXPIRED:'The review timed out. Open it again to continue.',DEPLOYMENT_NOT_READY:'This VPN has no finished setup to work on yet.',
    BRIDGE_UPGRADE_REQUIRED:'Update Mobile SSH to use this version of VPN Setup.',STALE_WORKFLOW_ANSWER:CHANGED,
    // Why workflows.remove kept an entry in the list.
    WORKFLOW_IN_PROGRESS:'An operation of this entry has not finished. Stop it or let it finish first.',
    WORKFLOW_RESOURCES_REMAIN:'This entry may still hold cloud resources, so it stays in the list. Delete them first.',
    VPN_STILL_EXISTS:'This VPN still exists. Delete it first: removing it from the list would not delete it.',
    WORKFLOW_NOT_FOUND:'This entry is no longer saved.'};
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
  // Bridge 1.5.0 removes entries from the list (workflows.remove), and lets a new operation take over from a stopped or
  // failed one that only waits on a question. Older hosts keep both, so the page offers neither there.
  const clears = () => atLeast(window.MobileSSH.version, '1.5.0');
  const ended = job => ['SUCCEEDED','FAILED','CANCELLED'].includes(status(job));
  const asks = job => !!job.pendingStep && job.pendingStep.kind === 'input';
  // Mirrors the native journal: an unfinished job, or one still holding a step, blocks new operations on its deployment.
  // From bridge 1.5.0 a stopped or failed job holding only a question does not: the next operation supersedes it. That
  // bridge also says which jobs block (job.blocking), such as a stopped one whose last result its worker never read.
  const pending = job => clears() && typeof job.blocking === 'boolean' ? job.blocking
    : !finished(job) || !!job.pendingStep && !(clears() && ['FAILED','CANCELLED'].includes(status(job)) && asks(job));
  // Only these advance on their own; paused and waiting jobs need the user first.
  const progressing = job => ['READY','RUNNING'].includes(status(job));
  // Cloud resources the job's receipts still hold.
  const held = job => Object.values((job.state || {}).resources || {}).filter(value => value && value.owned && value.status !== 'deleted').length;
  // Where a job stopped: its recovery, or a stop it answered itself, keeps the phase it interrupted.
  const stoppedAt = job => { const state = job.state || {}; return ['recovery','cancelled'].includes(state.phase) ? state.interruptedPhase : state.phase; };
  // A setup that reached its creates may hold one no receipt shows yet: a create cut off, still in flight, or one its recovery
  // moved on from (to new credentials or settings, say). VPN Setup 1.0.4 also notes every create it sent (creationSent), and
  // each one no answer or lookup settled yet (unanswered).
  const creating = job => {
    const state = job.state || {}, step = job.pendingStep || {}, creates = phase => ['provision','wait'].includes(phase);
    return creates(stoppedAt(job)) || unanswered(job) || !['ready','deleted'].includes(state.phase)
      && (state.creationSent === true || [state.interruptedPhase, state.suspendedPhase, state.accountResumePhase].some(creates))
      || step.kind === 'http' && String(step.method || 'GET').toUpperCase() !== 'GET';
  };
  // A setup that reached its server: installing on it, or importing its first client.
  const touched = job => !!((job.state || {}).clients || []).length || ['bootstrap','import'].some(phase => [(job.state || {}).phase, stoppedAt(job)].includes(phase));
  // A setup that ended without its VPN (or its own cleanup) may hold something no receipt shows.
  const unsure = job => operation(job) === 'setup' && !(status(job) === 'SUCCEEDED' && ['ready','deleted'].includes((job.state || {}).phase)) && (creating(job) || touched(job));
  // A setup on a server the user made in the cloud console, or brought: no receipt shows it, and it stays whatever happens here.
  const ownServer = job => operation(job) === 'setup' && (job.state || {}).mode === 'manual' && !!(job.state || {}).host;
  const CLEANUP = ['cleanup','cleanupWait','cleanupExtra','extraWait','deleteServer','cleanupLocal'];
  // The phases a job is at: its own, and the one its recovery, or a stop it answered, interrupted. Only setups and deletes clean
  // up, and only their own stop says where: VPN Setup 1.0.0-1.0.3 copied those fields into every later operation.
  const at = job => { const state = job.state || {};
    return [state.phase].concat(['setup','delete'].includes(operation(job)) && ['recovery','cancelled'].includes(state.phase) ? [state.interruptedPhase, state.suspendedPhase] : []); };
  // A delete, or a setup's own cleanup, that began removing the VPN and has not finished: part of it may be gone, the rest still exists.
  function removing(job) {
    if ((job.state || {}).phase === 'deleted') return false;
    return at(job).some(phase => CLEANUP.includes(phase)) || owned(job).some(([, value]) => value.status === 'deleted');
  }
  const halted = job => ['FAILED','CANCELLED'].includes(status(job)) || status(job) === 'SUCCEEDED' && (job.state || {}).phase === 'cancelled';
  // One that stopped or failed there.
  const halfDeleted = job => removing(job) && halted(job);
  // Its server, public address or resource group is deleted, or its VPN removed from the user's own server: nothing is left
  // to manage. A delete refused before it removed any of them leaves the VPN as it was.
  const gone = job => owned(job).some(([key, value]) => value.status === 'deleted' && [key, value.type].some(name => ['server','address','group'].includes(name)))
    || at(job).some(phase => ['deleteServer','cleanupLocal'].includes(phase));
  // VPN Setup 1.0.4 notes each create sent with no 2xx answer until a read of the cloud settles it.
  const unanswered = job => Object.keys((job.state || {}).unanswered || {}).length > 0;
  // The deployment's jobs since its last finished delete, newest first: what that delete answered for is not counted again.
  const since = deployment => { const at = deployment.jobs.findIndex(job => status(job) === 'SUCCEEDED' && (job.state || {}).phase === 'deleted');
    return at < 0 ? deployment.jobs : deployment.jobs.slice(0, at); };
  // A delete stopped before it removed anything, of a setup that never reached its server: there is no VPN to manage, so
  // nothing but another delete removes what that setup left or may have made.
  const stranded = (deployment, job) => operation(job) === 'delete' && halted(job) && !removing(job) && !(job.state || {}).host
    && (held(job) > 0 || unanswered(job) || since(deployment).some(unsure));
  // Receipts by what they are; their ids and provider data stay out of the page.
  const KINDS = {server:'Server',address:'Public IP',firewall:'Firewall',key:'SSH key',volume:'Disk',network:'Network',subnet:'Subnet',
    gateway:'Internet gateway',route:'Route table',nic:'Network interface',vnic:'Network interface',privateIp:'Private IP',group:'Resource group',
    attachment:'IP attachment',sshFirewall:'Firewall rule',vpnFirewall:'Firewall rule',sshRule:'Firewall rule',vpnRule:'Firewall rule',power:'Server power'};
  const kind = (key, value) => [value.type, key].map(name => Object.prototype.hasOwnProperty.call(KINDS, name) ? KINDS[name] : '').find(Boolean) || 'Cloud resource';
  const owned = job => Object.entries((job.state || {}).resources || {}).filter(([, value]) => value && value.owned);
  // The deployment's receipts as they stand: each as the job updated last left it, like the native ledger.
  const ledger = deployment => Object.values(Object.assign({}, ...deployment.jobs.slice().reverse().map(job => (job.state || {}).resources || {})))
    .filter(value => value && value.owned);
  // A VPN exists once its setup finished, until an operation deleted it.
  const exists = deployment => deployment.jobs.some(job => operation(job) === 'setup' && status(job) === 'SUCCEEDED' && (job.state || {}).phase === 'ready')
    && !deployment.jobs.some(job => status(job) === 'SUCCEEDED' && (job.state || {}).phase === 'deleted');
  // Mirrors the check native workflows.remove makes, which decides: every job ended holding at most a question (or is one
  // open() lets the clear action stop first), no receipt is left undeleted, no create is left unsettled, no setup since the last
  // finished delete may hold more, and no VPN still exists. The newest job's note carries every earlier one's. An entry native
  // refused for cloud resources the page cannot see (a create an older VPN Setup never looked up) is not offered again until
  // another operation ran on it.
  function removable(deployment, open) {
    return !ledger(deployment).some(value => value.status !== 'deleted') && !exists(deployment) && !unanswered(deployment.jobs[0]) && !unseen(deployment)
      && deployment.jobs.every(job => ended(job) ? !pending(job) : !!open && open(job)) && !since(deployment).some(unsure);
  }
  const refusedAt = new Map();
  const unseen = deployment => refusedAt.get(deployment.id) === deployment.jobs[0].id;
  // A setup VPN Setup 1.0.0-1.0.2 stopped at its read-only checks: its recovery has no message, and its first answer only
  // repeats the failing check. It created nothing; a new setup asks the settings question instead.
  const oldCheck = job => (job.pendingStep || {}).form === 'recovery' && !(job.pendingStep || {}).message && (job.state || {}).interruptedPhase === 'preflight';
  const ongoing = job => operation(job) === 'setup' && ['READY','RUNNING','WAITING_INPUT','PAUSED'].includes(status(job));
  const opened = job => ongoing(job) && oldCheck(job);
  // Setups that never created anything, those an older VPN Setup left open at its checks included: the clear action
  // stops those first, then removes them all with one native confirmation.
  // A setup on the user's own server is left out: removing it also forgets the SSH key it made for that server.
  const leftover = deployment => deployment.jobs.every(job => operation(job) === 'setup' && !ownServer(job)) && !ledger(deployment).length && removable(deployment, opened);
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
  const remain = count => count + ' cloud resource' + (count === 1 ? ' remains' : 's remain');
  // One line per deployment: what it is now, not every job that ever ran for it.
  function summary(deployment) {
    const job = deployment.current, state = job.state || {}, st = status(job);
    const established = deployment.jobs.some(item => operation(item) === 'setup' && status(item) === 'SUCCEEDED' && (item.state || {}).phase === 'ready');
    if (!established && operation(job) === 'setup' && (['CANCELLED','FAILED'].includes(st) || state.phase === 'cancelled')) {
      const count = held(job);
      return 'Setup stopped · ' + (count ? remain(count) : creating(job) ? 'cloud resources may exist' : touched(job) ? 'server may be partly set up'
        : ownServer(job) ? 'your server remains' : 'nothing created');
    }
    // What a stopped delete left: the receipts it had not marked deleted, or what a setup with no server may have made.
    if (halfDeleted(job) || stranded(deployment, job)) {
      const count = held(job);
      return 'Delete ' + (st === 'FAILED' ? 'failed' : 'stopped') + ' · ' + (count ? remain(count) : !halfDeleted(job) ? 'cloud resources may exist'
        : owned(job).length ? 'cloud resources deleted' : 'VPN may be partly removed');
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
    const deployment = selection(), job = deployment && deployment.current, resumable = !!unfinished(), fresh = clears();
    const old = groups.filter(item => opened(item.current)).length, spare = fresh ? groups.filter(leftover).length : 0;
    text('new', resumable ? 'Continue VPN setup' : 'Set up a VPN');
    // Stopping such a setup ends it but keeps it listed; only bridge 1.5.0 clears them, with the line below.
    show('new-hint', resumable ? CONTINUES : fresh ? '' : old === 1 ? 'An earlier setup stopped at its checks and created nothing. Update Mobile SSH to clear it from this list.'
      : old ? old + ' earlier setups stopped at their checks and created nothing. Update Mobile SSH to clear them from this list.' : '');
    $('leftover').hidden = !spare;
    if (spare) { text('leftover-text', spare === 1 ? 'An earlier setup created nothing.' : spare + ' earlier setups created nothing.'); text('clear', spare === 1 ? 'Clear it' : 'Clear them'); }
    $('empty').hidden = groups.length > 0; $('picker').hidden = !groups.length;
    options('deployments', groups.map(item => [item.id, ((item.current.state || {}).name || 'VPN') + ' · ' + summary(item)]), chosen || '');
    $('current').hidden = !job; if (!job) return;
    const state = job.state || {}, step = job.pendingStep || {}, st = status(job), blocked = pending(job);
    // Delete VPN: a new delete with this bundle finishes one stopped part-way, deletes what a stopped setup left or may have made
    // (also once a delete of it stopped before removing anything), or what native found but the page cannot see. Any bridge takes
    // it once nothing blocks; Resume runs the earlier one's own copy.
    const left = operation(job) === 'setup' && halted(job) && (held(job) > 0 || creating(job)) || stranded(deployment, job);
    const redo = !blocked && (halfDeleted(job) || left || unseen(deployment));
    text('title', state.name || 'VPN'); text('status', summary(deployment));
    text('endpoint', state.host ? 'Server: ' + state.host : '');
    text('question', state.phase === 'deleted' && state.mode === 'manual'
      ? 'VPN removed. Delete any unused VM, disks and public IP in your cloud console to stop their charges.'
      : st === 'WAITING_INPUT' && step.title || '');
    // A recovery's reason, or why a setting is asked again.
    show('problem', step.form === 'recovery' && state.error && state.error.message || step.error && step.error.message || '');
    // What a delete or a setup's own cleanup, under way or stopped part-way, left in the cloud, by kind.
    const cloud = removing(job) && (['setup','delete'].includes(operation(job)) || halfDeleted(job))
      ? owned(job).map(([key, value]) => [kind(key, value) + ' · ' + (value.status === 'deleted' ? 'deleted' : 'remains')]) : [];
    list('cloud', cloud); $('cloud').hidden = !cloud.length;
    const credential = st === 'PAUSED' && job.needsCredential === true;
    $('review').hidden = !(st === 'WAITING_INPUT' && step.kind === 'input') && !credential;
    text('review', credential ? 'Review cloud credentials' : step.form === 'confirm' ? 'Review and approve' : 'Continue');
    const again = ['PAUSED','FAILED','CANCELLED'].includes(st);
    $('finish').hidden = !redo;
    const earlier = operation(job) === 'delete';
    show('finish-note', !redo ? '' : (operation(job) === 'setup' ? 'Delete VPN deletes what this setup left in the cloud, with this version of VPN Setup.'
      : 'Delete VPN removes what remains with this version of VPN Setup.') + (again ? earlier ? ' Resume continues the earlier attempt as it was.' : ' Resume continues it as it was.' : ''));
    text('resume', redo && earlier ? 'Resume earlier delete' : 'Resume');
    $('resume').hidden = !again; $('cancel').hidden = finished(job);
    // Removing only clears this phone's history of an entry that holds nothing; the native check decides.
    $('remove').hidden = !fresh || !removable(deployment, opened);
    const mine = $('remove').hidden ? null : deployment.jobs.find(ownServer);
    show('remove-note', mine ? 'Your server at ' + mine.state.host + ' stays as it is. Any SSH key this setup created for it is forgotten'
      + (mine.state.provider === 'existing' ? '.' : ': delete the server in your cloud console if you no longer need it.') : '');
    list('history', deployment.jobs.slice(0, 8).map(item => [named(item) + ' · ' + statusText(item) + when(item), item === job]));
    list('resources', Object.entries(state.resources || {}).map(([key, value]) => [key + ': ' + (value.id || 'pending') + ' · ' + (value.status || 'created')]));
    // From bridge 1.5.0 an operation stopped at its approval holds nothing: its VPN stays as it was, to manage.
    const asked = !blocked && ['FAILED','CANCELLED'].includes(st) && ['updateConfirm','clientConfirm','deleteConfirm'].includes(state.phase);
    $('manage').hidden = !state.host || !(['ready','cancelled','recovery'].includes(state.phase) || asked) || gone(job);
    // The journal refuses another operation until this one finishes, so do not offer one.
    show('blocked', blocked ? named(job) + ' has not finished. Continue or resume it before starting another operation on this VPN.' : '');
    ['health','client','revoke'].forEach(id => { $(id).hidden = blocked; });
    $('delete').hidden = blocked || redo; // Delete VPN above stands for it.
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
  // Removes entries from this phone's list after one native confirmation; nothing changes in the cloud. Setups an older
  // VPN Setup left open at their checks are stopped first, since only finished ones can go.
  async function discard(found) {
    for (const job of found.flatMap(item => item.jobs.filter(opened)))
      try { await MobileSSH.workflows.cancel({id: job.id, revision: job.revision}); } catch (_) {} // Still open: removal refuses it.
    // Native may find cloud resources the page cannot see: Delete VPN is offered for such an entry instead.
    const remember = id => { const item = found.find(entry => entry.id === id); if (item) refusedAt.set(item.id, item.jobs[0].id); };
    let value;
    try { value = await MobileSSH.workflows.remove({deploymentIds: found.map(item => item.id)}); }
    catch (error) { if (found.length === 1 && String(error && error.message) === 'WORKFLOW_RESOURCES_REMAIN') remember(found[0].id); throw error; }
    const kept = value && Array.isArray(value.refused) ? value.refused : [];
    kept.filter(item => item.code === 'WORKFLOW_RESOURCES_REMAIN').forEach(item => remember(item.deploymentId));
    if (!kept.length) return;
    if (found.length === 1) throw new Error(String(kept[0].code || ''));
    throw new Error((kept.length === 1 ? 'One of them' : kept.length + ' of them') + ' stayed in the list. Open ' + (kept.length === 1 ? 'it' : 'each') + ' to see why.');
  }
  // The setups that created nothing, as the journal lists them now; native removes at most 50 per call.
  async function tidy() { await refresh(); const found = groups.filter(leftover).slice(0, 50); if (found.length) await discard(found); }
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
  $('new').onclick = () => action('new', setup); $('clear').onclick = () => action('clear', tidy);
  // A picked option gives up the focus: Android WebView would keep it on the closed select, holding back its redraws.
  $('deployments').onchange = () => { chosen = $('deployments').value; new Set(Object.values(SLOTS)).forEach(slot => show(slot, '')); $('deployments').blur(); follow(); draw(); schedule(); };
  $('clients').onchange = () => $('clients').blur();
  $('deployments').onblur = draw; $('clients').onblur = draw;
  $('review').onclick = () => action('review', () => MobileSSH.workflows.review({id: current().id}));
  $('finish').onclick = () => action('finish', () => manage('delete'));
  $('remove').onclick = () => action('remove', () => { const found = selection(); return found && discard([found]); });
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
