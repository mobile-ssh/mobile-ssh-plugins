/* VS Code (code-server) plugin. */
(function () {
  'use strict';
  var logEl = document.getElementById('log');
  var tunnel = null;

  function log(m) { logEl.textContent += '\n' + m; logEl.scrollTop = logEl.scrollHeight; }

  function randomPassword() {
    var bytes = new Uint8Array(18);
    (self.crypto || window.crypto).getRandomValues(bytes);
    return btoa(String.fromCharCode.apply(null, bytes)).replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
  }

  async function applyTheme() {
    try {
      var theme = await MobileSSH.ui.theme();
      var s = document.body.style;
      s.background = theme.background; s.color = theme.text;
    } catch (e) {}
  }

  async function init() {
    await applyTheme();
    var s = await MobileSSH.session();
    if (s) document.getElementById('title').textContent = 'VS Code — ' + s.label;
  }

  document.getElementById('setup').onclick = async function () {
    var btn = this; btn.disabled = true;
    try {
      var pw = await MobileSSH.storage.getSecret('password');
      if (!pw) { pw = randomPassword(); await MobileSSH.storage.putSecret('password', pw); }

      log(t('running_setup'));
      var res = await MobileSSH.recipe.run(null, { password: pw });
      if (!res.ok) { log(t('setup_failed')); btn.disabled = false; return; }

      log(t('opening_tunnel'));
      tunnel = await MobileSSH.tunnel.open({ port: 8080 });
      log(t('reachable_at', tunnel.url, tunnel.backend));

      document.getElementById('pw').textContent = pw;
      document.getElementById('ready').classList.remove('hidden');
      btn.textContent = t('rerun');
    } catch (e) {
      log(t('error', e.message));
    }
    btn.disabled = false;
  };

  document.getElementById('open').onclick = function () {
    if (tunnel) MobileSSH.ui.openService(tunnel.url);
  };

  document.getElementById('open-ext').onclick = function () {
    if (tunnel) MobileSSH.ui.openExternal(tunnel.url);
  };

  init();
})();
