/* Open WebUI plugin — deploys Open WebUI (Ollama chat) and opens it in-app or in the browser. */
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
    } catch (e) {}
  })();

  document.getElementById('setup').onclick = async function () {
    var btn = this; btn.disabled = true;
    try {
      log(t('setup_msg'));
      var res = await MobileSSH.recipe.run();
      if (!res.ok) { log(t('setup_failed')); btn.disabled = false; return; }
      tunnel = await MobileSSH.tunnel.open({ port: 3000 });
      log(t('reachable_at', tunnel.url));
      log(t('first_time'));
      openBtn.classList.remove('hidden');
      openExtBtn.classList.remove('hidden');
      btn.textContent = t('rerun');
    } catch (e) {
      log(t('error', e.message));
    }
    btn.disabled = false;
  };

  openBtn.onclick = function () { if (tunnel) MobileSSH.ui.openService(tunnel.url); };
  openExtBtn.onclick = function () { if (tunnel) MobileSSH.ui.openExternal(tunnel.url); };
})();
