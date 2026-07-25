/**
 * Mobile SSH — Plugin Bridge API (`window.MobileSSH`)
 * =====================================================
 *
 * This is the stable, semver-versioned contract between the Mobile SSH host app and a
 * plugin's WebView UI. The host injects `mobilessh.js` (which implements this interface
 * on top of a tiny native `@JavascriptInterface`) at document start, so `window.MobileSSH`
 * is available before your plugin's scripts run.
 *
 * The bridge is attached ONLY to a plugin's own curated UI WebView — never to a remote
 * service's web UI. Every capability you call must be declared in your plugin manifest;
 * a call to an undeclared capability rejects.
 *
 * All async methods return Promises. Compatibility: a plugin declares `minBridgeVersion`
 * in its manifest; the host refuses to load a plugin needing a higher MAJOR than it provides.
 * Adding methods is a MINOR bump; changing/removing is a MAJOR bump.
 */

declare global {
  interface Window {
    /** The host-provided plugin bridge. Present before plugin scripts execute. */
    MobileSSH: MobileSSHBridge;
  }
}

export interface MobileSSHBridge {
  /** Bridge implementation semver, e.g. "1.0.0". */
  readonly version: string;

  /**
   * The SSH session this plugin was launched against, or `null` for a standalone launch
   * (from the Plugins hub with no active session).
   */
  session(): Promise<SessionInfo | null>;

  /** True if the user granted this capability to this plugin (see manifest `capabilities`). */
  hasCapability(cap: Capability): Promise<boolean>;

  ssh: SshApi;
  tunnel: TunnelApi;
  http: HttpApi;
  storage: StorageApi;
  servers: ServersApi;
  recipe: RecipeApi;
  ui: UiApi;
  notify(opts: NotifyOptions): Promise<void>;
  log(level: LogLevel, message: string): void;
}

export type Capability =
  | 'SSH_EXEC'         // run remote commands / recipes
  | 'TUNNEL'           // open SSH-forward or tailscale-serve tunnels
  | 'HTTP_LOOPBACK'    // http.fetch to 127.0.0.1:<forwarded port> (data stays on the tunnel)
  | 'HTTP_INTERNET'    // http.fetch to arbitrary hosts (loud disclosure required)
  | 'STORAGE'          // plugin-scoped key/value (+ encrypted secrets)
  | 'NOTIFICATIONS'    // post a local notification / ntfy
  | 'SERVERS_MANAGE';  // create/remove saved-server rows THIS plugin owns (never read the user's)

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SessionInfo {
  host: string;
  port: number;
  user: string;
  connected: boolean;
  /** `<user>@<host>:<port>` */
  label: string;
}

// ── SSH ────────────────────────────────────────────────────────────────────────
export interface SshApi {
  /** Run a one-shot remote command on a fresh exec channel; capture stdout/stderr/exit. */
  exec(command: string, opts?: { timeoutMs?: number }): Promise<ExecResult>;

  /**
   * Run a command and receive stdout/stderr lines as they arrive (e.g. to watch an install
   * or capture an auth URL live). Resolves with the exit code when the command finishes.
   */
  execStream(
    command: string,
    onLine: (line: string, stream: 'stdout' | 'stderr') => void,
    opts?: { timeoutMs?: number },
  ): Promise<{ exitCode: number }>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ── Tunnels ───────────────────────────────────────────────────────────────────
export interface TunnelApi {
  /**
   * Open a tunnel to a port on the remote host.
   * - `ssh-forward` (default): the host's local port forwarding → returns `{ url: "http://127.0.0.1:<localPort>" }`.
   * - `tailscale-serve`: drives `tailscale serve` on the remote → returns a real-HTTPS
   *   `{ url: "https://<host>.<tailnet>.ts.net" }` (requires the phone on the tailnet).
   */
  open(opts: TunnelOpenOptions): Promise<TunnelHandle>;
  close(id: string): Promise<void>;
  list(): Promise<TunnelHandle[]>;
}

export interface TunnelOpenOptions {
  /** Remote port the service listens on. */
  port: number;
  /** Remote bind host as seen from the server (default `127.0.0.1`). */
  remoteHost?: string;
  /** Tunnel backend; host picks the best available default if omitted. */
  backend?: 'ssh-forward' | 'tailscale-serve';
}

export interface TunnelHandle {
  id: string;
  backend: 'ssh-forward' | 'tailscale-serve';
  /** Base URL to reach the service (loopback http for ssh-forward, https for tailscale-serve). */
  url: string;
  scheme: 'http' | 'https';
  /** Bound local port for ssh-forward; -1 for tailscale-serve. */
  localPort: number;
}

// ── HTTP (Java-side; no CORS) ───────────────────────────────────────────────────
export interface HttpApi {
  /**
   * Perform an HTTP request from the host (Java), bypassing WebView CORS. Use this to talk
   * to a forwarded service (e.g. Ollama at a tunnel URL). Set `stream:true` + pass `onChunk`
   * to receive a streamed body (SSE / chunked) incrementally.
   */
  fetch(opts: HttpRequest, onChunk?: (chunk: string) => void): Promise<HttpResponse>;
}

export interface HttpRequest {
  url: string;
  method?: string; // default GET
  headers?: Record<string, string>;
  body?: string;
  stream?: boolean;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  /** Full body, or "" when streamed via onChunk. */
  body: string;
}

// ── Plugin-scoped storage ───────────────────────────────────────────────────────
export interface StorageApi {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  /** Encrypted at rest (platform secure storage: Android Keystore / iOS Keychain). For tokens/passwords. */
  putSecret(key: string, value: string): Promise<void>;
  getSecret(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

// ── Saved servers (plugin-owned rows) ───────────────────────────────────────────
/**
 * Write access to the app's saved-server list, scoped to rows THIS plugin created.
 * You can never read, edit or delete a row the user made — `list()` returns only your own
 * rows, and `remove()` only ever matches your own `ref`. Ownership is recorded by the HOST
 * on the row itself, not in plugin storage, so it cannot be forged.
 *
 * Rows are always CREDENTIAL-LESS: host, port and username only. Passing a password or key
 * rejects rather than being silently dropped. That suits a token-as-username gateway (the
 * token IS the user, the password stays empty); anything needing a real secret stays manual.
 *
 * The HOST asks the user before creating a row, and again whenever the host or port changes.
 * A username-only change (a rotated token) updates silently.
 *
 * Available from bridge 1.1.0. Neither host enforces `minBridgeVersion`, and the shim ships
 * inside the app bundle — so on an older host `MobileSSH.servers` is `undefined` and a bare
 * call throws a TypeError. Feature-detect BOTH:
 *
 *     var ok = !!(MobileSSH.servers && typeof MobileSSH.servers.add === 'function')
 *              && await MobileSSH.hasCapability('SERVERS_MANAGE');
 */
export interface ServersApi {
  /**
   * Create the row identified by `ref`, or update it in place if it already exists.
   * Idempotent: re-adding the same `ref` with identical values writes nothing (`'unchanged'`).
   */
  add(server: ServerDraft): Promise<ServerAddResult>;
  /** Remove a row this plugin created. Resolves (never rejects) when `ref` is unknown. */
  remove(ref: string): Promise<ServerRemoval>;
  /** Rows this plugin owns, in list order. Never includes the user's own servers. */
  list(): Promise<ManagedServer[]>;
}

export interface ServerDraft {
  /** Plugin-scoped idempotency key, e.g. a sandbox id. `^[A-Za-z0-9._-]{1,64}$`. */
  ref: string;
  /** Hostname or bracketed IPv6 literal. No scheme, userinfo, port, path or whitespace. */
  host: string;
  /** 1–65535. */
  port: number;
  /** SSH username (for a token-as-username gateway, the token). 1–128 chars, no whitespace. */
  user: string;
  /** One-line hint shown under the row, e.g. the sandbox name. Max 48 chars. */
  note?: string;
  /** Advisory expiry, epoch ms. The host badges the row; it NEVER auto-deletes it. */
  expiresAt?: number;
}

export interface ManagedServer {
  ref: string;
  host: string;
  port: number;
  user: string;
  note: string;
  /** 0 when the row carries no expiry. */
  expiresAt: number;
}

export interface ServerAddResult extends ManagedServer {
  /**
   * `'created'`   — new row; the user approved it.
   * `'updated'`   — existing row changed in place.
   * `'unchanged'` — every field already matched; nothing was written.
   * `'declined'`  — the user dismissed the consent dialog; NOTHING was written.
   */
  status: 'created' | 'updated' | 'unchanged' | 'declined';
}

export interface ServerRemoval {
  removed: boolean;
  /** `'not-found'` — never added, already removed, or the user has since edited/deleted it. */
  reason?: 'not-found';
}

// ── Server recipe ────────────────────────────────────────────────────────────────
export interface RecipeApi {
  /**
   * Run the plugin's recipe (or a single step). The HOST shows a consent dialog listing the
   * EXACT commands before anything executes. Returns captured variables (e.g. an auth URL).
   * `vars` substitutes `{{name}}` placeholders in the recipe.
   */
  run(stepId?: string, vars?: Record<string, string>): Promise<RecipeResult>;
  /** Re-evaluate `check` probes without running anything (idempotency / "is it installed?"). */
  status(): Promise<RecipeStatus>;
}

export interface RecipeResult {
  ok: boolean;
  /** Variables captured by step `capture` regexes (e.g. { authUrl: "https://login..." }). */
  captures: Record<string, string>;
  log: string;
}

export interface RecipeStatus {
  /** Per-step: has the `check` probe already passed (so the step can be skipped)? */
  steps: Array<{ id: string; satisfied: boolean }>;
}

// ── UI ───────────────────────────────────────────────────────────────────────────
export interface UiApi {
  toast(message: string): void;
  setTitle(title: string): void;
  /** Open a URL in the separate, bridge-less service WebView (e.g. code-server, wg-easy). */
  openService(url: string): Promise<void>;
  /**
   * Hand a URL to the phone's default browser instead of the in-app WebView. Use for the
   * client side of a server-backed service — the tunnel (port forward / tailscale-serve)
   * you opened stays alive in the background (Android foreground service / iOS background
   * execution + reconnect) while the user is in the browser.
   * http/https only. Pass the URL from `tunnel.open(...)`.
   */
  openExternal(url: string): Promise<void>;
  /** Close this plugin and return to the host. */
  close(): void;
  /** Host theme tokens so plugin UI matches the app (call once on load). */
  theme(): Promise<Theme>;
}

export interface Theme {
  accent: string;     // CSS color
  background: string;
  surface: string;
  text: string;
  isDark: boolean;
}

export interface NotifyOptions {
  title: string;
  message: string;
  /** Optional ntfy topic to publish to; defaults to the user's configured "agent ping" topic. */
  topic?: string;
}

export {};
