/* Chroma plugin — deploys a Chroma vector DB in Docker and opens its REST API docs in-app or in the browser. */
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
      log('Installing and starting Chroma…');
      var res = await MobileSSH.recipe.run();
      if (!res || !res.ok) { log('Setup failed.'); btn.disabled = false; return; }
      btn.textContent = 'Re-run setup';
      if (tunnel) { try { await MobileSSH.tunnel.close(tunnel); } catch (e) {} tunnel = null; }
      try {
        tunnel = await MobileSSH.tunnel.open({ port: 8001 });
        log('Reachable at ' + tunnel.url);
        log('REST API docs at ' + tunnel.url + '/docs');
        openBtn.classList.remove('hidden');
        openExtBtn.classList.remove('hidden');
      } catch (te) {
        log('Tunnel failed: ' + te.message);
        openBtn.classList.add('hidden');
        openExtBtn.classList.add('hidden');
      }
    } catch (e) {
      log('Error: ' + e.message);
    }
    btn.disabled = false;
  };

  openBtn.onclick = function () { if (tunnel) MobileSSH.ui.openService(tunnel.url + '/docs'); };
  openExtBtn.onclick = function () { if (tunnel) MobileSSH.ui.openExternal(tunnel.url + '/docs'); };
})();
