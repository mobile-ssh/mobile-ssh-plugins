# Security & privacy model

Mobile SSH is privacy-first (no servers, local-only credentials). Plugins must not erode that.

## The trust boundary: two WebViews, one bridge

- **Plugin UI WebView** — loads your curated `ui/` (bundled in the app or fetched from the verified
  catalog) and is the **only** surface with `window.MobileSSH`. Served from a fixed app origin
  (`WebViewAssetLoader`), so it can't be navigated to arbitrary remote pages.
- **Service WebView** — `MobileSSH.ui.openService(url)` opens the remote service's own page (code-server,
  wg-easy, …) in a **separate WebView with no bridge**. Even if that page is compromised, it cannot
  reach `ssh.exec`/`tunnel`.

This split is what satisfies both app stores' rules about powerful native bridges and downloaded code
(Google Play's "Sensitive JavaScript Interface"; Apple's no-runtime-code-download policy — plugins are
interpreted data running in a WebView, and recipes run on the remote host, not in the app): a powerful
bridge is never attached to untrusted/remote content.

## What plugins can and can't see

- Plugins receive a `SessionInfo` (host/port/user/connected) — **never** the password or private key.
- Storage is namespaced per plugin; `putSecret` values are encrypted at rest via the host's platform
  secure storage (Android Keystore / iOS Keychain). Plugins can't read each other's storage or the app's
  credential store.
- Plugin analytics (if any) are namespaced and honor the app's global opt-out.

## Server-side safety

- **Consent on every command.** Recipe `run` strings are shown verbatim before execution; `sudo` steps
  are flagged. Nothing mutates the server silently.
- **Loopback ≠ private on shared hosts.** A service bound to `127.0.0.1` is reachable by any local user
  on that server. Recipes should enable the service's own auth (code-server password, wg-easy wizard)
  as defense-in-depth; the SSH tunnel / tailnet is the transport boundary, not an authz boundary.
- **Prefer `tailscale-serve` for real TLS.** It gives a publicly-trusted cert on `*.ts.net`, avoiding
  cleartext loopback entirely when the phone is on the tailnet.

## Egress disclosure

`HTTP_INTERNET` can send data off-device (e.g. an AI-chat plugin pointed at a hosted endpoint). Such a
plugin must disclose this in its description and in the UI before the first send; the host shows a
one-time banner and records the acknowledgement. A plugin pointed only at a forwarded local model needs
just `HTTP_LOOPBACK` — the stronger privacy story.

## What's out of scope here

No compiled/native code and no runtime code download (Play policy). Native features (on-device LLM,
native resilient-terminal clients) live in the host app, not in this repo.
