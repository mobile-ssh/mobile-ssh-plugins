/* yt-dlp (MeTube) plugin — deploys the MeTube web UI and opens it in-app or in the browser. */
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
    var btn = this;
    btn.disabled = true;
    btn.textContent = t('installing');       // visible in-progress state on the button itself
    var nextLabel = t('setup_btn');          // what to show again if setup didn't complete
    try {
      log(t('setup_msg'));
      var res = await MobileSSH.recipe.run();
      if (!res.ok) { log(t('setup_failed')); return; }
      tunnel = await MobileSSH.tunnel.open({ port: 8081 });
      log(t('reachable_at', tunnel.url));
      log(t('first_time'));
      openBtn.classList.remove('hidden');
      openExtBtn.classList.remove('hidden');
      nextLabel = t('rerun');                // success → offer a re-run
    } catch (e) {
      log(t('error', e.message));
    } finally {
      // Always clear the in-progress state, even if a step threw — the button must never get
      // stuck disabled/"Installing…" once the run has finished.
      btn.textContent = nextLabel;
      btn.disabled = false;
    }
  };

  openBtn.onclick = function () { if (tunnel) MobileSSH.ui.openService(tunnel.url); };
  openExtBtn.onclick = function () { if (tunnel) MobileSSH.ui.openExternal(tunnel.url); };
})();
