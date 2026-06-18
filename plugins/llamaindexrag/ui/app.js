/* LlamaIndex RAG plugin — chat over your own files via a remote FastAPI service. */
(function () {
  'use strict';
  var chat = document.getElementById('chat');
  var input = document.getElementById('in');
  var sendBtn = document.getElementById('send');
  var reindexBtn = document.getElementById('reindex');
  var sub = document.getElementById('sub');
  var tunnel = null;

  function bubble(cls, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.textContent = text;
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
    return d;
  }
  function sys(t) { return bubble('sys', t); }

  // iOS WKWebView does not shrink the layout viewport when the keyboard opens, so the
  // bottom-anchored composer hides behind it. Pin body to visualViewport height when available.
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

  function enable(on) {
    input.disabled = !on;
    sendBtn.disabled = !on;
    reindexBtn.disabled = !on;
  }

  async function init() {
    try {
      var theme = await MobileSSH.ui.theme();
      if (theme) {
        if (theme.background) document.body.style.background = theme.background;
        if (theme.text) document.body.style.color = theme.text;
        if (theme.accent) {
          sendBtn.style.background = theme.accent;
          document.querySelectorAll('.me').forEach(function (m) { m.style.background = theme.accent; });
        }
      }
    } catch (e) {}

    try {
      var model = (await MobileSSH.storage.get('model')) || 'llama3.1';
      var embed = (await MobileSSH.storage.get('embed')) || 'nomic-embed-text';
      var docs = (await MobileSSH.storage.get('docs')) || '~/rag-docs';

      // Only run (and re-consent) the recipe when something still needs doing
      // or when the chosen settings changed since they were last applied.
      var sig = JSON.stringify({ model: model, embed: embed, docs: docs });
      var applied = await MobileSSH.storage.get('applied');
      var satisfied = false;
      try {
        var st = await MobileSSH.recipe.status();
        satisfied = !!(st && st.steps && st.steps.length &&
                       st.steps.every(function (s) { return s.satisfied; }));
      } catch (e) {}
      if (!satisfied || sig !== applied) {
        sys('Setting up the RAG service (' + model + ', indexing ' + docs + ')…');
        var res = await MobileSSH.recipe.run(null, { model: model, embed: embed, docs: docs });
        if (!res || !res.ok) { sys('Setup failed. Check the install log and try again.'); return; }
        await MobileSSH.storage.put('applied', sig);
      }

      var st2 = await MobileSSH.recipe.status();
      var bad = ((st2 && st2.steps) || []).filter(function (s) { return !s.satisfied; });
      if (bad.length) {
        sys('Setup incomplete: ' + bad.map(function (s) { return s.id; }).join(', ') + '. Install/run the AI Chat plugin (Ollama) and ensure models are pulled, then reopen.');
        return;
      }

      tunnel = await MobileSSH.tunnel.open({ port: 8200 });
      sub.textContent = model + ' · ' + tunnel.url;
      enable(true);
      input.focus();
      sys('Ready. Ask a question about the files in ' + docs + '.');
    } catch (e) {
      sys('Error: ' + (e && e.message ? e.message : e));
    }
  }

  async function send(text) {
    bubble('me', text);
    enable(false);
    var placeholder = bubble('ai', 'thinking…');
    try {
      var r = await MobileSSH.http.fetch({
        url: tunnel.url + '/query',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text })
      });
      if (!r || r.status < 200 || r.status >= 300) {
        placeholder.className = 'msg sys';
        placeholder.textContent = 'Query failed (HTTP ' + (r && r.status) + '): ' + ((r && r.body) || '');
        return;
      }
      var data = {};
      try { data = JSON.parse(r.body); } catch (e) {}
      placeholder.textContent = (data && data.response != null) ? String(data.response)
                                                                 : '(no response)';
    } catch (e) {
      placeholder.className = 'msg sys';
      placeholder.textContent = 'Query failed: ' + (e && e.message ? e.message : e);
    } finally {
      enable(true);
      chat.scrollTop = chat.scrollHeight;
      input.focus();
    }
  }

  document.getElementById('f').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var text = input.value.trim();
    if (!text || !tunnel) return;
    input.value = '';
    send(text);
  });

  reindexBtn.addEventListener('click', async function () {
    if (!tunnel) return;
    enable(false);
    sys('Reindexing files…');
    try {
      var r = await MobileSSH.http.fetch({
        url: tunnel.url + '/reindex',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!r || r.status < 200 || r.status >= 300) {
        sys('Reindex failed (HTTP ' + (r && r.status) + '): ' + ((r && r.body) || ''));
        return;
      }
      sys('Reindex complete.');
      try { MobileSSH.ui.toast('Reindex complete'); } catch (e) {}
    } catch (e) {
      sys('Reindex failed: ' + (e && e.message ? e.message : e));
    } finally {
      enable(true);
    }
  });

  init();
})();
