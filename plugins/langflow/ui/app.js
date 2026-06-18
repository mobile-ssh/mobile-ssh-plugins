/* Langflow plugin — deploys Langflow (visual LangChain builder) and opens it in-app or in the browser. */
(function () {
  'use strict';
  var logEl = document.getElementById('log');
  var setupBtn = document.getElementById('setup');
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
          setupBtn.style.background = theme.accent;
          openBtn.style.background = theme.accent;
        }
        if (theme.surface) { logEl.style.background = theme.surface; openExtBtn.style.background = theme.surface; }
      }
    } catch (e) {}
  })();

  setupBtn.onclick = async function () {
    var btn = this; btn.disabled = true;
    try {
      log('Setting up Langflow… first run pulls the image and runs DB migrations, this can take a while.');
      var res = await MobileSSH.recipe.run();
      if (!res || !res.ok) { log('Setup failed. Check the log above.'); btn.disabled = false; return; }
      // The container is running now — reflect that even if opening the tunnel fails.
      btn.textContent = 'Re-run setup';
      try {
        if (tunnel) { try { await MobileSSH.tunnel.close(tunnel); } catch (e) {} tunnel = null; }
        tunnel = await MobileSSH.tunnel.open({ port: 7860 });
        log('Reachable at ' + tunnel.url);
        log('First open creates the Langflow superuser — give it a moment if it is still starting.');
        openBtn.classList.remove('hidden');
        openExtBtn.classList.remove('hidden');
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
