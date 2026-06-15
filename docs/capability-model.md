# Capability model

Every plugin declares the capabilities it needs in `manifest.json`. The host:

1. shows them (in plain language) when the user enables the plugin, and
2. **gates every bridge call** — calling an API for a capability you didn't declare rejects.

| Capability | Grants | Notes |
|---|---|---|
| `SSH_EXEC` | `ssh.exec`, `ssh.execStream`, `recipe.run` | Runs commands on the remote. Recipe commands are shown for consent. |
| `TUNNEL` | `tunnel.open/close/list` | Open `ssh-forward` / `tailscale-serve` tunnels. |
| `HTTP_LOOPBACK` | `http.fetch` to the tunnel URL / `127.0.0.1` | Traffic stays on the SSH tunnel (or tailnet). Safe default for talking to a forwarded service. |
| `HTTP_INTERNET` | `http.fetch` to arbitrary hosts | **Sensitive** — egress beyond the tunnel. Disclose loudly; the host warns the user once and records consent. |
| `STORAGE` | `storage.*` | Plugin-scoped key/value; `putSecret`/`getSecret` are encrypted at rest. |
| `NOTIFICATIONS` | `notify` | Post a local notification / publish to the user's ntfy topic. |

## Principles

- **Least privilege.** Request only what the plugin uses. A chat-over-a-local-model plugin needs
  `TUNNEL` + `HTTP_LOOPBACK` (+ `STORAGE`), *not* `HTTP_INTERNET`.
- **Loopback vs internet is the privacy line.** `HTTP_LOOPBACK` keeps data on the tunnel; `HTTP_INTERNET`
  can send terminal-adjacent data off-device, so it's treated as sensitive.
- **The bridge never touches credentials.** Plugins get a `SessionInfo` (host/port/user), never the
  password or key. Recipes act through the already-authenticated session.
- **Recipes are consented per run.** `SSH_EXEC` lets a plugin *propose* commands; the user approves the
  literal text before anything executes.
