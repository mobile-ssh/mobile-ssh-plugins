/* Touch Git client. All repository content enters the DOM as text or escaped diff2html output. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var client, status, session, storageKey, busy = false, ready = false;
  var patch = '', history = [], changes = [], changeIndex = -1;
  var dark = true, writesBlocked = false;
  var toolReport = null;
  var TOOL_IDS = ['git', 'lazygit', 'delta'];
  var MAX_RENDER_CHARS = 400000, MAX_RENDER_LINES = 6000;
  var splitRows = [], splitPanes = [], splitWidths = [];
  var splitFrame = null, splitObserver = null;

  function text(tag, value, className) {
    var el = document.createElement(tag);
    el.textContent = value;
    if (className) el.className = className;
    return el;
  }

  function updateControls() {
    document.querySelectorAll('button,input,textarea,select').forEach(function (el) {
      el.disabled = busy || !ready;
    });
    if (writesBlocked) document.querySelectorAll('.file-action,#fetch,#pull,#push').forEach(function (el) { el.disabled = true; });
    $('commit').disabled = busy || !ready || writesBlocked || !status || !status.files.some(function (f) { return f.staged && !f.conflicted; }) || !$('commit-message').value.trim() || status.files.some(function (f) { return f.conflicted; });
    $('previous').disabled = busy || !ready || changeIndex <= 0;
    $('next').disabled = busy || !ready || changeIndex < 0 || changeIndex >= changes.length - 1;
    $('change-position').hidden = !changes.length;
    $('change-position').textContent = changes.length ? t('change_position').replace('{current}', changeIndex + 1).replace('{total}', changes.length) : '';
    document.body.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function showError(error) {
    var key = { NOT_REPOSITORY: 'not_repository', OUTPUT_LIMIT: 'too_large', OUTPUT_LIMIT_EXCEEDED: 'too_large', NO_UPSTREAM: 'no_upstream', CONFLICT: 'conflict', STALE_FILE: 'stale' }[error.code] || 'failed';
    if (String(error.message).indexOf('OUTPUT_LIMIT_EXCEEDED') >= 0) key = 'too_large';
    if (error.actionCompleted) { key = 'completed_refresh_failed'; writesBlocked = true; }
    $('error-message').textContent = t(key);
    $('error-detail').textContent = error.stderr || error.message || String(error);
    $('error-details').open = false;
    $('error').classList.toggle('information', key === 'not_repository');
    $('error').setAttribute('role', key === 'not_repository' ? 'status' : 'alert');
    $('error').hidden = false;
    if (error.status) renderStatus(error.status);
  }

  async function run(label, task) {
    if (busy || !ready) return;
    busy = true;
    $('error').hidden = true;
    $('activity').textContent = label + '…';
    updateControls();
    try { var completed = await task(); $('activity').textContent = completed === false ? '' : t('done'); }
    catch (e) { showError(e); $('activity').textContent = ''; }
    finally { busy = false; updateControls(); }
  }

  function resetDiff() {
    clearSplitRows();
    patch = '';
    changes = [];
    changeIndex = -1;
    $('change-position').hidden = true;
    $('diff').replaceChildren();
    $('diff-panel').hidden = true;
  }

  function renderStatus(value) {
    writesBlocked = false;
    status = value;
    $('workspace').hidden = false;
    $('repository').value = value.root;
    $('branch').textContent = (value.detached ? t('detached') + ' ' + value.oid.slice(0, 8) : value.branch || t('unborn')) + (value.upstream ? ' → ' + value.upstream + '  ↑' + value.ahead + ' ↓' + value.behind : '');
    $('files').replaceChildren();
    [['staged', function (f) { return f.staged; }], ['unstaged', function (f) { return f.unstaged && !f.untracked; }], ['untracked', function (f) { return f.untracked; }]].forEach(function (group) {
      var section = document.createElement('section');
      var files = value.files.filter(group[1]);
      section.appendChild(text('h2', t(group[0]) + ' (' + files.length + ')'));
      if (!files.length) section.appendChild(text('p', t('empty'), 'muted'));
      files.forEach(function (file) { section.appendChild(fileRow(file, group[0])); });
      $('files').appendChild(section);
    });
    resetDiff();
    updateControls();
  }

  function fileRow(file, mode, oid) {
    var row = text('div', '', 'file-row');
    var open = text('button', '', 'file-open');
    var code = file.conflicted ? t('conflict_short') : file.untracked ? '?' : oid ? file.kind : mode === 'staged' ? file.index : file.worktree;
    open.appendChild(text('span', code || '', 'file-status'));
    open.appendChild(text('span', file.oldPath ? file.oldPath + ' → ' + file.path : file.path, 'file-path'));
    open.onclick = function () { run(t('loading'), async function () {
      resetDiff();
      $('diff-title').textContent = file.path + (oid ? ' · ' + oid.slice(0, 8) : ' · ' + t(mode));
      $('diff-panel').hidden = false;
      if (file.conflicted) { showDiffNote(t('conflict')); return; }
      try { patch = oid ? await client.commitDiff(oid, file) : await client.diff(file, mode === 'staged' ? 'staged' : 'unstaged'); }
      catch (e) { showDiffNote(t(e.code === 'OUTPUT_LIMIT' ? 'too_large' : 'failed')); throw e; }
      renderDiff();
      if (changes.length) scrollToChange('auto');
      else $('diff-panel').scrollIntoView({ block: 'start' });
    }); };
    row.appendChild(open);
    if (!oid && !file.conflicted) {
      var action = text('button', t(mode === 'staged' ? 'unstage' : 'stage'), 'secondary file-action');
      action.onclick = function () { run(action.textContent, async function () {
        renderStatus(await client[mode === 'staged' ? 'unstage' : 'stage'](file));
      }); };
      row.appendChild(action);
    }
    return row;
  }

  function showDiffNote(message, raw) {
    clearSplitRows();
    $('diff-note').textContent = message;
    $('diff-note').hidden = false;
    $('diff-raw').textContent = raw || '';
    $('diff-raw').hidden = !raw;
    $('diff').replaceChildren();
    changes = [];
    changeIndex = -1;
    updateControls();
  }

  function renderDiff() {
    $('diff-note').hidden = true;
    $('diff-raw').hidden = true;
    $('diff').classList.toggle('wrap-lines', $('wrap').checked);
    if (!patch) { showDiffNote(t('no_diff')); return; }
    var lines = patch.split('\n');
    if (patch.length > MAX_RENDER_CHARS || lines.length > MAX_RENDER_LINES || lines.some(function (line) { return line.length > 2000; })) { showDiffNote(t('too_large')); return; }
    if (/^Binary files |^GIT binary patch/m.test(patch)) { showDiffNote(t('binary')); return; }
    if (!/^@@ /m.test(patch)) { showDiffNote(t('metadata'), patch); return; }
    var viewer = new Diff2HtmlUI($('diff'), patch, {
      drawFileList: false, outputFormat: $('layout').value, matching: 'none',
      colorScheme: dark ? 'dark' : 'light', fileContentToggle: false,
      fileListToggle: false, fileListStartVisible: false, stickyFileHeaders: false,
      synchronisedScroll: true, highlight: true, renderNothingWhenEmpty: true,
      diffMaxChanges: MAX_RENDER_LINES, diffMaxLineLength: 2000
    });
    viewer.draw();
    viewer.highlightCode();
    prepareSplitRows();
    var previousIndex = changeIndex;
    changes = collectChanges();
    changeIndex = changes.length ? Math.max(0, Math.min(previousIndex, changes.length - 1)) : -1;
    highlightChange();
    updateControls();
    if (previousIndex >= 0) scrollToChange('auto');
  }

  function clearSplitRows() {
    if (splitFrame !== null) { window.cancelAnimationFrame(splitFrame); splitFrame = null; }
    if (splitObserver) { splitObserver.disconnect(); splitObserver = null; }
    splitRows = [];
    splitPanes = [];
    splitWidths = [];
  }

  function prepareSplitRows() {
    clearSplitRows();
    $('diff').querySelectorAll('.d2h-file-wrapper').forEach(function (file) {
      var sides = Array.from(file.querySelectorAll('.d2h-file-side-diff'));
      if (sides.length !== 2) return;
      var bodies = sides.map(function (side) { return side.querySelector('.d2h-diff-tbody'); });
      if (!bodies[0] || !bodies[1]) return;
      var left = Array.from(bodies[0].children), right = Array.from(bodies[1].children);
      for (var row = 0; row < Math.max(left.length, right.length); row++) {
        splitRows.push([left[row], right[row]].filter(Boolean));
      }
      Array.prototype.push.apply(splitPanes, sides);
    });
    if (!splitRows.length) return;
    syncSplitRows();
    splitWidths = splitPanes.map(function (pane) { return pane.clientWidth; });
    if (typeof window.ResizeObserver === 'function') {
      splitObserver = new window.ResizeObserver(function () {
        var widths = splitPanes.map(function (pane) { return pane.clientWidth; });
        var changed = widths.some(function (width, index) { return width !== splitWidths[index]; });
        splitWidths = widths;
        // Ignore height notifications from our own row updates.
        if (changed) scheduleSplitRows();
      });
      splitPanes.forEach(function (pane) { splitObserver.observe(pane); });
    }
  }

  function syncSplitRows() {
    if (splitFrame !== null) { window.cancelAnimationFrame(splitFrame); splitFrame = null; }
    if (!splitRows.length || !splitPanes.some(function (pane) { return pane.clientWidth > 0; })) return;
    var pageX = window.scrollX, pageY = window.scrollY;
    var offsets = splitPanes.map(function (pane) { return [pane.scrollLeft, pane.scrollTop]; });
    // Clear every previous constraint before reading any natural row heights. This
    // lets rows shrink after widening the view, reducing text size, or disabling wrap.
    splitRows.forEach(function (pair) { pair.forEach(function (row) { row.style.height = ''; }); });
    var heights = splitRows.map(function (pair) {
      return Math.max.apply(null, pair.map(function (row) { return row.getBoundingClientRect().height; }));
    });
    splitRows.forEach(function (pair, index) {
      pair.forEach(function (row) { row.style.height = heights[index] + 'px'; });
    });
    // Height changes can trigger browser scroll anchoring. Keep the reader's
    // current position; explicit Previous/Next navigation runs after this pass.
    splitPanes.forEach(function (pane, index) {
      if (pane.scrollLeft !== offsets[index][0]) pane.scrollLeft = offsets[index][0];
      if (pane.scrollTop !== offsets[index][1]) pane.scrollTop = offsets[index][1];
    });
    if (window.scrollX !== pageX || window.scrollY !== pageY) window.scrollTo({ left: pageX, top: pageY, behavior: 'auto' });
  }

  function scheduleSplitRows() {
    if (!splitRows.length || splitFrame !== null) return;
    splitFrame = window.requestAnimationFrame(function () { splitFrame = null; syncSplitRows(); });
  }

  function collectChanges() {
    var blocks = [];
    $('diff').querySelectorAll('.d2h-file-wrapper').forEach(function (file) {
      // Split tables have aligned rows, including placeholders for one-sided edits.
      // Inspect both sides: an insertion can have no changed cell in the left table.
      var tables = Array.from(file.querySelectorAll('.d2h-diff-tbody')).map(function (body) { return Array.from(body.children); });
      var count = tables.reduce(function (max, rows) { return Math.max(max, rows.length); }, 0);
      var block = null;
      for (var row = 0; row < count; row++) {
        var cells = [];
        tables.forEach(function (rows) {
          var cell = rows[row] && rows[row].children[1];
          if (cell && (cell.classList.contains('d2h-ins') || cell.classList.contains('d2h-del'))) cells.push(cell);
        });
        if (!cells.length) { block = null; continue; }
        if (!block) { block = { target: cells[0], cells: [] }; blocks.push(block); }
        Array.prototype.push.apply(block.cells, cells);
      }
    });
    return blocks;
  }

  function highlightChange() {
    changes.forEach(function (block, index) {
      block.cells.forEach(function (cell) { cell.classList.toggle('current-change', index === changeIndex); });
    });
  }

  function scrollToChange(behavior) {
    if (changeIndex < 0) return;
    var toolbarHeight = $('diff-toolbar').getBoundingClientRect().height;
    var top = window.scrollY + changes[changeIndex].target.getBoundingClientRect().top - toolbarHeight - 12;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) behavior = 'auto';
    // Scroll the page only; scrollIntoView can also reset the diff's horizontal position.
    window.scrollTo({ top: Math.max(0, top), behavior: behavior });
  }

  function moveChange(direction) {
    var next = changeIndex + direction;
    if (busy || !ready || next < 0 || next >= changes.length) return;
    changeIndex = next;
    highlightChange();
    updateControls();
    scrollToChange('smooth');
  }

  function setTab(name) {
    $('changes-panel').hidden = name !== 'changes';
    $('history-panel').hidden = name !== 'history';
    ['changes', 'history'].forEach(function (tab) {
      $(tab + '-tab').classList.toggle('secondary', tab !== name);
      $(tab + '-tab').setAttribute('aria-pressed', tab === name ? 'true' : 'false');
    });
    resetDiff();
  }

  async function loadHistory(reset) {
    if (reset) { history = []; $('history').replaceChildren(); $('commit-files').hidden = true; }
    var page = await client.history({ skip: history.length, limit: 30 });
    history = history.concat(page);
    page.forEach(function (entry) {
      var row = text('button', entry.subject, 'history-row');
      row.appendChild(text('span', entry.oid.slice(0, 8) + ' · ' + entry.author + ' · ' + entry.date, 'history-meta'));
      row.onclick = function () { run(t('loading'), async function () {
        resetDiff();
        var files = await client.commitFiles(entry.oid);
        $('commit-files').hidden = false;
        $('commit-title').textContent = entry.subject + ' · ' + entry.oid.slice(0, 8);
        $('commit-file-list').replaceChildren();
        files.forEach(function (file) { $('commit-file-list').appendChild(fileRow(file, 'history', entry.oid)); });
        if (!files.length) $('commit-file-list').appendChild(text('p', t('empty'), 'muted'));
        $('commit-files').scrollIntoView({ block: 'start' });
      }); };
      $('history').appendChild(row);
    });
    if (!history.length) $('history').appendChild(text('p', t('empty'), 'muted'));
    $('more').hidden = page.length < 30;
  }

  async function openRepository() {
    status = null;
    $('workspace').hidden = true;
    resetDiff();
    client = new MobileGit.Client(MobileSSH);
    renderStatus(await client.open($('repository').value || '~'));
    setTab('changes');
    history = [];
    $('commit-message').value = '';
    try { await MobileSSH.storage.put(storageKey, status.root); } catch (_) { /* Repo access remains usable if local storage fails. */ }
  }

  function toolSummary(key, state) {
    $('tools-summary').textContent = t(key);
    $('tools-summary').dataset.state = state || '';
    $('tools-summary').hidden = false;
  }

  function toolDetails(value) {
    $('tools').textContent = value || '';
    $('tools-details').hidden = !value;
    $('tools-details').open = false;
  }

  function renderTools(items) {
    var gitInstalled = items.some(function (item) { return item.id === 'git' && item.state === 'installed'; });
    var canInstall = false;
    items.forEach(function (item) {
      var badge = $('tool-' + item.id + '-status');
      badge.textContent = (item.state === 'installed' ? '✓ ' : '') + t('tool_' + item.state);
      badge.dataset.state = item.state;
      var version = $('tool-' + item.id + '-version');
      version.textContent = item.version || '';
      version.hidden = !item.version;
      if (item.id === 'git') {
        $('tool-git-help').hidden = item.state !== 'missing' && item.state !== 'failed';
      } else {
        var install = $('install-' + item.id);
        install.hidden = !gitInstalled || (item.state !== 'missing' && item.state !== 'failed');
        install.setAttribute('aria-label', t('tools_install_tool').replace('{tool}', item.id));
        canInstall = canInstall || !install.hidden;
      }
    });
    $('tools-install-note').hidden = !canInstall;
  }

  async function checkTools(installLog) {
    toolReport = null;
    renderTools(TOOL_IDS.map(function (id) { return { id: id, state: 'checking' }; }));
    toolSummary('tool_checking');
    toolDetails('');
    $('check-tools').textContent = t('tool_checking');
    try {
      toolReport = await MobileGitTools.check(MobileSSH);
      renderTools(toolReport.tools);
      var git = toolReport.tools.find(function (item) { return item.id === 'git'; });
      if (toolReport.tools.every(function (item) { return item.state === 'installed'; })) toolSummary('tools_ready', 'ready');
      else if (git.state === 'missing') toolSummary('tools_git_missing');
      else if (toolReport.tools.some(function (item) { return item.state === 'failed'; })) toolSummary('tools_attention');
      else toolSummary('tools_optional_missing');
      toolDetails((installLog ? installLog + '\n\n' : '') + toolReport.details);
      return true;
    } catch (error) {
      renderTools(TOOL_IDS.map(function (id) { return { id: id, state: 'check_unavailable' }; }));
      toolSummary('tools_check_failed');
      toolDetails((installLog ? installLog + '\n\n' : '') + (error.details || error.message || String(error)));
      return false;
    } finally {
      $('check-tools').textContent = t('tools_check_again');
    }
  }

  $('repository-form').onsubmit = function (event) { event.preventDefault(); run(t('loading'), openRepository); };
  $('refresh').onclick = function () { run(t('refresh'), async function () { renderStatus(await client.status()); if (!$('history-panel').hidden) await loadHistory(true); }); };
  ['fetch', 'pull', 'push'].forEach(function (name) { $(name).onclick = function () { run(t(name), async function () { renderStatus(await client[name]()); if (!$('history-panel').hidden) await loadHistory(true); }); }; });
  $('commit').onclick = function () { run(t('commit'), async function () { renderStatus(await client.commit($('commit-message').value)); $('commit-message').value = ''; history = []; }); };
  $('commit-message').oninput = updateControls;
  $('changes-tab').onclick = function () { setTab('changes'); updateControls(); };
  $('history-tab').onclick = function () { run(t('loading'), async function () { setTab('history'); await loadHistory(true); }); };
  $('more').onclick = function () { run(t('loading'), function () { return loadHistory(false); }); };
  $('layout').onchange = renderDiff;
  $('wrap').onchange = function () { $('diff').classList.toggle('wrap-lines', $('wrap').checked); syncSplitRows(); };
  $('font').onchange = function () { document.documentElement.style.setProperty('--diff-font', $('font').value + 'px'); syncSplitRows(); };
  window.addEventListener('resize', scheduleSplitRows);
  if (document.fonts) {
    document.fonts.ready.then(scheduleSplitRows);
    document.fonts.addEventListener('loadingdone', scheduleSplitRows);
  }
  $('previous').onclick = function () { moveChange(-1); };
  $('next').onclick = function () { moveChange(1); };
  $('check-tools').onclick = function () { run(t('check_tools'), function () { return checkTools(); }); };
  ['lazygit', 'delta'].forEach(function (tool) { $('install-' + tool).onclick = function () { run(t('setup'), async function () {
    if (!toolReport || !toolReport.tools.some(function (item) { return item.id === tool && item.state !== 'installed'; })
        || !toolReport.tools.some(function (item) { return item.id === 'git' && item.state === 'installed'; })) return false;
    toolSummary('tools_installing');
    try {
      var result = await MobileSSH.recipe.run('install-' + tool);
      if (!result.ok) {
        toolSummary('tools_install_failed');
        toolDetails(result.log || '');
        return false;
      }
      return await checkTools(result.log || '');
    } catch (error) {
      toolSummary('tools_install_failed');
      toolDetails(error.message || String(error));
      return false;
    }
  }); }; });

  async function init() {
    updateControls();
    try {
      if (typeof MobileSSH === 'undefined' || !/^1\.(?:[2-9]|[1-9]\d+)\./.test(MobileSSH.version)) throw new Error(t('upgrade'));
      var theme = await MobileSSH.ui.theme();
      ['background', 'surface', 'text', 'accent'].forEach(function (key) { if (theme[key]) document.documentElement.style.setProperty('--' + (key === 'background' ? 'bg' : key), theme[key]); });
      dark = theme.isDark !== false;
      if (!dark) {
        document.documentElement.style.setProperty('--tool-success', '#176b37');
        document.documentElement.style.setProperty('--tool-warning', '#845400');
      }
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      $('highlight-theme').href = dark ? 'vendor/github-dark.css' : 'vendor/github.css';
      session = await MobileSSH.session();
      if (!session || !session.connected) throw new Error(t('connect'));
      $('server').textContent = session.label;
      storageKey = 'repository:' + JSON.stringify([session.user, session.host, session.port]);
      var saved = null;
      try { saved = await MobileSSH.storage.get(storageKey); } catch (_) { /* optional initial folder */ }
      $('repository').value = session.cwd || saved || '~';
      client = new MobileGit.Client(MobileSSH);
      ready = true;
      updateControls();
      await run(t('loading'), openRepository);
    } catch (e) { showError(e); }
  }
  init();
})();
