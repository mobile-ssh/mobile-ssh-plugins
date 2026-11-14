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
Lifecycle operations on a finished deployment are `health`, `createClient`,
`revokeClient`, `delete` and, from bridge 1.4.0, `update`; check
`MobileSSH.version` (compare its parts as numbers) before offering `update`,
since older hosts refuse it. An `update` job runs only `ssh` steps with
operation `update` or `health`; the host fails any other step in it, so
cleanup or deletion needs its own `delete` job and approval. A failed `update`
step reaches the worker as an `error` event whose `code` is
`UPDATE_NOT_DOWNLOADED` (nothing changed), `UPDATE_ROLLED_BACK` (the previous
version runs again) or `UPDATE_RESTORE_FAILED` (the rollback failed too, so the
server's VPN is down); every other failure stays `operation_interrupted`.

VPN Setup's `update` asks for native approval, then runs the pinned installer's
`update`: it downloads the pinned wg-easy image before changing anything, notes
the clients' ids and public keys, stops the container, copies its data
directory (wg-easy migrates its database on start), starts the new version and
verifies its API, `wg0` and the same clients. If the new version does not pass,
it restores the copy and the previous version, which must list the same
clients. The copy is never restored after the data may have changed since it
was taken: a copy left by an interrupted update is reused only while the data
is still byte-identical to it, or to finish a rollback interrupted after it
stopped the new version, which has not run since. Any other leftover copy is
discarded unused, as is any copy once a client is added or revoked, so a
rollback can never bring back a revoked client. Both its result and `health`'s
include `version` (the running wg-easy x.y.z, when known) and `current`
(whether it runs the pinned image); `update` also reports `updated`. Clients,
keys and imported VPN profiles are kept. A phone connected through the server
has its tunnel to it stopped before the session opens and reconnects by hand.
Its recovery offers a read-only check, an explicit retry, or stopping.

VPN Setup checks the chosen offering with read-only requests before asking for
approval. A check that fails on a successful response pauses with a short
reason that names the setting, for example `Server type cx23 is sold out in
fsn1 right now. Locations with it: nbg1, hel1.` (Hetzner's
`server_types[].locations[].available`, from 2026-04-01) or `Droplet size
s-1vcpu-1gb isn't offered in nyc3. Regions with it: …` (DigitalOcean's
`sizes[].available` and `regions`). Provider values enter a reason only when
they look like identifiers, eight at most, and response text never does; a
refused request reports its HTTP status with the one fixed code the native host
puts in place of every refused body (`CLOUD_HTTP_ERROR`), never the provider's
own code or text. Because nothing has been created yet, that recovery question,
titled "Check the server settings", offers `edit` (every setting is asked again
with its current value), `retry` (repeats the failed check), `account` (new
credentials, then every check again) and `keep` (stops the setup); it never
offers reconciliation, cleanup or recreation. `edit` is the default, except
after HTTP 401 or 403 (`account`) and 429 or 5xx (`retry`). Failures after a
resource exists keep those. Every VPN Setup recovery question also carries its
reason as `message`, which the native review shows in place of the title,
beside `error`. A setting that could not be used (empty, a space, or not an
IPv4 CIDR for the SSH source) is asked again at once with its reason as
`message` and `error`; it never stops the setup.

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

VPN Setup 1.0.2 and later pin wg-easy 15.5.0
(`ghcr.io/wg-easy/wg-easy:15.5.0@sha256:071f79a639e9361123a5e57733107320207b844ddbbd92dfa6962f541fe8aac8`).
The live acceptance above used 15.4.0; 15.5.0 and the `update` operation have
not had a live cloud run. On 2026-11-12 a local harness called the installer's
operations as root against the real 15.4.0 and 15.5.0 images, with only
systemd, module loading, apt and the public-address check stubbed: on local
Docker (Engine 29.6.2, Compose 5.3.1, Python 3.12.16), and in an isolated
Ubuntu 24.04.4 container with its packaged `docker.io` 29.1.3,
`docker-compose-v2` 2.40.3 and Python 3.12.3, which is what setup installs.
Every check passed in both. VPN Setup 1.0.1's installer set up 15.4.0 with two
clients and 1.0.2's updated it to 15.5.0: both clients kept their ids and
names, the first one's configuration was identical in every field, keys
included, and wg-easy no longer reported an update. That client and one added
after the update completed a WireGuard handshake and pinged the server through
15.5.0 from a container on the deployment's Docker network. Revoking the second
client then left exactly the two enabled peers on `wg0`. A second update left
the running container untouched. Another image, and a pin that could not be
downloaded, were refused without changing anything. When the harness failed
15.5.0's verification after it had migrated the database, 15.4.0 came back on
its unmigrated copy with the same clients and a working tunnel, and a later
retry succeeded. When it also failed the restored version's verification, the
copy was kept until deletion removed it. An update stopped after taking its copy
resumed from that copy, and a stopped current container was started again. Each
failure returned its fixed error code. A fresh 15.5.0 install also passed.
VPN Setup 1.0.3's installer, which never restores a copy the data has moved on
from, passed the same local Docker run.
