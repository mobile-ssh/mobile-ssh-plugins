/* Flowise plugin — deploys Flowise in Docker and opens it in-app or in the browser. */
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
          document.getElementById('setup').style.background = theme.accent;
          openBtn.style.background = theme.accent;
        }
      }
    } catch (e) {}
  })();

  document.getElementById('setup').onclick = async function () {
    var btn = this; btn.disabled = true;
    try {
      log('Installing and starting Flowise…');
      var res = await MobileSSH.recipe.run();
      if (!res || !res.ok) { log('Setup failed. Check the steps above.'); btn.disabled = false; return; }
      // The container is running now — reflect that even if opening the tunnel fails.
      btn.textContent = 'Re-run setup';
      if (tunnel) { try { await MobileSSH.tunnel.close(tunnel); } catch (e) {} tunnel = null; }
      openBtn.classList.add('hidden');
      openExtBtn.classList.add('hidden');
      try {
        tunnel = await MobileSSH.tunnel.open({ port: 3000 });
        log('Reachable at ' + tunnel.url);
        log('First load can take a moment while Flowise initializes.');
        openBtn.classList.remove('hidden');
        openExtBtn.classList.remove('hidden');
      } catch (te) {
        openBtn.classList.add('hidden');
        openExtBtn.classList.add('hidden');
        log('Tunnel failed: ' + (te && te.message ? te.message : te));
      }
    } catch (e) {
      log('Error: ' + (e && e.message ? e.message : e));
    }
    btn.disabled = false;
  };

  openBtn.onclick = function () { if (tunnel) MobileSSH.ui.openService(tunnel.url); };
  openExtBtn.onclick = function () { if (tunnel) MobileSSH.ui.openExternal(tunnel.url); };
})();
