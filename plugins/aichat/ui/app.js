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

  async function init() {
    try {
      var t = await MobileSSH.ui.theme();
      document.body.style.background = t.background; document.body.style.color = t.text;
    } catch (e) {}
    try {
      model = (await MobileSSH.storage.get('model')) || 'llama3.2:1b';
      sys(t('setup_msg', model));
      var res = await MobileSSH.recipe.run(null, { model: model });
      if (!res.ok) { sys(t('setup_failed')); return; }
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

    function onChunk(s) {
      buf += s;
      var nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        var line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        line = line.trim();
        if (!line) continue;
        try {
          var obj = JSON.parse(line);
          if (obj.message && obj.message.content) {
            acc += obj.message.content;
            out.textContent = acc;
            chat.scrollTop = chat.scrollHeight;
          }
        } catch (e) { /* partial/non-JSON line; ignore */ }
      }
    }

    try {
      await MobileSSH.http.fetch({
        url: tunnel.url + '/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model, messages: history, stream: true }),
        stream: true,
      }, onChunk);
      history.push({ role: 'assistant', content: acc });
    } catch (e) {
      out.textContent = acc + '\n[' + t('error', e.message) + ']';
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
