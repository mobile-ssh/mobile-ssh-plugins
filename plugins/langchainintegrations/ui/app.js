(function () {
  'use strict';

  // Offline registry snapshot: bundled LangChain integration pip packages.
  var CATALOG = [
    'langchain-ollama',
    'langchain-chroma',
    'langchain-qdrant',
    'langchain-community',
    'langchain-huggingface',
    'langchain-text-splitters',
    'langchain-unstructured',
    'langchain-postgres',
    'langchain-mongodb',
    'langchain-elasticsearch',
    'langchain-google-community',
    'langchain-experimental'
  ];

  var STORE_KEY = 'installed';

  var listEl = document.getElementById('list');
  var filterEl = document.getElementById('filter');
  var logEl = document.getElementById('log');

  var installed = {};

  function applyTheme() {
    try {
      // ui.theme() resolves to the host theme tokens — apply them once it settles.
      Promise.resolve(MobileSSH.ui.theme()).then(function (t) {
        if (t && t.background) document.documentElement.style.setProperty('--bg', t.background);
        if (t && t.text) document.documentElement.style.setProperty('--text', t.text);
        if (t && t.accent) document.documentElement.style.setProperty('--accent', t.accent);
      }).catch(function () {});
    } catch (e) { /* host injects theme; ignore if unavailable */ }
  }

  function log(line) {
    logEl.hidden = false;
    logEl.textContent += (logEl.textContent ? '\n' : '') + line;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function render() {
    var q = (filterEl.value || '').toLowerCase().trim();
    listEl.innerHTML = '';
    CATALOG.filter(function (name) {
      return !q || name.toLowerCase().indexOf(q) !== -1;
    }).forEach(function (name) {
      var row = document.createElement('div');
      row.className = 'row';

      var nameWrap = document.createElement('div');
      nameWrap.className = 'name';
      nameWrap.textContent = name;
      if (installed[name]) {
        var done = document.createElement('span');
        done.className = 'done';
        done.textContent = 'installed';
        nameWrap.appendChild(done);
      }

      var btn = document.createElement('button');
      btn.textContent = 'Install';
      btn.addEventListener('click', function () {
        install(name, btn);
      });

      row.appendChild(nameWrap);
      row.appendChild(btn);
      listEl.appendChild(row);
    });
  }

  async function install(name, btn) {
    btn.disabled = true;
    btn.textContent = 'Installing...';
    log('$ pip install ' + name);
    try {
      var res = await MobileSSH.recipe.run('install', { package: name });
      if (res && res.log) log(String(res.log).trim());
      if (res && res.ok === false) {
        log(name + ': failed - recipe did not complete successfully.');
        try { MobileSSH.ui.toast('Failed: ' + name); } catch (e) {}
        btn.disabled = false;
        btn.textContent = 'Install';
        return;
      }
      log(name + ': done.');
      try { MobileSSH.ui.toast('Installed ' + name); } catch (e) {}
      installed[name] = true;
      try { await MobileSSH.storage.put(STORE_KEY, JSON.stringify(Object.keys(installed))); } catch (e) {}
      render();
    } catch (err) {
      var msg = (err && err.message) ? err.message : String(err);
      log(name + ': failed - ' + msg);
      try { MobileSSH.ui.toast('Failed: ' + name); } catch (e) {}
      btn.disabled = false;
      btn.textContent = 'Install';
    }
  }

  async function init() {
    applyTheme();
    try {
      var raw = await MobileSSH.storage.get(STORE_KEY);
      if (raw) {
        JSON.parse(raw).forEach(function (n) { installed[n] = true; });
      }
    } catch (e) { /* ignore */ }
    filterEl.addEventListener('input', render);
    render();
  }

  init();
})();
