# Agent cookbook

Patterns for using Mobile SSH as a cockpit for long-running AI agents (Claude Code, aider, codex, …)
on a remote server. The loop: **persist** the session, **stream** the output, **push** when the agent
needs you.

## 1. Keep the agent alive across drops (persist)

Agents run for minutes to hours; phone links flap. Run the agent inside **tmux** so it survives
disconnects — the app auto-reattaches on reconnect.

```bash
tmux new -As agent          # create/attach a session named "agent"
claude        # or: aider / codex / your agent — runs server-side, survives the commute
```

Want a browser terminal that auto-reconnects with zero native code? Use the **ttyd** plugin
(`tmux new -A` behind a WebSocket terminal). Prefer `mosh`/`et`? Install them on the remote and run
them *inside* the shell — Mobile SSH stays the SSH/tmux client:

```bash
# server-side, via a recipe or by hand:
sudo apt-get install -y mosh        # or: et (EternalTerminal)
```

## 2. Watch it work (stream)

Streaming is free in the PTY terminal. For web UIs (code-server's terminal, Open WebUI, LibreChat) the
WebView carries the WebSocket/SSE stream. The terminal-agent driver adds the keys agents use:
**Shift+Tab** (Claude Code mode), **Esc** (interrupt), **Ctrl+C**, and **1/2/3** for numbered prompts.

## 3. Get pinged on finish / approval (push)

Wire your agent's completion or approval gate to **ntfy**. The app subscribes to your topic and raises
a notification; an **Approve/Deny** button can call an HTTP endpoint straight from the lock screen.

```bash
# Notify when a task finishes:
curl -d "build done ✅" ntfy.sh/my-agent-7c1f

# Ask for approval with action buttons (the Approve button POSTs to your gate URL):
curl -H "Title: Agent needs approval" \
     -H "Priority: high" \
     -H "Actions: http, Approve, https://host.tailnet.ts.net/approve, method=post; http, Deny, https://host.tailnet.ts.net/deny, method=post" \
     -d "Apply migration to prod?" ntfy.sh/my-agent-7c1f
```

Use a long, secret topic name (it's the access control on ntfy.sh) or self-host ntfy with tokens.
Claude Code/codex "stop" or "notification" hooks are a natural place to put the `curl`.

## 4. A full agent environment in one tap (code-server)

The **VS Code** plugin installs `code-server`, binds it to loopback, opens a tunnel, and shows the
editor. Run your agent in code-server's **integrated terminal**: the session lives server-side, so it
survives reconnects, and you get a real editor + file tree on the phone. Pre-install Open VSX
extensions via the recipe (`code-server --install-extension <id>`).

## 5. Reach services without a forward (Tailscale)

With the **Tailscale** plugin set up, other plugins can use the `tailscale-serve` tunnel backend to get
a real-HTTPS `https://host.tailnet.ts.net` URL — no port-forward, no cleartext, works from anywhere on
your tailnet. Great for code-server, Open WebUI, Jupyter.

## Recommended shortlist

1. **HTTP/HTTPS** — code-server (browser IDE) gives a full agent environment with one tap.
2. **tmux** (or ttyd) — resilient terminal that survives your commute.
3. **ntfy** — so you can lock the phone and get pinged when the agent needs you.
