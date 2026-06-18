/* LlamaIndex Agents plugin — drives an agent workflow server (llama-agents) over an SSH-forwarded
   loopback port. The server (app.py) exposes a small, stable API on top of the WorkflowServer:
     POST /ask        {prompt}          -> { id }
     GET  /ask/{id}                     -> { status: running|done|error|unknown, result }
   plus the native llama-agents routes (GET /workflows, GET /health) used for status. */
(function () {
  'use strict';

  var sub = document.getElementById('sub');
  var wfSel = document.getElementById('wf');
  var promptIn = document.getElementById('prompt');
  var runBtn = document.getElementById('run');
  var results = document.getElementById('results');
  var logEl = document.getElementById('log');

  var tunnel = null;
  var base = '';

  function log(msg) {
    logEl.textContent += (logEl.textContent ? '\n' : '') + msg;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function showResult(text) {
    var d = document.createElement('div');
    d.className = 'result';
    d.textContent = text;
    results.insertBefore(d, results.firstChild);
    return d;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function getJson(url) {
    var res = await MobileSSH.http.fetch({ url: url, method: 'GET' });
    if (!res || res.status < 200 || res.status >= 300) return null;
    var body = res && (res.body !== undefined ? res.body : res.text);
    try { return JSON.parse(body); } catch (e) { return null; }
  }

  async function loadWorkflows() {
    try {
      var data = await getJson(base + '/workflows');
      var names = [];
      if (data && Array.isArray(data.workflows)) names = data.workflows;
      else if (Array.isArray(data)) names = data;
      if (!names.length) names = ['ask'];
      wfSel.innerHTML = '';
      names.forEach(function (n) {
        var o = document.createElement('option');
        o.value = n; o.textContent = n;
        wfSel.appendChild(o);
      });
      wfSel.disabled = false;
    } catch (e) {
      log('Could not list workflows: ' + (e && e.message ? e.message : e));
    }
  }

  async function runWorkflow() {
    var prompt = (promptIn.value || '').trim();
    if (!prompt || !base) return;
    runBtn.disabled = true; promptIn.disabled = true;
    var out = showResult('▶ ' + prompt + '\n\nthinking…');
    try {
      // Kick off the workflow (returns immediately with a job id).
      var startRes = await MobileSSH.http.fetch({
        url: base + '/ask',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt })
      });
      var startBody = startRes && (startRes.body !== undefined ? startRes.body : startRes.text);
      if (!startRes || startRes.status < 200 || startRes.status >= 300) throw new Error('HTTP ' + (startRes && startRes.status) + ': ' + startBody);
      var started = null;
      try { started = JSON.parse(startBody); } catch (e) { started = null; }
      var jobId = started && started.id;
      if (!jobId) throw new Error('no job id in response: ' + startBody);
      log('Started job ' + jobId);

      // Poll for completion (up to ~5 min).
      var result = null, errored = null;
      for (var i = 0; i < 150; i++) {
        await sleep(2000);
        var h = await getJson(base + '/ask/' + encodeURIComponent(jobId));
        if (!h) continue;
        if (h.status === 'done') { result = h.result; break; }
        if (h.status === 'error') { errored = h.result || 'workflow failed'; break; }
      }
      if (errored) throw new Error(errored);
      if (result === null) throw new Error('timed out waiting for the agent');

      var text = (typeof result === 'string') ? result : JSON.stringify(result, null, 2);
      out.textContent = '▶ ' + prompt + '\n\n' + text;
      try {
        var short = text.length > 120 ? text.slice(0, 117) + '…' : text;
        await MobileSSH.notify({ title: 'Agent finished', message: short });
      } catch (e) {}
    } catch (e) {
      out.textContent = '▶ ' + prompt + '\n\nError: ' + (e && e.message ? e.message : e);
      log('Error: ' + (e && e.message ? e.message : e));
    } finally {
      runBtn.disabled = false; promptIn.disabled = false;
      promptIn.value = '';
      promptIn.focus();
    }
  }

  async function init() {
    try {
      var theme = await MobileSSH.ui.theme();
      if (theme) {
        if (theme.background) document.body.style.background = theme.background;
        if (theme.text) document.body.style.color = theme.text;
        if (theme.accent) {
          var btns = document.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) btns[i].style.background = theme.accent;
        }
      }
    } catch (e) {}

    try {
      sub.textContent = 'setting up…';
      // Only run (and re-prompt for) the recipe when something still needs doing.
      var satisfied = false;
      try {
        var st = await MobileSSH.recipe.status();
        satisfied = !!(st && st.steps && st.steps.length && st.steps.every(function (s) { return s.satisfied; }));
      } catch (e) {}
      if (!satisfied) {
        log('Setting up the agent server (this can take a while on first run)…');
        var res = await MobileSSH.recipe.run(null, {});
        if (!res || res.ok === false) { sub.textContent = 'setup failed'; log('Setup failed.'); return; }
      }

      tunnel = await MobileSSH.tunnel.open({ port: 8080 });
      if (!tunnel || !tunnel.url) { sub.textContent = 'tunnel failed'; log('Could not open SSH tunnel to 127.0.0.1:8080.'); return; }
      base = tunnel.url;
      sub.textContent = tunnel.url;

      await loadWorkflows();

      promptIn.disabled = false; runBtn.disabled = false;
      promptIn.focus();
      log('Ready. Ask the agent something; long runs notify you when done.');
    } catch (e) {
      sub.textContent = 'error';
      log('Error: ' + (e && e.message ? e.message : e));
    }
  }

  runBtn.addEventListener('click', runWorkflow);
  promptIn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !runBtn.disabled) { e.preventDefault(); runWorkflow(); }
  });

  init();
})();
