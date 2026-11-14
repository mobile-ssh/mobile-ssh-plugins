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
5. Review the resources and current provider pricing page. Provisioning begins
   only after native approval. Provider accounts, billing activation, terms,
   capacity and quota approval are completed in the provider's console.
6. Approve the server's SSH host key using Mobile SSH's trust UI. The app creates
   a saved SSH server, installs wg-easy, and imports its first VPN profile.
7. Connect using the VPN page. A successful import does not by itself establish
   an internet route; check the WireGuard handshake and test internet access.

**Check server**, **Add client**, **Revoke client**, **Update WireGuard**, and
**Delete deployment** operate on the saved deployment. With Mobile SSH bridge
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
have sent a create is not continued that way, and once stopped it reads "cloud
resources may exist", not "nothing created". Setups that VPN Setup 1.0.2 or
earlier stopped at their checks keep that version's recovery, so they are not
continued either: the page counts them and suggests **Stop workflow**. The page
redraws only what changed, and a waiting step's reason stays shown beside it.

Every resource receipt retains its provider ID, ownership and deletion status.
A lost creation response is reconciled against a stable deployment name;
ambiguous/missing matches pause for review instead of blindly repeating the
creation. Deletions poll until the provider confirms removal. A Hetzner
resource that is still in use or locked just after its server is deleted is
deleted again after a wait, within the same polling limit. A deletion that
pauses shows the provider's error code and a short, capped message. Canceling
a job does not delete resources or stop charges. Resume or review cleanup
afterward.

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
