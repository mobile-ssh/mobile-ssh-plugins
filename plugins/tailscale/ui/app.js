/* Tailscale plugin — install + up, capture the login URL, show status. */
(function () {
  'use strict';
  var logEl = document.getElementById('log');
  var loginBtn = document.getElementById('login');
  var refreshBtn = document.getElementById('refresh');
  var authUrl = null;
  function log(m) { logEl.textContent += '\n' + m; logEl.scrollTop = logEl.scrollHeight; }

  (async function init() {
    try { var theme = await MobileSSH.ui.theme(); document.body.style.background = theme.background; document.body.style.color = theme.text; } catch (e) {}
  })();

  async function showStatus() {
    try {
      var r = await MobileSSH.ssh.exec('tailscale status 2>&1 || true', { timeoutMs: 15000 });
      log('\n$ tailscale status\n' + (r.stdout || r.stderr || '(no output)'));
    } catch (e) { log('status error: ' + e.message); }
  }

  document.getElementById('setup').onclick = async function () {
    var btn = this; btn.disabled = true;
    try {
      log(t('setup_msg'));
      var res = await MobileSSH.recipe.run();
      if (!res.ok) { log(t('setup_failed')); btn.disabled = false; return; }
      authUrl = res.captures && res.captures.authUrl;
      if (authUrl) {
        log(t('login_required'));
        loginBtn.classList.remove('hidden');
      } else {
        log(t('already_connected'));
      }
      refreshBtn.classList.remove('hidden');
      btn.textContent = t('rerun');
      await showStatus();
    } catch (e) { log(t('error', e.message)); }
    btn.disabled = false;
  };

  loginBtn.onclick = function () { if (authUrl) MobileSSH.ui.openService(authUrl); };
  refreshBtn.onclick = showStatus;
})();
