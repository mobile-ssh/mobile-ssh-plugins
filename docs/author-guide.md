# Plugin author guide

A Mobile SSH plugin is a small web app that runs in a WebView inside the SSH client and talks to the
host through `window.MobileSSH`. The host gives it controlled access to the **active SSH session**
(run commands), **tunnels** (reach remote ports), **HTTP** (talk to forwarded services), **storage**,
and **UI**. Many plugins also ship a **server recipe** that installs/launches something on the remote.

## Mental model: recipe → tunnel → UI

Most useful plugins follow the same arc:

1. **Recipe** *(optional)* — make sure the service exists/runs on the remote (`docker run …`, an install
   script, `tailscale up`). The host shows the exact commands and asks the user to approve.
2. **Tunnel** *(optional)* — reach the service: `ssh-forward` gives `http://127.0.0.1:<port>`;
   `tailscale-serve` gives `https://<host>.<tailnet>.ts.net`.
3. **UI** — either render your own screen (chat, dashboard) that calls the service via
   `MobileSSH.http.fetch`, or hand a URL to `MobileSSH.ui.openService(url)` to show the service's own
   web UI in a separate, bridge-less WebView.

## Anatomy

```
plugins/<id>/
├── manifest.json    # identity + capabilities + how it launches  (schema/plugin.schema.json)
├── recipe.json      # server install/launch steps                (schema/recipe.schema.json)  [optional]
├── ui/index.html    # your UI entry (manifest.ui.entry)
├── ui/app.js
└── icon.svg
```

See [manifest-reference.md](manifest-reference.md), [recipe-reference.md](recipe-reference.md),
[bridge-api.md](bridge-api.md).

## A minimal plugin

```js
// ui/app.js
const tunnel = await MobileSSH.tunnel.open({ port: 8080 });   // ssh-forward by default
const res = await MobileSSH.http.fetch({ url: tunnel.url + "/api/health" });
MobileSSH.ui.toast("health: " + res.status);
MobileSSH.ui.openService(tunnel.url);                          // or show the service's own UI
MobileSSH.ui.openExternal(tunnel.url);                         // …or hand it to the phone's browser
```

`openService` shows the service in the in-app (bridge-less) WebView; `openExternal` opens it in the
default mobile browser. Both use the same tunnel — only the server side needs the forward, the client
is just a URL. The tunnel stays alive in the background (Android foreground service / iOS background
execution + reconnect) while the user is in the browser. The host also shows a 🌐 button in its top bar for any plugin that declares a `tunnel`/
`serviceUrl`, so users get this even if your UI doesn't add its own button. (A plugin's *own* bridge UI
can't run in an external browser — only server-backed service URLs can.)

With a recipe:

```js
const r = await MobileSSH.recipe.run();          // host shows the commands + asks consent
if (r.ok) {
  const t = await MobileSSH.tunnel.open({ port: 8080 });
  MobileSSH.ui.openService(t.url);
}
```

## sessionRequirement

- `REQUIRES_ACTIVE_SESSION` — launched from a connected pane (🧩). `MobileSSH.session()` is non-null;
  recipes/tunnels act on that host. Most plugins.
- `PICKS_SERVER` — launched from the hub; you ask the host to connect to a saved server first.
- `STANDALONE` — no SSH at all (rare for this repo; native features like on-device LLM live in the app).

## Do / don't

- **Do** request the fewest capabilities; keep `minBridgeVersion` low; store secrets with `putSecret`.
- **Do** match the host theme — call `MobileSSH.ui.theme()` and apply the colors.
- **Don't** download or `eval` remote code; **don't** attach to untrusted pages; **don't** hide commands.

Next: [security.md](security.md), [capability-model.md](capability-model.md),
[tunnel-backends.md](tunnel-backends.md), [agent-cookbook.md](agent-cookbook.md),
[testing.md](testing.md).
