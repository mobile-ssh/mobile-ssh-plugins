/* Chainlit Chat plugin — sets up Chainlit + LlamaIndex (Ollama) and opens it in-app or in the browser. */
(function () {
  'use strict';
  var logEl = document.getElementById('log');
  var openBtn = document.getElementById('open');
  var openExtBtn = document.getElementById('open-ext');
  var tunnel = null;
  function log(m) { logEl.textContent += '\n' + m; logEl.scrollTop = logEl.scrollHeight; }

  (async function init() {
    try {
      var theme = await MobileSSH.ui.theme();
      if (theme) {
        if (theme.background) document.body.style.background = theme.background;
        if (theme.text) document.body.style.color = theme.text;
        if (theme.accent) {
          var btns = document.querySelectorAll('button:not(.secondary)');
          for (var i = 0; i < btns.length; i++) btns[i].style.background = theme.accent;
        }
      }
    } catch (e) {}
  })();

  document.getElementById('setup').onclick = async function () {
    var btn = this; btn.disabled = true;
    try {
      log('Setting up Chainlit (this can take a while the first time)…');
      var res = await MobileSSH.recipe.run();
      if (!res || !res.ok) {
        log('Setup failed — check the log above.');
        btn.disabled = false;
        return;
      }
      btn.textContent = 'Re-run setup';
      try {
        if (tunnel) { try { await MobileSSH.tunnel.close(tunnel); } catch (ce) {} tunnel = null; }
        tunnel = await MobileSSH.tunnel.open({ port: 8000 });
        log('Reachable at ' + tunnel.url);
        var st = await MobileSSH.recipe.status();
        var serveOk = st && st.steps && st.steps.some(function (s) { return s.id === 'serve' && s.satisfied; });
        if (serveOk) {
          log('Tap "Open Chainlit" below.');
          openBtn.classList.remove('hidden');
          openExtBtn.classList.remove('hidden');
        } else {
          log('Chainlit is still starting — wait a few seconds and tap Re-run setup.');
          openBtn.classList.add('hidden');
          openExtBtn.classList.add('hidden');
        }
      } catch (te) {
        log('Tunnel failed: ' + (te && te.message ? te.message : te));
        openBtn.classList.add('hidden');
        openExtBtn.classList.add('hidden');
      }
    } catch (e) {
      log('Error: ' + (e && e.message ? e.message : e));
    }
    btn.disabled = false;
  };

  openBtn.onclick = function () { if (tunnel) MobileSSH.ui.openService(tunnel.url); };
  openExtBtn.onclick = function () { if (tunnel) MobileSSH.ui.openExternal(tunnel.url); };
})();
