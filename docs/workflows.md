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
From bridge 1.5.0 the re-entered values must be the ones the reference held
(the host keeps a salted fingerprint beside it), and no saved account is
offered there. Other values end that intent unsent: its worker gets an `error`
event with code `CREDENTIAL_CHANGED` (the intent keeps it as its result, so a
create stays unsettled). Credentials the worker then asks for get a reference
of their own.
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

Bridge 1.5.0 adds `workflows.remove({deploymentIds})` (1 to 50 deployment ids).
It clears finished deployments from this phone's journal after one native
confirmation: their jobs and pinned bundle copies. Cloud account credentials,
VPN profiles and saved servers always stay; only the removed deployments' own
approvals, SSH keys and client configurations that no remaining job uses are
forgotten. Nothing changes in the cloud. A deployment is removable only when
every job ended (`SUCCEEDED`, `FAILED` or `CANCELLED`) holding at most an
`input` step, no owned resource receipt is undeleted, no create is unsettled,
no job since its last finished delete may have sent a create (a cloud request
in its journal that is neither a read nor a removal, or a stop in or after
creating), and no VPN of it still exists (a finished setup with no later
deletion). A create is settled by its own 2xx answer, or by a read the worker
names for it in a job state's `reconciled` map (the create's step id to the
read's): read-only, on the create's origin with a path equal to, under or
above the create's, written after the create was last sent, and answered 2xx,
404 or Lightsail's `NotFoundException`; a create whose own row holds the
executor's recovery read may name itself. A create sent again under its step id
before anything settled it keeps its earlier row as `<id>#<attempt>`, unsettled
until a read is named for that id. The host does not check which cloud account
a settling read reached (credentials entered again under a reference must be
the ones it held, and others get a new reference): the worker must. A read
named in the state written with the new send counts as one named earlier. A
finished delete settles none, and what a read found needs a receipt like
anything created. A new `delete` job's
`inputs.unresolved` lists the unsettled creates (`id`, `method`, `url`, and
for Lightsail `target`), set by the host only. The host checks again under its
lock once the user accepts. It resolves
`{removed, refused: [{deploymentId, code}]}` with code `WORKFLOW_IN_PROGRESS`,
`VPN_STILL_EXISTS` (a VPN no delete has removed any part of),
`WORKFLOW_RESOURCES_REMAIN` or `WORKFLOW_NOT_FOUND`; when none is removable it
rejects with the first code and shows no dialog, and a declined confirmation
rejects with `INPUT_CANCELLED`.
From the same version a `CANCELLED` or `FAILED` job holding only an `input`
step no longer blocks a new operation on its deployment: creating one drops
that question, and the old job can no longer resume. A job holding any other
step, which may be a request in flight, or a native result its worker has not
read yet, still blocks. Jobs from `list` and `get` carry `blocking` (whether
the job blocks a new operation now) and `superseded` (a newer operation
replaced it). A lifecycle job starts
from the deployment's latest job state, so a delete started after a stopped one
sees which resources that one already removed. Check `MobileSSH.version` before
offering either. From the same version a refused cloud response keeps the
provider's own `error.code` when it is a lowercase identifier
(`^[a-z][a-z0-9_]{0,39}$`, such as Hetzner's `resource_in_use`):
`{code: 'CLOUD_HTTP_ERROR', error: {code}}`. Older hosts send `{code}` alone. A
Scaleway power-off counts as a removal, like a `DELETE`.

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

VPN Setup 1.0.4 uses both from bridge 1.5.0: **Remove from list** for an entry
that holds nothing, and one action that stops and removes every setup that
created nothing. **Delete VPN** starts a new delete for a delete that stopped
part-way, a setup whose own cleanup did, or a stopped setup that holds or may
have made cloud resources, on any bridge once nothing blocks (from 1.5.0 also
over a stopped job's question). That new delete skips receipts already marked
deleted, treats HTTP 404 as already gone, and retries Hetzner's
`resource_in_use`, `locked` and `conflict` answers within the polling limit. A
host before 1.5.0 replaces every refused body with `{code: 'CLOUD_HTTP_ERROR'}`,
which Hetzner refusals that never clear (delete protection, a firewall applied
elsewhere) also give: a Hetzner HTTP 422, 409 or 423 with only that code, on a
deletion other than the primary IPv4's, is sent again for about three minutes,
then pauses naming those causes and the console. A refused or interrupted
deletion's recovery reads the cloud first by default and sends again only what
is still there and not already going, so a removal the provider took (a
Lightsail detach, a Scaleway power-off) is not sent twice. A receipt with no
deletion of its own (a firewall rule, a server's ports or network interface,
an Azure group's resources) is marked deleted with what holds it. Its worker
drops the stopped job's progress fields, such as `interruptedPhase`, `httpStage`
and `creationAbsent`, so its own recovery never offers a recreation, and
requeues Scaleway disks an earlier delete left after their server went. Each
create it sends sets `creationSent`, and `unanswered` maps the create's step id
to its resource until a 2xx answer or a lookup settles it; the lookup's step id
goes to `reconciled`. Before a delete (or a setup's own cleanup) removes
anything, it looks up each unsettled create, and each one the host lists in
`inputs.unresolved`, by the deployment's name: what it finds gets a receipt
and is deleted with the rest. A listed create its own note already names keeps
that resource; an older version's is matched by its request, and between
resources made by the same request (GCP, Vultr and Scaleway firewall rules) by
the graph position in its step id. A Scaleway power-on counts as made once its
server is anything but stopped, so a server still starting is powered off
before its deletion. A DigitalOcean reserved IP is named nowhere: absent from
the lookup, it counts as not made while no reserved IP in its region is
unassigned, since one whose Droplet went is unassigned too, or once a read
shows that the Droplet its create named still exists (an IP that create made
would be assigned to it) and none unassigned there is `locked`, as a new IP is
while DigitalOcean assigns it. The executor's recovery read, sent in place of a
lost answer, never reads that Droplet: it pauses, and a later reconcile does. A
lookup that finds another resource than the receipt held for it keeps that
receipt as a spare (key `<key>~<id>`), which is deleted after the rest, or
found gone, so the host's ledger sees it go. So does the read after a create
whose answer gave another id. Google Cloud answers an insert with an Operation,
so its network and address receipts take the Operation's `targetId`, the id
their read gives (the name, for one with none, which its read then keeps as a
spare). VPN Setup 1.0.3 and older took the Operation's own id, and the host's
ledger keeps a row for it. A delete of a setup they stopped before that read
deletes the resource by name under that id, so the row goes. Once their read
replaced it, no state names that id again and nothing the worker can read gives
it back: its row stays `created`, and the host refuses to remove that entry
(`WORKFLOW_RESOURCES_REMAIN`) even after a clean delete. A listed create whose
URL matches no current request, because an older version sent it before new
settings changed a setting that URL holds (the AWS or Oracle Cloud region, the
Google Cloud project, region or zone, the Azure subscription, the Scaleway
zone, or the OVHcloud project or endpoint), is looked up where it went once
everything else is deleted: the lookup's URL gets the same change (and a
Lightsail lookup is signed for that region). Not found there, that lookup
settles it alone; found, or not readable there, the delete pauses naming where
to check. A Scaleway project or Oracle Cloud compartment is sent in the body,
not the URL: after only such a change the create still matches the current
request, and its lookup, which filters by the current project or compartment,
may not see what it made. A setup's recovery
refuses new settings while a create is unsettled, since its create would go out
again under the same step id; a delete's recovery, or a setup's once its own
cleanup began, offers neither new settings nor a new creation attempt. Each
setup notes the credential reference its first create used (`cloudRef`). After
the user picks other credentials in a recovery, an answer that something is not
there (HTTP 404, Lightsail's `NotFoundException`, an empty lookup) settles or
deletes nothing until those credentials found one of the deployment's
resources: it reads another resource the deployment holds first, and pauses
when there is none or it is not there. That pause offers `sameAccount`
("These credentials are for the same account"), which asks again
(`sameAccountConfirmed` or `back`) before they count as the deployment's own.
A create refused with HTTP 401 or 403 made nothing: when it is the only create
sent and the deployment holds nothing, `cloudRef` is cleared. The page reads
these notes along with the phases
a setup's or delete's own recovery leaves (`interruptedPhase`,
`suspendedPhase`, `accountResumePhase`) before calling a stopped setup's create
harmless; other operations' copies of those phases from older versions are
ignored. From bridge 1.5.0, an operation stopped at its approval leaves its
VPN to manage. A delete that stopped before it removed anything, of a setup
that never reached its server (no host to manage), offers **Delete VPN** again
while that setup holds or may have made cloud resources.

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
