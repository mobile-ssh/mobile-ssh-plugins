# Tunnel backends

`MobileSSH.tunnel.open({ port, backend? })` reaches a remote port through one of two backends. If you
omit `backend`, the host picks the best available (prefers `tailscale-serve` when the phone is on a
tailnet and the host can drive `tailscale serve`, else `ssh-forward`).

## `ssh-forward` (default, always available)

Wraps the app's existing local port forwarding. The host binds a local port and returns:

```js
{ backend: "ssh-forward", url: "http://127.0.0.1:54123", scheme: "http", localPort: 54123 }
```

- Works with nothing beyond the SSH session.
- Loads over cleartext loopback — the host allows local cleartext (Android ships a
  `network_security_config` for `127.0.0.1`/`::1`; iOS sets ATS `NSAllowsLocalNetworking`).
- Confidentiality comes from the SSH tunnel; the bound port is loopback-only on the phone.

## `tailscale-serve` (preferred when available)

The host runs `tailscale serve --https=443 localhost:<port>` on the remote and resolves the device's
MagicDNS name, returning:

```js
{ backend: "tailscale-serve", url: "https://host.tailnet.ts.net", scheme: "https", localPort: -1 }
```

- **Real, publicly-trusted HTTPS** (Let's Encrypt on `*.ts.net`) → no cleartext config, loads cleanly in
  the WebView, no port-forward needed.
- Requires the phone to be a member of the same tailnet (official Tailscale app installed + signed in;
  MagicDNS makes `*.ts.net` resolve system-wide).
- `tailscale funnel` (public exposure) is **not** used implicitly — only via an explicit, user-initiated
  action, since it opens the service to the internet.

## Choosing in a plugin

Most plugins should pass just `{ port }` and let the host choose. Pass `backend: "tailscale-serve"`
only if your plugin specifically wants the HTTPS name (e.g. to avoid cleartext for a service that sets
secure cookies); pass `backend: "ssh-forward"` to force the zero-dependency path.
