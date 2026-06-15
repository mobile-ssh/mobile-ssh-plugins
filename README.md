# Mobile SSH — Plugins

Open-source plugin ecosystem for the [Mobile SSH](https://github.com/mobile-ssh) apps on iOS and
Android — both hosts load plugins from this one repo.
Plugins turn Mobile SSH into a **mobile cockpit for driving long-running AI agents on remote
servers**: bring up a remote VS Code, chat with a model over a port forward, install WireGuard or
Tailscale, get pushed a notification when an agent finishes — all from your phone.

## What a plugin is

A plugin is **interpreted JavaScript + data** — never compiled code — so it can be downloaded from
GitHub at runtime and still comply with both app stores' policies (Google Play permits code run in a
WebView but forbids downloading compiled `dex`/`.so`; Apple forbids downloading executable code —
interpreted data running in a WebView is fine). A plugin is:

1. **A manifest** (`manifest.json`) — id, capabilities it requests, and how it's launched.
2. **A WebView UI** (`ui/index.html` + JS) — talks to the app through `window.MobileSSH`
   (see [`sdk/mobilessh.d.ts`](sdk/mobilessh.d.ts)).
3. *(optional)* **A server recipe** (`recipe.json`) — shell commands the app runs on the remote host
   **after showing you the exact commands**.
4. *(optional)* **A tunnel** — `ssh-forward` (loopback) or `tailscale-serve` (real HTTPS on `*.ts.net`).

```
plugins/<id>/
├── manifest.json     # see schema/plugin.schema.json
├── recipe.json       # see schema/recipe.schema.json  (optional)
├── ui/index.html     # your UI
├── ui/app.js
└── icon.svg
```

The bridge (`ssh.exec`, `tunnel`, `http`, `storage`, `ui`, `recipe`) is attached **only** to your
plugin's own UI — never to a remote service's web page.

## Quick start

```bash
npm install
cp -r template-plugin plugins/my-plugin   # edit manifest.json + ui/
npm run check                              # build catalog + validate everything
```

Then open the plugin from **Plugins** in the app (or via the 🧩 action on a connected session).

## Repo layout

| Path | What |
|---|---|
| `sdk/` | The bridge: `mobilessh.js` (host-injected Promise shim) + `mobilessh.d.ts` (typed API) |
| `schema/` | JSON Schemas for the manifest, recipe, and catalog |
| `plugins/` | The plugins (each its own directory) |
| `template-plugin/` | Copy-paste starter |
| `catalog/plugins.json` | Generated index the app fetches |
| `docs/` | Author guide, manifest/recipe/bridge references, capability & security model, agent cookbook |
| `tools/` | `validate.mjs`, `build-catalog.mjs` |

## Docs

Start with [docs/author-guide.md](docs/author-guide.md). Security & capability model:
[docs/security.md](docs/security.md). Driving agents: [docs/agent-cookbook.md](docs/agent-cookbook.md).

## License

MIT. See [LICENSE](LICENSE) and [GOVERNANCE.md](GOVERNANCE.md).
