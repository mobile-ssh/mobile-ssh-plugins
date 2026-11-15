# VPN Setup

This standalone plugin creates a dedicated Ubuntu 24.04 cloud VM, installs
wg-easy 15.5.0, and imports a WireGuard client directly into Mobile SSH. It can
also install onto a VM created using one of the console guides. The plugin list
and the offline voice assistant use the same native, checkpointed workflow.

The worker is a pure `MobileSSHWorkflow.next(state, event)` function. Cloud
credentials, SSH private keys, administrator passwords, and WireGuard configs
stay in the native executor's encrypted stores. The worker receives credential
references and configuration references. Cloud credentials are never uploaded
to the VM. The Python installer runs only through the protected native SSH path.

The container is pinned to the multiarchitecture image index
`ghcr.io/wg-easy/wg-easy:15.5.0@sha256:071f79a639e9361123a5e57733107320207b844ddbbd92dfa6962f541fe8aac8`
(release v15.5.0 of 2026-10-24; never the legacy `latest` tag). Automatic VM
choices target amd64. Use Ubuntu 24.04 with at least 1 GB RAM and 20 GB storage
for the console path; more RAM makes installation and upgrades less constrained.

## Operation and recovery

1. Choose a provider and API or console setup.
2. Select a saved cloud account or enter its credentials in the native form.
3. Select or generate an SSH key. Lightsail requires RSA.
4. Choose the project, region, plan, image where necessary, and SSH source CIDR.
   The worker checks the selected provider offering using live read-only APIs.
   A failed check says which setting it could not confirm and why, for example
   a server type that is sold out in the chosen location, with the locations
   that have it. Nothing has been created at that point, so its recovery offers
   changing the settings (each asked again with its current value), checking
   again, new cloud account credentials, or stopping; never cloud cleanup.
   A setting that cannot be used, such as a location with a space in it, is
   asked again at once with the reason.
   With Hetzner Cloud (from VPN Setup 1.0.5), the plugin first reads what the
   account can order now, with read-only requests using the API key, and asks
   the location, then the server type, from lists. Locations are listed only
   when a server type can be ordered there now. Server types are listed only
   when they can be ordered in the chosen location now, are x86 and are not
   being retired there, cheapest first with their monthly price, cores and
   memory. The cheapest is suggested and selected, unless an earlier answer can
   still be ordered; the selected answer is listed first, so agreeing by voice
   takes it. Each list ends with **Other (type a value)**, which asks the same
   setting as a text box (by voice, as a typed answer) for any location or
   server type, such as one the list leaves out; the checks then judge it. A
   value typed that way is offered again, as entered before, when the settings
   are asked again (not selected if the list shows it cannot be ordered in that
   location now). **Change server settings** and new credentials read the
   lists again, so what is sold out is current. When the lists cannot be read
   (a refused token, a busy API, an unexpected answer), the questions are typed
   as before, and the checks say what is wrong.
   From VPN Setup 1.0.6, Vultr, Akamai / Linode, DigitalOcean and AWS
   Lightsail ask the same way, with read-only requests sent just before the
   question that needs them: the region (Lightsail: then its availability
   zone), then the plan, size or bundle orderable there now with a public IPv4
   address and at least 1 GB RAM, cheapest first, at that region's own price.
   Vultr's Ubuntu 24.04 OS ID is filled in from Vultr's list when it holds
   exactly one, so it is no longer typed. **Other (type a value)**, values
   entered before, new reads after **Change server settings** or new
   credentials, and typed questions when a list cannot be read all work as
   for Hetzner; a busy API is asked once more after a short wait. A region
   entered before that the fresh list names as unavailable is offered as not
   available here, not selected. Vultr lists only plans with a local boot disk;
   Lightsail marks the opt-in regions an account must enable first, and asks
   the region again if one does not answer. A list of more than 23 regions
   (Vultr, Linode, Oracle Cloud and large Azure or Google Cloud accounts) shows
   the provider's main ones, so a voice answer stays possible (the voice offers
   at most 26 choices); Other reaches the rest. Project and subscription lists
   select the first by name without calling it suggested, and the review shows
   the names of chosen values that are IDs (an OVHcloud flavor, an image).
   OVHcloud asks the API account region (EU, CA or US) first, then lists the
   Public Cloud projects (if the keys may list them), the project's enabled
   regions, the Linux flavors in stock there with OVHcloud's list price (marked
   approximate, as OVHcloud's API gives no prices; the flavor is shown by name),
   and fills in the newest Ubuntu 24.04 image. Scaleway lists the projects (if
   the key may list them), its Instance zones, then the x86 types with a local
   disk in stock in the chosen zone, cheapest first (low stock marked, never
   suggested), and fills in their Ubuntu 24.04 local-disk image. Scaleway's
   checks now read every page of its instance types, so a type further down
   its list (such as PLAY2, PRO2 or STARDUST1) is no longer refused as unknown.
   Google Cloud lists the projects (if the Cloud Resource Manager API is
   enabled), then the regions and the chosen region's zones that are up, then
   the x86 machine types offered in that zone; Azure lists the enabled
   subscriptions, the subscription's regions (Azure's recommended ones first)
   and the x64 sizes the region offers from a list known to boot its Ubuntu
   24.04 image. Neither API gives prices the plugin can read, so these sizes
   show no price and are ordered by list price, the cheapest suggested
   (`e2-micro`, `Standard_B2ats_v2`); typed, the defaults stay `e2-small` and
   `Standard_B1s`. Oracle Cloud offers the tenancy's root compartment (its
   OCID comes with the credentials), Oracle's main commercial regions, the region's
   availability domains (if the policy allows inspecting capacity
   reservations), the x86 Flex shapes that run with 1 OCPU and 2 GB, priced
   from Oracle's list (approximate), and fills in the newest Ubuntu 24.04 image
   for the chosen shape. The checks now also refuse a Google Cloud zone outside
   the region, an Arm Google Cloud machine type or Azure size, and an Oracle
   Cloud shape that cannot run with 1 OCPU and 2 GB, which before failed only
   when the server was created.
5. Review the resources and current provider pricing page. Provisioning begins
   only after native approval. Provider accounts, billing activation, terms,
   capacity and quota approval are completed in the provider's console.
   From VPN Setup 1.0.7, on app versions that support it, the review is a
   readable page rather than raw settings: the provider, the location with its
   city, the server type or plan with its price, cores and memory as the list
   showed them, the image by name, who may connect over SSH, the checks that
   passed, what bills and a link to the provider's prices. A setting shown by
   its name (an OVHcloud flavor, say) has its exact ID beside it.
6. Approve the server's SSH host key using Mobile SSH's trust UI. The app creates
   a saved SSH server, installs wg-easy, and imports its first VPN profile.
7. Connect using the VPN page. A successful import does not by itself establish
   an internet route; check the WireGuard handshake and test internet access.

**Check server**, **Add client**, **Revoke client**, **Update WireGuard**, and
**Delete deployment** operate on the saved deployment; from 1.0.7 their reviews
say what changes, and a deletion lists by kind and name each cloud resource it
deletes, what it keeps and what an earlier deletion removed. With Mobile SSH bridge
1.4.0 or newer, **Check server** also shows the running wg-easy version and
whether an update is available (older hosts drop that information), and
**Update WireGuard** is offered unless the last check found the pinned release
running. It asks for approval, downloads the pinned image before changing
anything, keeps the server keys, clients and VPN profiles, and restarts
WireGuard on the server. If this phone is connected through that server, its
VPN is turned off first; reconnect it when the update finishes. If the new
version does not start, or does not list the same clients, the installer
restores its data copy and the previous version. A failed update says whether
the image could not be downloaded (nothing changed), the previous version was
restored, or the rollback also failed (the server's VPN is down); its recovery
offers a check that changes nothing, a retry, or stopping. An update
interrupted by a reboot can still roll back from the copy it took, but only
while nothing can have changed since; adding or revoking a client discards that
copy, so a rollback never brings back a revoked client. Deployments created by
VPN Setup 1.0.1 or earlier run 15.4.0 until updated. Revoking the client's
server key prevents future use of its configuration. Deletion of API-created servers uses the cloud API even when SSH
is unavailable. Console-created VMs remain the user's cloud resources; the
plugin removes its managed VPN installation, and the console guide explains how
to remove the VM and public IP.

The page lists each deployment once, with its recent operations underneath.
It acts on the deployment's unfinished operation first and offers no new one
until that operation finishes. Opening the page never starts a setup. While a
setup that holds no cloud resource is unfinished, **Set up a VPN** reads
**Continue VPN setup** and opens that setup's question instead of starting
another; **Stop workflow** on it is the way to start over. A setup that may
have sent a create, including one whose recovery then moved on to new
credentials or settings, is not continued that way, and once stopped it reads
"cloud resources may exist", not "nothing created". A setup on a server the
user created in the console, or brought, reads "your server remains" once it
has the server's address. Setups that VPN Setup 1.0.2 or earlier stopped at
their checks keep that version's recovery, so they are not continued either:
the page counts them and, before bridge 1.5.0, says that updating Mobile SSH
clears them. Stopping never removes an entry from the list. The page redraws
only what changed, and a waiting step's reason stays shown beside it.

With Mobile SSH bridge 1.5.0 or newer, **Remove from list** clears an entry
that holds nothing: all its operations ended, none of its cloud resources is
left undeleted, every create it sent got a 2xx answer or was looked up since,
no setup of it since its last finished delete may have sent a create or begun
installing on a server, and its VPN was never finished or has been deleted.
When the app finds more than the page can see, such as a create an older VPN
Setup never looked up, the page offers **Delete VPN** for that entry instead.
The app asks once
for confirmation, checks again itself and removes only this phone's history of
it; nothing changes in the cloud. A line under **Set up a VPN** counts the
setups that created nothing and clears them all with one confirmation, first
stopping those an older VPN Setup left at its checks. A setup on the user's own
server is left out of that line: removing it on its own says that the server
stays and that an SSH key the setup created for it is forgotten. On that bridge an
operation that stopped or failed while only waiting on a question no longer
blocks a new one on its VPN, and one stopped at its approval leaves the VPN to
manage; on older hosts such an operation blocks, as in 1.0.3.

Every resource receipt retains its provider ID, ownership and deletion status.
A lost creation response is reconciled against a stable deployment name;
ambiguous/missing matches pause for review instead of blindly repeating the
creation. Deletions poll until the provider confirms removal. A Hetzner
resource that is still in use or locked just after its server is deleted is
deleted again after a wait, within the same polling limit. A deletion that
pauses shows the provider's error code and a short, capped message. Canceling
a job does not delete resources or stop charges. Resume or review cleanup
afterward. A create that got no 2xx answer is noted until a lookup by the
deployment's name settles it. Before a delete, or a setup's own cleanup,
removes anything, it looks up every such create, including those the app lists
for setups of older VPN Setup versions: what it finds gets a receipt and is
deleted with the rest, and the app checks that lookup before it removes the
entry from its list. A delete, or a setup's own cleanup, that stopped or failed
part-way says how many cloud resources remain and lists each by kind (server,
public IP, firewall, SSH key and so on) as deleted or remaining. Once its
server, public IP or resource group is deleted, the VPN's management is no
longer offered; a delete refused before it removed any of them leaves the VPN
manageable. Phases an older VPN Setup copied into later operations never hide
it. A receipt with no deletion of its own, such as a firewall rule, counts as
deleted with what holds it. **Delete VPN** starts a new delete with the
installed VPN Setup for a delete that stopped part-way, a setup whose cleanup
did, or a stopped setup that holds or may have made cloud resources: on every
bridge once that job ended, and from bridge 1.5.0 also while it still waits on
its question. The new delete takes over from the stopped one: it starts from
the receipts as the stopped job left them, deletes only what remains (a
resource the provider no longer has counts as deleted), retries a Hetzner
resource that is still in use, and removes the VPN profiles and saved server
like any delete. Hetzner's own in-use, locked or conflict code (passed from
bridge 1.5.0) keeps the full polling limit. An older app passes only an opaque
code for a refused answer, as it does for refusals that never clear such as
delete protection, so a Hetzner HTTP 422, 409 or 423 with only that code is
sent again for about three minutes, then pauses naming the likely causes and
the console. A refused or interrupted deletion's recovery checks the cloud
first by default and sends again only what is still there, so a removal the
provider already took, such as a Lightsail detach or a Scaleway power-off, is
not sent twice. A Scaleway server powered on, or still starting, is powered off
before its deletion. A DigitalOcean reserved IP has no name to look up: when an
interrupted request may have made one and its region has an unassigned reserved
IP, the lookup first reads the Droplet that request named. While that Droplet
exists, an IP the request made would be assigned to it, so the unassigned one
is not counted, unless it is still locked: DigitalOcean is then still assigning
an IP, which may be this VPN's. When the Droplet is gone, or the IP is still
locked, it pauses and asks you to check the IP in the console. The check the
app sends in place of an answer lost when it was closed mid-request pauses the
same way, since DigitalOcean may still be assigning the IP then; checking again
later reads the Droplet. When a lookup finds another server or other resource
than the one the VPN's receipt names, for example after you deleted a duplicate
in the console, the delete also deletes the receipt's resource after the rest,
or confirms it gone. A creation an older VPN Setup sent before **Change server
settings** changed a setting in its request's address is looked up where it
went, after the rest of the VPN is deleted: the region for AWS and Oracle
Cloud, the project, region or zone for Google Cloud, the subscription for
Azure, the zone for Scaleway, and the project or API account region for
OVHcloud. If it made something there, or cannot be checked there, the delete
pauses and names where to check in the console, since this VPN's settings no
longer point there. A Scaleway project or Oracle Cloud compartment is not part
of that address: after such a change, a lookup may search only the new project
or compartment, so check the earlier one in the console yourself. A delete
declined or stopped before it removed anything, for a setup that never reached
its server, still offers **Delete VPN** while that setup holds or may have made
cloud resources. **Change server settings** waits until a creation that got no
answer has been looked up, so its request is never sent again blind, and a
delete never offers it. After **Update cloud account credentials** picks other
credentials, finding nothing proves nothing until they find one of the VPN's
resources: they may reach another account. The setup or delete then reads
another of its resources first, and pauses if there is none or it is not there.
That pause offers **These credentials are for the same account**, for a new or
renewed token of the same account. Once you confirm it when asked again, what
they find, or do not find, counts.
A creation refused for its credentials (HTTP 401 or 403) made nothing, so when
it is the only one sent, new credentials need no such check. **Resume earlier delete** continues the stopped attempt with
the VPN Setup version that started it. A new operation carries over the
receipts of the job it starts from, never that job's progress or errors.

Only UDP 51820 is exposed for WireGuard; TCP 51821 binds to 127.0.0.1 and can be
accessed through an SSH tunnel. TCP 22 is limited to the selected source CIDR.
The installer preserves existing provider firewall chains, including OCI's
iSCSI rules. Full-tunnel clients route both IPv4 and IPv6 into WireGuard; a host
without upstream IPv6 cannot provide IPv6 internet egress.

## Provider guides

[Google Cloud](guides/gcp.md), [AWS](guides/aws.md), [Azure](guides/azure.md),
[DigitalOcean](guides/digitalocean.md), [Hetzner](guides/hetzner.md),
[Akamai/Linode](guides/linode.md), [Vultr](guides/vultr.md),
[Oracle Cloud](guides/oci.md), [OVHcloud](guides/ovh.md),
[Scaleway](guides/scaleway.md).

The workflow uses the provider's REST APIs rather than storing a cloud CLI or
SDK on the VM. The first release uses service-account keys, application client
credentials, signing keys or API tokens; browser OAuth is not part of setup.
Native account forms support persistent per-account credentials.

## Validation

Run `node --test plugins/vpnsetup/tests/*.test.cjs` and
`python3 -B -m unittest discover -s plugins/vpnsetup/tests -p 'test_*.py'`
(`-B` keeps `__pycache__` out of the catalogued plugin files).
`node tools/check-image-pins.mjs` (run by CI) requires `worker.js`,
`server/vpn.py` and this README to name the same digest-pinned image, and
`ui/app.js` its release. `.github/workflows/upstream.yml` fails weekly, and
warns on each push and pull request to main, when wg-easy publishes a newer
release than the pin. GitHub disables a scheduled workflow after 60 days
without repository activity; re-enable it from the Actions tab.
The tests use fixture HTTP results and mock installer dependencies. No cloud
account, paid VM, live key or VPN connection is used. Real-cloud end-to-end and
Android device verification are separate release checks.

API references: [wg-easy unattended setup](https://wg-easy.github.io/wg-easy/latest/advanced/config/unattended-setup/),
[wg-easy pinned API source](https://github.com/wg-easy/wg-easy/tree/v15.5.0/src/server/api).
wg-easy is distributed by its authors under AGPL-3.0-only; this plugin downloads
the upstream container and does not embed its code.
