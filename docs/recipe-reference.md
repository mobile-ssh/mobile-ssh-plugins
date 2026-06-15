# recipe.json reference

Authoritative schema: [`schema/recipe.schema.json`](../schema/recipe.schema.json).

A recipe is an ordered list of `steps` the host runs on the remote over SSH. **Before running, the host
shows the user every `run` command verbatim and asks for consent.** `{{vars}}` are substituted from
`recipe.run(stepId, vars)` and from earlier-step `capture`s.

| Step field | Description |
|---|---|
| `id` | Stable step id. |
| `description` | Shown beside the command in the consent dialog. |
| `run` | The exact shell command (shown verbatim). May contain `{{vars}}`. |
| `check` | Probe; if it exits 0 the step is already satisfied and is skipped (idempotency). |
| `sudo` | Marks a root command; surfaced prominently. |
| `stream` | Run via `execStreaming` so output/captures arrive live (install logs, auth URLs). |
| `capture` | `{ varName: "regex-with-one-group" }` applied to stdout → returned in `RecipeResult.captures`. |
| `forwardPort` | After the step, open the default tunnel to this remote port. |
| `continueOnError` | Don't abort the recipe if this step fails. |
| `timeoutMs` | Per-step timeout. |

### Example — capture Tailscale's auth URL

```json
{
  "steps": [
    {
      "id": "install",
      "description": "Install Tailscale (official script).",
      "check": "command -v tailscale",
      "run": "curl -fsSL https://tailscale.com/install.sh | sh",
      "sudo": true
    },
    {
      "id": "up",
      "description": "Bring Tailscale up and print the login URL.",
      "run": "sudo tailscale up --json=false 2>&1",
      "stream": true,
      "capture": { "authUrl": "(https://login\\.tailscale\\.com/[^\\s]+)" }
    }
  ]
}
```

The plugin then does `const { captures } = await MobileSSH.recipe.run(); open(captures.authUrl)`.

## Server-side uninstall (`uninstall`)

Add an optional top-level `uninstall` array (same step shape) describing how to remove the plugin's
footprint from the server (stop services, delete data/caches, remove binaries/containers). When the
user uninstalls the plugin on the phone they can tick **"Also remove from server"**, which runs these
steps against the active session (or a server they pick) — shown for consent first. Uninstall steps are
**best-effort**: non-zero exit codes are ignored (removing something already gone is fine), so use
`|| true` / `continueOnError` liberally.

```json
{
  "steps": [ /* … install … */ ],
  "uninstall": [
    { "id": "stop", "description": "Stop the service.", "run": "pkill -f myservice || true", "continueOnError": true },
    { "id": "purge", "description": "Remove data and cache.", "run": "rm -rf ~/.myservice", "sudo": true }
  ]
}
```
