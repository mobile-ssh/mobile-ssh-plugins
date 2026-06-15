# Bridge API (`window.MobileSSH`)

Authoritative, typed source: [`sdk/mobilessh.d.ts`](../sdk/mobilessh.d.ts). The host injects
[`sdk/mobilessh.js`](../sdk/mobilessh.js) before your scripts run, so `window.MobileSSH` is ready.
All async methods return Promises; calls to undeclared capabilities reject.

```ts
MobileSSH.version: string
MobileSSH.session(): Promise<SessionInfo | null>
MobileSSH.hasCapability(cap): Promise<boolean>

MobileSSH.ssh.exec(command, { timeoutMs? }): Promise<{ stdout, stderr, exitCode }>
MobileSSH.ssh.execStream(command, onLine(line, stream), { timeoutMs? }): Promise<{ exitCode }>

MobileSSH.tunnel.open({ port, remoteHost?, backend? }): Promise<TunnelHandle>   // {id,url,scheme,backend,localPort}
MobileSSH.tunnel.close(id): Promise<void>
MobileSSH.tunnel.list(): Promise<TunnelHandle[]>

MobileSSH.http.fetch({ url, method?, headers?, body?, stream?, timeoutMs? }, onChunk?): Promise<{ status, headers, body }>

MobileSSH.storage.get(key) / put(key,value) / putSecret(key,value) / getSecret(key) / remove(key)

MobileSSH.recipe.run(stepId?, vars?): Promise<{ ok, captures, log }>   // host shows consent
MobileSSH.recipe.status(): Promise<{ steps: [{ id, satisfied }] }>

MobileSSH.ui.toast(msg) / setTitle(title) / openService(url) / openExternal(url) / close() / theme()
//   openService  → in-app, bridge-less WebView   |   openExternal → the phone's default browser (http/https)
MobileSSH.notify({ title, message, topic? }): Promise<void>
MobileSSH.log(level, message)
```

## Versioning & compatibility

`MobileSSH.version` is the host's bridge semver. Declare the lowest you need as `minBridgeVersion`.
Host adds methods → MINOR bump (old plugins keep working). Host changes/removes a method → MAJOR bump
(host refuses plugins whose `minBridgeVersion` major exceeds its own).

## Streaming

`ssh.execStream` and `http.fetch({stream:true}, onChunk)` deliver data incrementally — used for live
install logs, captured auth URLs, and LLM token streams (SSE). Under the hood the shim registers a
stream consumer keyed by an id and the host emits chunks until the call resolves.

## Host platforms

`sdk/mobilessh.js` is the single shared shim every host injects byte-for-byte; the stable native
boundary it sits on is tiny: a synchronous `window.__MobileSSHNative.invoke(method, argsJson) →
requestId`, plus host→JS callbacks `window.__mobileSSH._resolve(requestId, errorOrNull, resultJson)`
and `_emit(streamId, chunkJson)`. Any host that provides that boundary runs the same plugins:

- **Android** exposes `__MobileSSHNative` directly as an `@JavascriptInterface` and calls back via
  `evaluateJavascript`.
- **iOS** has no synchronous JS→native return, so it injects a tiny JS native-stub (also at
  document-start, before the shim) that defines `__MobileSSHNative.invoke` — it generates the
  `requestId` in JS, posts `{method, argsJson, requestId}` to a `WKScriptMessageHandler`, and returns
  the id synchronously; the host then drives `_resolve`/`_emit` via `evaluateJavaScript`. The shim is
  unchanged. (This mirrors the mock in [testing.md](testing.md).)

## Local development

Stub the native layer before loading the shim — see [testing.md](testing.md).
