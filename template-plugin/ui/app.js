/* Template plugin logic. Talks to the host via window.MobileSSH (see sdk/mobilessh.d.ts). */
(function () {
  'use strict';
  var logEl = document.getElementById('log');
  var tunnel = null;

  function log(msg) {
    logEl.textContent += '\n' + msg;
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function init() {
    try {
      var theme = await MobileSSH.ui.theme();
      var r = document.documentElement.style;
      r.setProperty('--accent', theme.accent);
      r.setProperty('--bg', theme.background);
      r.setProperty('--surface', theme.surface);
      r.setProperty('--text', theme.text);
    } catch (e) { /* dev fallback colors */ }

    var s = await MobileSSH.session();
    document.getElementById('title').textContent = s ? 'Template — ' + s.label : 'Template (no session)';
  }

  document.getElementById('install').onclick = async function () {
    log('Running recipe (host will ask for consent)…');
    try {
      var res = await MobileSSH.recipe.run();
      log('Recipe ok=' + res.ok + ' captures=' + JSON.stringify(res.captures));
      tunnel = await MobileSSH.tunnel.open({ port: 8000 });
      log('Tunnel: ' + tunnel.url + ' (' + tunnel.backend + ')');
      await MobileSSH.storage.put('lastUser', res.captures.user || '');
    } catch (e) { log('Error: ' + e.message); }
  };

  document.getElementById('ping').onclick = async function () {
    if (!tunnel) { log('Open a tunnel first (Run recipe).'); return; }
    try {
      var resp = await MobileSSH.http.fetch({ url: tunnel.url });
      log('HTTP ' + resp.status + ' (' + resp.body.length + ' bytes)');
    } catch (e) { log('Error: ' + e.message); }
  };

  document.getElementById('open').onclick = function () {
    if (!tunnel) { log('Open a tunnel first (Run recipe).'); return; }
    MobileSSH.ui.openService(tunnel.url);
  };

  init();
})();
