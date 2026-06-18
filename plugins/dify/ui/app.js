/* Dify plugin — deploys the Dify LLM-app platform and opens it in-app or in the browser. */
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
      document.body.style.background = theme.background;
      document.body.style.color = theme.text;
      if (theme.accent) {
        var btns = document.querySelectorAll('button:not(.secondary)');
        for (var i = 0; i < btns.length; i++) btns[i].style.background = theme.accent;
      }
    } catch (e) {}
  })();

  document.getElementById('setup').onclick = async function () {
    var btn = this; btn.disabled = true;
    try {
      log('Installing & starting Dify (this can take several minutes on first run)…');
      var res = await MobileSSH.recipe.run();
      if (!res || !res.ok) { log('Setup failed. Check the steps above.'); btn.disabled = false; return; }
      btn.textContent = 'Re-run setup';
      try {
        tunnel = await MobileSSH.tunnel.open({ port: 8088 });
        log('Reachable at ' + tunnel.url);
        log('First visit: create the admin account.');
        openBtn.classList.remove('hidden');
        openExtBtn.classList.remove('hidden');
      } catch (te) {
        log('Tunnel failed: ' + (te && te.message));
      }
    } catch (e) {
      log('Error: ' + (e && e.message));
    }
    btn.disabled = false;
  };

  openBtn.onclick = function () { if (tunnel) MobileSSH.ui.openService(tunnel.url); };
  openExtBtn.onclick = function () { if (tunnel) MobileSSH.ui.openExternal(tunnel.url); };
})();
