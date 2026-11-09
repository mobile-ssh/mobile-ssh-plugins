# Native workflows (bridge 1.3.0)

A standalone plugin declares `WORKFLOWS` and
`"workflow": {"version": 1, "worker": "worker.js"}`. Android pins a private copy
of the verified bundle for each job. The UI can disappear without discarding
the operation. Hosts without bridge 1.3.0 must refuse installation or launch.

The worker defines `MobileSSHWorkflow.next(state, event)` and returns
`{state, step}`. It runs in an isolated JavaScript engine without DOM, HTTP,
credential access, or timers. State and pending intents are encrypted in a
native SQLite journal. Each step has a stable `id` and a `kind`:

| Kind | Native behavior |
| --- | --- |
| `input` | Persist a versioned question. Native credential, SSH key and approval forms cannot be answered by JavaScript or voice. |
| `http` | Bind an opaque credential reference to an allowed provider origin and perform a bounded, nonredirecting request. |
| `ssh` | Use native SSH trust/authentication and stream secrets over stdin to the pinned installer. |
| `vpn.import` | Import a vaulted WireGuard configuration under the plugin/deployment/client identity. |
| `vpn.remove`, `vpn.cleanup` | Remove owned profiles; cleanup also removes the managed server and deployment secrets. |
| `delay` | Native, persisted deadline with `delayMs` in 0–60000. |
| `complete`, `fail`, `pause` | Commit a terminal or resumable state. |

The host persists intent before dispatch. On recovery an HTTP mutation must
provide a read-only `reconcile` request; it is not blindly replayed. An ambiguous
match pauses for review. Deletion polls until the provider confirms removal.
Before remote deletion or revocation, Android stops the affected deployment's
active WireGuard profile so removing its server cannot cut off the cleanup
requests. Other deployments and unrelated VPN connections retain their ownership.
Incomplete paginated listings also pause: absence or uniqueness is never inferred
from only one page. Console setup remains available when an account's listing
cannot be reconciled completely.
Cancellation preserves any uncertain intent; resume reconciles it before another
job can operate on that deployment. Stopping is not cloud resource deletion.

Events are `start`, `input` (`value` and `stepId`), `result` (`result` and
`stepId`), `resume`, `cancel`, or a sanitized `error`. Input requests carry
`fields` with `key`, `label`, `type`, `required`, optional `default` and `options`.
`credential`, `sshKey`, and `confirm` forms are protected native controls.
Credential answers contain only `credentialRef` and public metadata. SSH key
answers contain the reference and public key. Native approval is bound to the
job, operation, deployment and bundle digest. HTTP mutations, bootstrap/client
changes, and profile writes require it.

Use `MobileSSH.workflows.create/list/get/answer/resume/cancel/review` and
`subscribe` for UI. Answers require the current revision and request ID.
`review` can also re-enter a lost cloud credential on a paused HTTP intent.
`openVpn` opens native profiles/Android consent; `export` opens native file/QR
review without returning config text; `openAdmin` opens a native SSH loopback
tunnel and a service WebView without a plugin bridge. `forgetCredential` removes
the selected account secret. Type signatures are in `sdk/mobilessh.d.ts`.

The VPN Setup bundle implements ten provider adapters plus an existing-server
path. Its fixtures validate transitions, recovery, deletion and installer
contracts without paid cloud access. They do not establish that an account's
current IAM permissions, quota or regional capacity permit creation. Run real
account/phone acceptance before distribution, including interrupted operations,
resource cleanup, WireGuard consent/handshake, DNS and traffic routing.

Live acceptance on 2026-11-09 exercised Hetzner CPX12 in `fsn1`, Ubuntu 24.04,
and the pinned wg-easy 15.4.0 image from the actual plugin UI on an isolated
Android API 35 emulator. A fresh uninterrupted run passed native token/key and
spending forms, SSH trust, provisioning, profile import, WireGuard handshake,
IPv4 HTTPS egress and DNS, health, client creation/revocation, private admin
authentication, and deletion while the owned VPN was connected. IP cleanup
waited for detachment and completed without a recovery prompt. Independent
provider reads confirmed the VM, Primary IPv4, firewall and SSH key all returned
404 and no resources remained under the deployment label. The test resources
were removed. Other cloud adapters and physical-phone acceptance still require
their own live runs; this IPv4-only server does not provide IPv6 internet egress.
