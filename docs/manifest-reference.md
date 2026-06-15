# manifest.json reference

Authoritative schema: [`schema/plugin.schema.json`](../schema/plugin.schema.json). Validate with
`npm run check`.

| Field | Req | Description |
|---|---|---|
| `id` | ✓ | Stable reverse-DNS id, e.g. `io.github.mobilessh.vscode`. |
| `name` | ✓ | Display name (≤40 chars). |
| `description` | ✓ | One line (≤200 chars). |
| `version` | ✓ | Plugin semver. Bump on every change. |
| `minBridgeVersion` | ✓ | Lowest `window.MobileSSH` version required. |
| `capabilities` | ✓ | Subset of `SSH_EXEC`, `TUNNEL`, `HTTP_LOOPBACK`, `HTTP_INTERNET`, `STORAGE`, `NOTIFICATIONS`. |
| `sessionRequirement` | ✓ | `REQUIRES_ACTIVE_SESSION` \| `PICKS_SERVER` \| `STANDALONE`. |
| `ui.entry` | ✓ | Relative path to the HTML entry (e.g. `ui/index.html`). |
| `category` |  | Catalog grouping: `connectivity`/`terminal`/`ide`/`llm`/`notebook`/`push`/`other`. |
| `icon` |  | Relative path to an SVG/PNG. |
| `recipe` |  | Relative path to a `recipe.json`. |
| `tunnel` |  | `{ port, remoteHost?, backend? }` — the default tunnel the host opens for this plugin. |
| `serviceUrl` |  | Template for `ui.openService`. Placeholders: `{tunnelUrl}`, `{port}`, `{localPort}`, and `{{captureVar}}` from the recipe. |
| `settings` |  | Array of `{ key, label, type, default?, placeholder?, help? }`; the host renders a form, values land in storage. |
| `author`, `homepage` |  | Metadata. |

### Example

```json
{
  "id": "io.github.mobilessh.vscode",
  "name": "VS Code",
  "description": "Run VS Code (code-server) on the remote and open it on your phone.",
  "version": "1.0.0",
  "minBridgeVersion": "1.0.0",
  "category": "ide",
  "capabilities": ["SSH_EXEC", "TUNNEL", "HTTP_LOOPBACK", "STORAGE"],
  "sessionRequirement": "REQUIRES_ACTIVE_SESSION",
  "ui": { "entry": "ui/index.html" },
  "recipe": "recipe.json",
  "tunnel": { "port": 8080 },
  "serviceUrl": "{tunnelUrl}/"
}
```
