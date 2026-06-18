/* LangChain RAG plugin — chat over server files via a loopback FastAPI app. */
(function () {
  'use strict';
  var chat = document.getElementById('chat');
  var input = document.getElementById('in');
  var sendBtn = document.getElementById('send');
  var reindexBtn = document.getElementById('reindex');
  var sub = document.getElementById('sub');
  var tunnel = null;
  var busy = false;

  function bubble(cls, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.textContent = text;
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
    return d;
  }
  function sys(t) { return bubble('sys', t); }

  // iOS WKWebView does not shrink the layout viewport when the keyboard opens; pin to visualViewport.
  function fitToViewport() {
    var vv = window.visualViewport;
    if (!vv) return;
    document.body.style.height = vv.height + 'px';
    chat.scrollTop = chat.scrollHeight;
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitToViewport);
    window.visualViewport.addEventListener('scroll', fitToViewport);
    fitToViewport();
  }

  function setEnabled(on) {
    input.disabled = !on; sendBtn.disabled = !on; reindexBtn.disabled = !on;
  }

  async function init() {
    try {
      var theme = await MobileSSH.ui.theme();
      if (theme) {
        if (theme.background) document.body.style.background = theme.background;
        if (theme.text) document.body.style.color = theme.text;
        if (theme.accent) {
          sendBtn.style.background = theme.accent;
        }
      }
    } catch (e) {}

    try {
      var model = (await MobileSSH.storage.get('model')) || 'llama3.1';
      var embed = (await MobileSSH.storage.get('embed')) || 'nomic-embed-text';
      var docs = (await MobileSSH.storage.get('docs')) || '~/rag-docs';

      // Only run (and re-consent) the recipe when something still needs doing,
      // or when the chosen settings changed since they were last applied.
      var satisfied = false;
      try {
        var st = await MobileSSH.recipe.status();
        satisfied = !!(st && st.steps && st.steps.length && st.steps.every(function (s) { return s.satisfied; }));
      } catch (e) {}
      var sig = JSON.stringify({ model: model, embed: embed, docs: docs });
      var applied = await MobileSSH.storage.get('applied');
      if (!satisfied || sig !== applied) {
        sys('Setting up the RAG service on the server (model: ' + model + ')…');
        var res = await MobileSSH.recipe.run(null, { model: model, embed: embed, docs: docs });
        if (!res || !res.ok) { sys('Setup failed. See the install log for details.'); return; }
        await MobileSSH.storage.put('applied', sig);
      }

      // Preflight: make sure every recipe step is satisfied before exposing chat.
      try {
        var pst = await MobileSSH.recipe.status();
        if (pst && pst.steps && pst.steps.length) {
          var unsat = pst.steps.filter(function (s) { return !s.satisfied; }).map(function (s) { return s.id; });
          if (unsat.length) {
            sys('Setup incomplete. Unsatisfied steps: ' + unsat.join(', '));
            return;
          }
        }
      } catch (e) {}

      tunnel = await MobileSSH.tunnel.open({ port: 8210 });
      sub.textContent = model + ' · ' + tunnel.url;
      setEnabled(true);
      input.focus();
      sys('Ready. Ask a question about your indexed docs, or tap Reindex after adding files to ' + docs + '.');
    } catch (e) {
      sys('Error: ' + (e && e.message ? e.message : e));
    }
  }

  async function send(text) {
    if (!tunnel || busy) return;
    busy = true; setEnabled(false);
    bubble('me', text);
    var thinking = bubble('ai', 'thinking…');
    try {
      var r = await MobileSSH.http.fetch({
        url: tunnel.url + '/query',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text })
      });
      if (r.status < 200 || r.status >= 300) {
        thinking.textContent = 'Query failed (HTTP ' + r.status + '): ' + (r.body || '');
        return;
      }
      var data = null;
      try { data = JSON.parse(r.body); } catch (e) {}
      thinking.textContent = (data && data.response) ? data.response : (r.body || '(no response)');
    } catch (e) {
      thinking.textContent = 'Error: ' + (e && e.message ? e.message : e);
    } finally {
      chat.scrollTop = chat.scrollHeight;
      busy = false; setEnabled(true); input.focus();
    }
  }

  async function reindex() {
    if (!tunnel || busy) return;
    busy = true; setEnabled(false);
    sys('Reindexing docs…');
    try {
      var r = await MobileSSH.http.fetch({
        url: tunnel.url + '/reindex',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (r.status < 200 || r.status >= 300) {
        sys('Reindex failed (HTTP ' + r.status + ')');
        return;
      }
      var data = null;
      try { data = JSON.parse(r.body); } catch (e) {}
      sys((data && data.ok) ? 'Reindex complete.' : 'Reindex finished.');
      try { MobileSSH.ui.toast('Reindex complete'); } catch (e) {}
    } catch (e) {
      sys('Reindex error: ' + (e && e.message ? e.message : e));
    } finally {
      busy = false; setEnabled(true);
    }
  }

  document.getElementById('f').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  });
  reindexBtn.addEventListener('click', function (e) { e.preventDefault(); reindex(); });

  init();
})();
