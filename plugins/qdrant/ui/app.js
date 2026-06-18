/* Qdrant plugin — deploys the Qdrant vector DB in Docker and opens its dashboard. */
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
      if (theme.background) document.body.style.background = theme.background;
      if (theme.text) document.body.style.color = theme.text;
      if (theme.accent) {
        document.getElementById('setup').style.background = theme.accent;
        openBtn.style.background = theme.accent;
      }
    } catch (e) {}
  })();

  document.getElementById('setup').onclick = async function () {
    var btn = this; btn.disabled = true;
    try {
      log('Setting up Qdrant…');
      var res = await MobileSSH.recipe.run();
      if (!res.ok) { log('Setup failed.'); if (res && res.log) log(String(res.log).slice(-2000)); btn.disabled = false; return; }
      btn.textContent = 'Re-run setup';
      try {
        if (tunnel) { try { await MobileSSH.tunnel.close(tunnel); } catch (_) {} tunnel = null; }
        tunnel = await MobileSSH.tunnel.open({ port: 6333 });
        var base = tunnel.url.replace(/\/$/, '');
        log('Reachable at ' + base);
        log('Dashboard: ' + base + '/dashboard');
        openBtn.classList.remove('hidden');
        openExtBtn.classList.remove('hidden');
      } catch (te) {
        log('Tunnel failed: ' + ((te && te.message) || te));
      }
    } catch (e) {
      log('Error: ' + ((e && e.message) || e));
    }
    btn.disabled = false;
  };

  function dashUrl() {
    if (!tunnel) return null;
    return tunnel.url.replace(/\/$/, '') + '/dashboard';
  }
  openBtn.onclick = function () { var u = dashUrl(); if (u) MobileSSH.ui.openService(u); };
  openExtBtn.onclick = function () { var u = dashUrl(); if (u) MobileSSH.ui.openExternal(u); };
})();
