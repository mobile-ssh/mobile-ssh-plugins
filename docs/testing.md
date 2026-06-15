# Testing a plugin

## Static checks

```bash
npm install
npm run check      # regenerate the catalog + validate every manifest/recipe + JSON Schemas
```

CI runs the same plus a `node --check` syntax pass over all plugin/SDK JS.

## Run the UI in a desktop browser (mock bridge)

The bridge shim only needs a native object named `__MobileSSHNative` with an `invoke(method, argsJson)`
method, plus the host calling back `window.__mobileSSH._resolve(...)`. For local UI work, stub it:

```html
<script>
  // Mock BEFORE loading the shim.
  window.__MobileSSHNative = {
    invoke(method, argsJson) {
      const id = 'r' + Math.random();
      const args = JSON.parse(argsJson);
      setTimeout(() => {
        const reply = (res) => window.__mobileSSH._resolve(id, null, JSON.stringify(res));
        if (method === 'session') reply({ host: 'demo', port: 22, user: 'me', connected: true, label: 'me@demo:22' });
        else if (method === 'ui.theme') reply({ accent: '#2196F3', background: '#1a1a2e', surface: '#23233a', text: '#eee', isDark: true });
        else if (method === 'recipe.run') reply({ ok: true, captures: {}, log: 'mock' });
        else if (method === 'tunnel.open') reply({ id: 't1', backend: 'ssh-forward', url: 'http://127.0.0.1:8080', scheme: 'http', localPort: 8080 });
        else if (method === 'http.fetch') reply({ status: 200, headers: {}, body: 'ok' });
        else reply({});
      }, 50);
      return id;
    }
  };
</script>
<script src="../../sdk/mobilessh.js"></script>
<script src="app.js"></script>
```

Open the HTML in a browser and drive your UI against the mock. For streaming, have the mock call
`window.__mobileSSH._emit(args.__streamId, JSON.stringify({ line: '...' }))` before `_resolve`.

## End-to-end (in the app)

1. Build/run Mobile SSH on a device/emulator with the plugin runtime.
2. Stand up the target service on a test host (see [agent-cookbook.md](agent-cookbook.md) for one-liners).
3. Connect, open the plugin via 🧩, approve the recipe, confirm the tunnel + UI.

## Dev loop: load from a clone on the server

The fastest iteration path doesn't involve GitHub at all. Clone this repo onto the server you SSH into:

```bash
git clone https://github.com/mobile-ssh/mobile-ssh-plugins ~/mobile-ssh-plugins
```

Then in the app, on a **connected** session: 🧩 → **Plugins** → **Load from server folder…**. This opens
an SFTP **folder browser** starting in your home directory — navigate to the clone (or a single plugin
dir) and tap **Install / sync from this folder**. The app finds the plugin dirs (the folder itself, its
child dirs, or those under a `plugins/` subfolder), downloads each over SFTP into app storage, and tags
them **dev**. Edit files in the clone, hit **Re-sync** (remembers the last folder), relaunch the plugin
to see changes. No SHA-256 gate here (it's your own checkout).
