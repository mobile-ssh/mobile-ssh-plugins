/* Claude Code CLI plugin — installs the claude CLI on the remote (user-local, no root). */
(function () {
  'use strict';
  var logEl = document.getElementById('log');
  function log(m) { logEl.textContent += '\n' + m; logEl.scrollTop = logEl.scrollHeight; }

  (async function init() {
    try {
      var theme = await MobileSSH.ui.theme();
      if (theme) {
        if (theme.background) document.body.style.background = theme.background;
        if (theme.text) document.body.style.color = theme.text;
      }
    } catch (e) {}
  })();

  document.getElementById('setup').onclick = async function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Installing\u2026';       // visible in-progress state on the button itself
    var nextLabel = 'Install Claude Code CLI';
    try {
      log('Installing (approve the commands; the Node.js download can take a minute)\u2026');
      var res = await MobileSSH.recipe.run();
      if (!res || !res.ok) { log('Install failed \u2014 see the steps above.'); return; }
      log('Installed. Go back to the terminal (\u2039) and run `claude` \u2014 best inside tmux.');
      log('First run handles sign-in.');
      nextLabel = 'Re-run install';
    } catch (e) {
      log('Error: ' + e.message);
    } finally {
      // Always clear the in-progress state, even if a step threw.
      btn.textContent = nextLabel;
      btn.disabled = false;
    }
  };
})();
