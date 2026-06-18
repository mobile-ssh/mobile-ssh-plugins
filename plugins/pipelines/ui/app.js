/* OpenAI Pipelines plugin — chats with an OpenAI-compatible API over an SSH-forwarded port. */
(function () {
  'use strict';
  var chat = document.getElementById('chat');
  var input = document.getElementById('in');
  var sendBtn = document.getElementById('send');
  var sub = document.getElementById('sub');
  var modelsSel = document.getElementById('models');
  var tunnel = null;
  var apiKey = '0p3n-w3bu!';
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

  // iOS WKWebView does not shrink the layout viewport when the keyboard opens; pin body to the
  // visualViewport height so the composer stays visible. No-op where unavailable.
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

  function authHeaders(extra) {
    var h = { 'Authorization': 'Bearer ' + apiKey };
    if (extra) { for (var k in extra) if (extra.hasOwnProperty(k)) h[k] = extra[k]; }
    return h;
  }

  async function loadModels() {
    try {
      var res = await MobileSSH.http.fetch({
        url: tunnel.url + '/v1/models',
        method: 'GET',
        headers: authHeaders(),
      });
      var data = null;
      try { data = JSON.parse(res && res.body ? res.body : '{}'); } catch (e) {}
      var list = (data && data.data) ? data.data : [];
      modelsSel.innerHTML = '';
      for (var i = 0; i < list.length; i++) {
        var id = list[i].id || list[i].name;
        if (!id) continue;
        var opt = document.createElement('option');
        opt.value = id; opt.textContent = id;
        modelsSel.appendChild(opt);
      }
      if (modelsSel.options.length) {
        modelsSel.disabled = false;
      } else {
        var opt2 = document.createElement('option');
        opt2.value = ''; opt2.textContent = '(no models)';
        modelsSel.appendChild(opt2);
      }
    } catch (e) {
      sys('Could not load models: ' + e.message);
    }
  }

  async function init() {
    try {
      var theme = await MobileSSH.ui.theme();
      if (theme) {
        if (theme.background) document.body.style.background = theme.background;
        if (theme.text) document.body.style.color = theme.text;
        if (theme.accent) {
          var st = document.createElement('style');
          st.textContent = '.me{background:' + theme.accent + ';} button{background:' + theme.accent + ';}';
          document.head.appendChild(st);
        }
      }
    } catch (e) {}

    try {
      try { apiKey = (await MobileSSH.storage.getSecret('apiKey')) || '0p3n-w3bu!'; } catch (e) { apiKey = '0p3n-w3bu!'; }

      // Only run (and re-consent) the recipe when something still needs doing.
      var satisfied = false;
      try {
        var rs = await MobileSSH.recipe.status();
        satisfied = !!(rs && rs.steps && rs.steps.length && rs.steps.every(function (s) { return s.satisfied; }));
      } catch (e) {}
      if (!satisfied) {
        sys('Setting up the Pipelines server…');
        var res = await MobileSSH.recipe.run(null, {});
        if (!res || !res.ok) { sys('Setup failed. Check the host logs and try again.'); return; }
      }

      tunnel = await MobileSSH.tunnel.open({ port: 9099 });
      sub.textContent = tunnel.url;
      await loadModels();
      input.disabled = false; sendBtn.disabled = false; input.focus();
      sys('Ready. Pick a model and start chatting.');
    } catch (e) {
      sys('Error: ' + e.message);
    }
  }

  async function ask(text) {
    var model = modelsSel.value || '';
    history.push({ role: 'user', content: text });
    bubble('me', text);
    var out = bubble('ai', '');
    var acc = '';
    var buf = '';
    var errMsg = '';

    function handleData(payload) {
      payload = payload.trim();
      if (!payload || payload === '[DONE]') return;
      try {
        var obj = JSON.parse(payload);
        if (obj.error) { errMsg = (typeof obj.error === 'string') ? obj.error : (obj.error.message || 'error'); return; }
        var ch = obj.choices && obj.choices[0];
        var delta = ch && (ch.delta || ch.message);
        if (delta && delta.content) {
          acc += delta.content;
          out.textContent = acc;
          chat.scrollTop = chat.scrollHeight;
        }
      } catch (e) { /* partial/non-JSON; ignore */ }
    }

    function onChunk(s) {
      buf += s;
      var idx;
      // SSE frames are separated by a blank line; each line within starts with "data:".
      while ((idx = buf.indexOf('\n')) >= 0) {
        var line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        line = line.replace(/\r$/, '').trim();
        if (!line) continue;
        if (line.indexOf('data:') === 0) {
          handleData(line.slice(5));
        }
      }
    }

    function fail(msg) {
      out.textContent = (acc ? acc + '\n' : '') + '[Error: ' + msg + ']';
      history.pop();
    }

    try {
      var res = await MobileSSH.http.fetch({
        url: tunnel.url + '/v1/chat/completions',
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ model: model, messages: history, stream: true }),
        stream: true,
      }, onChunk);
      if (buf.trim()) onChunk('\n'); // flush any trailing buffered line
      if (errMsg) { fail(errMsg); return; }
      if (res && typeof res.status === 'number' && res.status >= 400) { fail('HTTP ' + res.status); return; }
      if (!acc) { fail('No reply.'); return; }
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
