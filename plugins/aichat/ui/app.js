/* AI Chat plugin — streams from a remote Ollama over an SSH-forwarded port. */
(function () {
  'use strict';
  var chat = document.getElementById('chat');
  var input = document.getElementById('in');
  var sendBtn = document.getElementById('send');
  var sub = document.getElementById('sub');
  var tunnel = null;
  var model = 'llama3.2:1b';
  var history = []; // {role, content}

  function bubble(cls, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.textContent = text;
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
    return d;
  }
  function sys(t) { bubble('sys', t); }

  // iOS WKWebView does not shrink the layout viewport when the keyboard opens (Android does),
  // so the bottom-anchored composer ends up hidden behind it. Track visualViewport and pin the
  // body to its visible height. No-op where visualViewport is unavailable (older Android WebView).
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

  async function init() {
    try {
      var theme = await MobileSSH.ui.theme();
      document.body.style.background = theme.background; document.body.style.color = theme.text;
    } catch (e) {}
    try {
      model = (await MobileSSH.storage.get('model')) || 'llama3.2:1b';
      // Only run (and re-prompt for) the recipe when something still needs doing — otherwise a
      // restart/relaunch with Ollama already up would re-consent the install/serve every time.
      var satisfied = false;
      try {
        var st = await MobileSSH.recipe.status();
        satisfied = !!(st && st.steps && st.steps.length && st.steps.every(function (s) { return s.satisfied; }));
      } catch (e) {}
      if (!satisfied) {
        sys(t('setup_msg', model));
        var res = await MobileSSH.recipe.run(null, { model: model });
        if (!res.ok) { sys(t('setup_failed')); return; }
      }
      tunnel = await MobileSSH.tunnel.open({ port: 11434 });
      sub.textContent = model + ' · ' + tunnel.url;
      input.disabled = false; sendBtn.disabled = false; input.focus();
      sys(t('ready_chat'));
    } catch (e) { sys(t('error', e.message)); }
  }

  async function ask(text) {
    history.push({ role: 'user', content: text });
    bubble('me', text);
    var out = bubble('ai', '');
    var acc = '';
    var buf = '';
    var errMsg = '';

    function onChunk(s) {
      buf += s;
      var nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        var line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        line = line.trim();
        if (!line) continue;
        try {
          var obj = JSON.parse(line);
          if (obj.error) { errMsg = obj.error; }
          if (obj.message && obj.message.content) {
            acc += obj.message.content;
            out.textContent = acc;
            chat.scrollTop = chat.scrollHeight;
          }
        } catch (e) { /* partial/non-JSON line; ignore */ }
      }
    }

    function fail(msg) {
      out.textContent = (acc ? acc + '\n' : '') + '[' + t('error', msg) + ']';
      history.pop(); // drop the unanswered user turn so it doesn't corrupt the next request
    }

    try {
      var res = await MobileSSH.http.fetch({
        url: tunnel.url + '/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model, messages: history, stream: true }),
        stream: true,
      }, onChunk);
      if (errMsg) { fail(errMsg); return; }
      if (res && typeof res.status === 'number' && res.status >= 400) { fail('HTTP ' + res.status); return; }
      if (!acc) { fail(t('no_reply')); return; }
      history.push({ role: 'assistant', content: acc });
    } catch (e) {
      fail(e.message);
    }
  }

  document.getElementById('f').onsubmit = function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || !tunnel) return;
    input.value = '';
    ask(text);
  };

  init();
})();
