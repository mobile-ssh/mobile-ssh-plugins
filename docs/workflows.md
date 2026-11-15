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

A `confirm` step carries `summary`, an object describing what is approved,
and `destructive: true` for a deletion or revocation. It may also carry
`review`, a readable layout of the same approval in plain text the plugin
writes (English), which hosts that know it lay out as a page; others show
`summary` as before, so a plugin keeps `summary` complete and needs no newer
`minBridgeVersion` to send both:

```ts
review: {
  heading?: string;                    // at most 120
  sections: Array<{                    // 1 to 8
    title: string;                     // at most 60
    rows: Array<{                      // 1 to 12
      label: string;                   // at most 40
      value: string;                   // at most 300
      note?: string;                   // at most 160
      tone?: 'normal' | 'warning' | 'muted';
    }>;
  }>;
  notes?: Array<{text: string; tone?: 'info' | 'warning' | 'danger'}>;  // at most 4, text at most 300
  links?: Array<{label: string; url: string}>;  // at most 2, label at most 60, an https URL of at most 300
}
```

Lengths count UTF-16 units (Java and JavaScript string length). Text is plain,
with no markup; a host strips control and format characters (bidi marks among
them) and renders `review` only when every part fits these types, counts,
lengths and tones and each link is `https`, otherwise it lays out `summary`
itself. The host keeps its own title, framing text and buttons (a `destructive`
step reads as a removal whatever its review says) and keeps the exact
`summary` reachable, so nothing a review leaves out is hidden.

Mobile SSH for Android also refuses, and lays out `summary` instead of, a
review that:

- holds more than 40 rows or 8000 characters in all (one within every count
  above could still fill many screens);
- has a text that is empty once it is put on one line without control and
  format characters;
- gives a tone other than one of those listed, in lower case (a tone left out
  is the default, `normal` for a row and `info` for a note, and the default may
  also be given);
- has a link that is not printable ASCII, has no host of letters, digits, dots
  and hyphens, or has a user part (`https://bank.example@host/`). A port, path
  and query are fine; the dialog shows the link's label and its host.

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

From VPN Setup 1.0.5 a Hetzner automatic setup reads the account's catalog in
a `catalog` phase after the API key and SSH key, and again each time the
settings are asked (**Change server settings**, other credentials), before
the settings questions: read-only `GET`s through the same native `http` step
as the checks, `/v1/server_types?per_page=50&page=N` and
`/v1/locations?per_page=50&page=N` (following `meta.pagination.next_page` in
order, four pages at most), then `/v1/pricing` for the prices' currency and
the primary IPv4's price. Their step ids are
`<deploymentId>-catalog-<list>-<page>`; a refresh sends the same ids again.
The state keeps only a compact `catalog` (per x86 type its name, cores,
memory and, per location where `server_types[].locations[]` says
`available: true` with no `deprecation`, the monthly gross price and
`recommended`; a type's own deprecated `deprecation` is not used, since
Hetzner retires types per location; prices are decimal strings, the gross
with 16 decimals; the locations that list one, with city and country) until the
questions are answered. Location and server type are then asked as
single-field `select`s: the native review shows a dropdown and the voice a
choice, whose ids are Hetzner's own names, so the checks, the create request
and deletion are unchanged. The suggestion is the cheapest orderable type and
its location (Hetzner's `recommended` breaks equal prices); an earlier answer
still listed stays selected. The selected option is always listed first (the
voice maps a plain "yes" to the first choice), and labels are short, name and
suggestion and price first, since the native dropdown cuts each to one line.
Each list's last option, value `(other)`, asks the same field again as a typed
`string` (default: the earlier answer or the usual one, or the suggestion when
the catalog lists that type as not orderable in the chosen location), titled
with what to say or type, which `settingProblem` and the read-only checks
alone judge. A value typed after Other, or one other than the default where
the catalog lists nothing, is kept in `custom` and offered, as `<value>
(entered before)`, when the settings are asked again: selected, unless the
catalog lists that type but not in the chosen location (`(entered before, not
available here)`). Each question has a `message` that starts with its title,
so the review no longer shows the label twice. Any refused, cut-off or unexpected catalog answer (HTTP 401, 403,
429, 5xx, not a list, nothing orderable) ends the reads and leaves the
questions typed as in 1.0.4: the catalog never pauses a setup, except for
`CREDENTIAL_CHANGED` (other credentials entered for a read), which pauses
with its usual reason; **Update cloud account credentials** then reads the
catalog again with them. A network
failure on one of its reads pauses the job natively, as any read does, and
**Resume** sends it again. Jobs keep the bundle they started with, so a 1.0.4
job continues with 1.0.4; a new operation started from a 1.0.5 setup drops
`catalog`, `catalogRead`, `typing` and `custom`.

From VPN Setup 1.0.6 Vultr, Akamai/Linode, DigitalOcean and AWS Lightsail
list their settings the same way, with lookups sent inside the settings
questions, each just before the question it feeds (once the questions before
it are answered), in the `catalog` phase with step ids
`<deploymentId>-catalog-<lookup>-<page>`. Every one is a read-only native
`http` step on a host the provider's credential already reaches: a `GET`, or
for Lightsail a signed `POST` whose `X-Amz-Target` is a `Get*` action with
`readOnly: true`, so none asks for approval. The state keeps
`catalog.read.<lookup>`, a compact projection (`{value,label}`-sized entries,
never a provider body) or `null` when the lookup was refused, odd or skipped,
until the questions are answered:

- Vultr: `/v2/regions?per_page=500` and `/v2/plans?per_page=500` before
  Region; `/v2/regions/<region>/availability` and the plans again before Plan;
  `/v2/os?per_page=500` before the OS ID. Regions with a plan that fits; plans
  the region lists as available now, not VPC-only, not IPv6-only (`-v6`), with
  at least 1 GB, no GPU, at the region's own price. When exactly one OS is
  Ubuntu 24.04 x64 (the checks' own test) its ID is filled in without asking;
  several are a list, newest first. All four are public routes.
- Linode: `/v4/regions?page_size=500` before Region (status `ok`, not a
  distributed site, with Linodes, Metadata and Cloud Firewall);
  `/v4/regions/<region>/availability` (a bare list, the sold-out signal) and
  `/v4/linode/types?page_size=500` before Plan, at the region's own price.
- DigitalOcean: `/v2/sizes?per_page=200`, `/v2/images/ubuntu-24-04-x64` and
  `/v2/regions?per_page=200` before Region (available regions with the
  metadata service cloud-init needs, where any region names it, and the image);
  the sizes again before Droplet size (available, in the region's own list, at
  least 1 GB and the image's minimum disk, no GPU).
- Lightsail: `GetRegions` at `us-east-1` before Region; `GetRegions` with
  availability zones at the chosen region before Availability zone (zones
  `available` there); `GetBundles` there before Lightsail bundle (`pageToken`,
  three pages at most; active Linux bundles with a public IPv4 address, no
  `_ipv6_` bundle, at least 1 GB). A region typed after Other is never put in
  a Lightsail host name: its zone and bundle are typed.

Sizes are listed cheapest first, twelve at most, labelled `<id> · <price>
USD/mo · <n> vCPU, <g> GB RAM`; regions by name (Lightsail's by continent),
`<id> · <place>`. The suggestion is the cheapest size (the usual one when a
list was cut short, which then claims no order), and the region where the
cheapest size costs least (Vultr, DigitalOcean), the usual one at equal
prices or with none known. Other, `custom`,
`(entered before)` and `(entered before, not available here)` (a value the
lookup knows but cannot be ordered there: a plan sold out in that region, a
zone of another region, an OS that is not Ubuntu 24.04) behave as for
Hetzner. HTTP 429 or 5xx gets one retry after a `delay` step (the
`retry-after` header's seconds, 2 s without one, 10 s at most), step id
`...-wait`, then `...-again`. Any other refusal, an odd body, an empty list or
a lookup built on one that failed leaves the questions it feeds typed with
their usual defaults, never a pause, except `CREDENTIAL_CHANGED` as above.
The page counts a setup stopped on a Lightsail `Get*` request (a lookup or a
check, `readOnly: true`) as having created nothing, as the native host does;
before 1.0.6 any pending `POST` counted as a create that may have gone out.

OVHcloud and Scaleway list their settings the same way from 1.0.6:

- OVHcloud now asks `endpoint` (the API account region, a fixed `select` of
  `eu`, `ca` and `us` with no Other, its selected answer listed first) before
  `projectId`, since every request goes to that host. Then
  `/v2/publicCloud/project` before the project (`X-Pagination-Size: 100`,
  following `x-pagination-cursor-next` as `X-Pagination-Cursor`, five pages at
  most; `READY` projects, one in `DISCOVERY` mode listed but never suggested),
  or, with that refused or failing, v1 `/1.0/cloud/project` (IDs only);
  `/v2/publicCloud/project/<id>/reference/region` before Cloud region
  (`REGION-1-AZ`, `ENABLED`, `activated`: the create names no availability
  zone), or v1 `/1.0/cloud/project/<id>/region` by name when v2 lists none;
  `/1.0/cloud/project/<id>/flavor?region=<r>` before the flavor (the checks'
  own list: Linux, `available`, plain `<family><n>-<n>` names, no GPU, IOPS or
  bare metal; value the flavor UUID, label its name; one with `quota: 0` marked
  and never suggested); and `/1.0/cloud/project/<id>/image?osType=linux&region=<r>`
  before the image (active public `Ubuntu 24.04`, for the flavor's type when an
  image names one, newest first, two at most), filled in when there is one.
  Prices come from a static table of OVHcloud's public catalog (2026-11-14,
  hourly × 730 without tax, EUR, CAD or USD by API site), shown as `~<price>`:
  the catalog itself is about 8 MB, over the phone's 4 MiB response cap. A
  flavor without a known price is listed after the priced ones and never
  suggested. v1 lists are whole arrays and are not judged by `incompleteList`.
- Scaleway: `/account/v3/projects?page_size=100&order_by=name_asc` before the
  project (`&page=N` while `total_count` says more; the one named `default`
  suggested); the zones are a fixed list with Other (no API lists them). Before
  the commercial type, for the chosen zone: the marketplace's `ubuntu_noble`
  x86_64 local images, then `products/servers` and
  `products/servers/availability` (`per_page=100&page=N` while `x-total-count`
  says more, five pages at most; the answers are maps). Listed: x86_64, not
  `end_of_service`, no GPU or `-WIN`, at least 1 GiB, a local (`l_ssd`) volume,
  and an `instance_local` Ubuntu image that names the type, since the create
  sends no volumes and cleanup deletes Instance-API volumes only, so a Block
  Storage root would be left behind. `shortage` is left out (and is "not
  available here" for a value entered before, as is `end_of_service`),
  `scarce` or missing is marked low stock and never suggested. Prices are
  `hourly_price` × 730 EUR. The image is filled in from the local image that
  names the chosen type. The read-only check "Instance type" now asks
  `products/servers?per_page=100&page=N` and, when the type is not on that page
  while `x-total-count` says more, the next page under step id
  `<deploymentId>-preflight-<index>-<page>` (`preflightPage` in the state,
  five pages at most); before, only the first 50 types were read.

A job keeps the bundle it started with, so a 1.0.5 OVHcloud job paused inside
the settings questions keeps 1.0.5's question order; a new operation started
from a 1.0.6 setup drops `preflightPage` with the other per-job keys.

Questions name the zone as `{where}` for Scaleway (the region elsewhere). An
entry's `name` (shown in place of an opaque id), `note` (said last) and `hold`
(listed, never suggested) apply to any provider's list; when the suggestion is
not the cheapest listed, the message says "the suggested one first, then
cheapest first".

Google Cloud, Azure and Oracle Cloud list their settings the same way from
1.0.6 (every provider now does):

- Google Cloud: `cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState%3AACTIVE&pageSize=50`
  before the project (`pageToken` from `nextPageToken`, three pages at most;
  `ACTIVE`, labelled `<id> · <name>`). It needs the Cloud Resource Manager API
  in the key's project, which the guide makes optional: refused, the project is
  typed. Then `compute/v1/projects/<p>/zones?maxResults=500&fields=...` before
  Region, which serves the Region and Zone questions both: zones `UP` and not
  deprecated, grouped by the region they name (`us-*` first, labelled with
  the region's short name from a static table; the Zone question lists only the
  chosen region's zones). Then `zones/<z>/machineTypes?maxResults=500&fields=...`
  before Machine type (three pages at most): x86 (no `ARM64`, `t2a`, `c4a`,
  `n4a`, `a4x`), no accelerators, not deprecated, families `e2`, `n1`, `n2`,
  `n2d`, `t2d` (the create names no disk type, and these boot from
  pd-standard), not custom, 1 to 16 GB, at most 4 vCPU. The phone cannot reach
  Cloud Billing, so they carry no price: they are ordered by a static rank of
  us-central1 list prices (`e2-micro`, `e2-small`, `e2-medium`,
  `t2d-standard-1`, `n1-standard-1`, `e2-standard-2`, `n2d-standard-2`,
  `n2-standard-2`; others by memory, then vCPU), marked `shared core` where
  `isSharedCpu`, and `e2-micro` is suggested. Typed, the default stays
  `e2-small`.
- Azure: `management.azure.com/subscriptions?api-version=2022-12-01` before the
  subscription (its `nextLink` followed on that host only, three pages at
  most; `Enabled` ones by display name, two of the same name told apart by
  their ID's first 8 characters); `subscriptions/<s>/locations` before Region
  (`Physical`, type `Region`, category `Recommended` then `Other`, US ones first
  in each; `Other` ones listed, never suggested and marked `may need
  approval`, as some need an access request); the checks' own `.../locations/<r>/vmSizes?api-version=2024-07-01`
  before VM size. The VM-size list says nothing of architecture or Hyper-V
  generation, so only twelve sizes known to boot the x64 Gen2 image on a
  Standard SSD are listed, at least 1 GB, in East US list-price order with no
  price shown: `Standard_B2ats_v2` (suggested), `B2ts_v2`, `B1s`, `B1ms`,
  `B2als_v2`, `B2ls_v2`, `B2s`, `B2as_v2`, `B2s_v2`, `B2ms`, `D2as_v5`,
  `D2s_v5`. Typed, the default stays `Standard_B1s`.
- Oracle Cloud: the credential answer's public `tenancyId` (also under
  `public`) is kept as `tenancyId` in the state, and the compartment question
  offers it as "Root compartment"; a new operation drops it. Its identity host
  (subscribed regions, compartments, availability domains) is not one the key
  may reach, so the regions are a static list of the 44 commercial (oc1)
  regions in Oracle's public regions table (2026-11-14; not `ap-delhi-1` or
  `us-saltlake-2`), of which the list shows 23 main ones. Every lookup goes to `iaas.<region>.oraclecloud.com`, so only for a
  listed region (a typed one goes into no host name), paged by `opc-next-page`
  (sent back as `page`, five pages at most):
  `computeCapacityReservationInstanceShapes?limit=100&compartmentId=<c>` before
  the availability domain (the domains it names, labelled without the tenancy
  prefix, the first where `VM.Standard.E4.Flex` is listed suggested; it needs
  `inspect compute-capacity-reservations`, else 404 and the domain is typed);
  `shapes?availabilityDomain=<ad>&limit=100&compartmentId=<c>` before the
  shape (Flex `VM.` shapes allowing 1 OCPU and 2 GB, as the create's fixed
  `shapeConfig` asks, no GPU or local disks, x86 only; priced from a static
  table of Oracle's list prices for that size in USD, shown as `~`, labelled
  `<shape> · ~<price> USD/mo` since every one gets the same size;
  `VM.Standard.E4.Flex` first among equal prices); and
  `images?operatingSystem=Canonical%20Ubuntu&operatingSystemVersion=24.04&shape=<s>&lifecycleState=AVAILABLE&sortBy=TIMECREATED&sortOrder=DESC&limit=50&compartmentId=<c>`
  before the image: Canonical's `Canonical-Ubuntu-24.04[-Minimal][-aarch64]-<date>-<n>`
  builds for the shape's architecture (aarch64 only for an Arm shape typed
  after Other), the newest full build (else the newest Minimal) filled in.

Review fixes in 1.0.6, for every provider with lookups:

- The app's voice offers at most 26 choices. A list of other than sizes with
  more than 23 entries keeps 23: the provider's main regions (a static list
  per provider for Vultr, Linode, Oracle Cloud, Azure, Google Cloud and
  OVHcloud), then the first as listed; with the earlier or entered-before
  answer, the suggestion and Other it stays within 26.
- A region list read keeps, for the earlier, typed-before and usual regions
  only, those the provider names but leaves out (DigitalOcean's `available:
  false`, a Linode outage, a Vultr region with no plan that fits, an Azure
  logical region, an OVHcloud region not activated, a Google Cloud region with
  no zone up): one entered before is then "not available here", not selected,
  and after Other the suggestion is filled in.
- Typed after an answer that rules out the usual default, a question is
  prefilled from that answer: a Lightsail zone `<region>a` and a Google Cloud
  zone `<region>-a` unless the earlier zone is of that region, and an OVHcloud
  region on the CA or US API site that site's (`BHS5`, `US-EAST-VA-1`).
- Vultr lists only plans whose `storage_type` names local storage
  (`local_storage`, `local_and_block_storage`): a VX1 plan on Block Storage
  alone needs a `block_devices` boot volume the create does not send. The
  check "Instance plan" refuses one typed after Other.
- Lightsail marks the opt-in regions `ap-east-1`, `ap-southeast-3`,
  `ap-southeast-5` and `eu-south-2` (`must be enabled first`), lists them last
  and never suggests them. A 4xx answer to the zone lookup in one of them asks
  the region again, the usual one selected, with the reason as the question's
  error (`invalid_setting`); it never pauses.
- Account lists (projects, subscriptions, the compartment) select the first
  by name without the `(suggested)` mark, unless the provider marks one
  (Scaleway's `default`); two of the same name show their ID's first 8
  characters (OVHcloud and Scaleway too, as Azure).
- `names` in the state maps a listed or filled-in answer whose value is an ID
  to its name (`{size:'d2-2', imageId:'Ubuntu 24.04 · <date>'}`), shown in the
  review summary as `names` beside `settings`; it is dropped once the review
  is confirmed and by a new operation. An OVHcloud flavor or image entered
  before is labelled by the name the read gives it.

For Google Cloud's machine types and Azure's sizes the list read is the zone's
or region's whole list: an earlier, typed-before or usual value it does not
name is "not available here". A list value may now be any setting value
(`[a-zA-Z0-9_.:-]{1,256}`, for OCIDs). `{zone}` in a question is the zone
answered before. A value typed after Other is kept as entered before even when
nothing was read yet (Oracle Cloud's compartment and region, Scaleway's zone).
The read-only checks now refuse a Google Cloud zone whose name does not start
with the region's, a Google Cloud machine type whose `architecture` is `ARM64`,
an Azure size with a lower-case `p` among its feature letters (Arm), and an
Oracle Cloud shape the domain's list gives as fixed (`isFlexible: false`) or
as not allowing 1 OCPU and 2 GB; before, each failed only at the server's
create, after the network resources were made.

VPN Setup 1.0.7 sends `review` with every confirm step, for every provider and
the user's own server, and keeps `summary` exactly as 1.0.6 sent it:

- A new VPN: "New VPN server on <provider>"; a Server section with each setting
  by its value and what its list said of that very value (`hel1 · Helsinki,
  FI`, `cx23 · 3.80 EUR/mo · 2 vCPU, 4 GB RAM`, Hetzner's public IPv4 price as
  the server type's note; a value that is an ID by its name, the ID itself as
  the note, as an OVHcloud flavor, an Oracle Cloud image or a project), the
  Ubuntu 24.04 the create names, and the server's name; an Access section (SSH
  from any address or only the CIDR, UDP 51820 open to any address, the pinned
  wg-easy release, the VPN profile name the import saves); "Checked with
  <provider>" listing the read-only checks passed; the billing note (and where
  prices are approximate or absent, a note saying so) and the provider's
  pricing link. A typed value shows as typed, with a place the worker knows for
  it (Google Cloud and Oracle Cloud regions, Scaleway zones). A console setup
  or the user's own server shows its address and SSH user, and what still bills.
- A delete: "Will be deleted" lists each owned resource still there by kind
  (Server, Primary IPv4 address, Firewall, SSH key, Disk, ...; a Scaleway
  power-on and a Lightsail attachment are steps, not resources) with its name
  and address, a console setup's VPN on the server, and this phone's profiles;
  "Kept" what was in the account before (and a console setup's server, with
  what to delete in its console); "Already deleted" what an earlier delete
  removed. A danger note says it cannot be undone, and another when unsettled
  creates are looked up first; it names the VPN and its clients only while the
  server is still there, and a lookup's finds when one is due. Past 12 rows, a
  row says how many more the summary holds, and this phone's row stays last.
- A new creation attempt (the resource's name only as its create sends it),
  adding or revoking a client (and whether it is the one this phone's VPN uses)
  and the WireGuard update (with the version the last check found) get short
  reviews of their own. The update's note says only what the app's own update
  text above it does not: clients keep working, and a failed start restores the
  previous version.
- A price or size keeps its number with its unit (`4 GB`, `3.80 EUR/mo`) by a
  no-break space, so a narrow screen never wraps between them.

The words for an answer are kept in the state as `labels`
(`{<key>: [value, name, detail, note]}`), taken from what the answer's list
showed when it is answered or filled in (a value typed after Other too, when
its list knows it), shown only while the setting still holds that value, and
dropped with `names` once the review is approved (a new creation attempt's
too) and by a new operation. A review that cannot be built is left out: the
summary still says it all.

One recovery changed. After a create that got no answer was looked up and not
found, **Change server settings** now forgets that it may be sent again: if the
new questions stopped (a lookup's credentials changed, say), 1.0.6 still offered
**Review a new creation attempt**, which sent the create with the half-changed
settings, without their checks or the setup review. Now the settings are
answered and checked, and reviewed, again. Otherwise nothing changed: random
walks over every provider's lists, checks, creates, deletes and lifecycle
operations, compared transition by transition with 1.0.6, differ only in
`review`, `labels` and that recovery.

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
