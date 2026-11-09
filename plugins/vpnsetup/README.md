# VPN Setup

This standalone plugin creates a dedicated Ubuntu 24.04 cloud VM, installs
wg-easy 15.4.0, and imports a WireGuard client directly into Mobile SSH. It can
also install onto a VM created using one of the console guides. The plugin list
and the offline voice assistant use the same native, checkpointed workflow.

The worker is a pure `MobileSSHWorkflow.next(state, event)` function. Cloud
credentials, SSH private keys, administrator passwords, and WireGuard configs
stay in the native executor's encrypted stores. The worker receives credential
references and configuration references. Cloud credentials are never uploaded
to the VM. The Python installer runs only through the protected native SSH path.

The container is pinned to the multiarchitecture image index
`ghcr.io/wg-easy/wg-easy:15.4.0@sha256:0e7bc9d34e86ddcaa92bc700d4d7dc9b33291dbc07ac8d13382f7c2095f949ec`
(linux amd64 and arm64, resolved from GHCR on 2026-11-08). Automatic VM choices
target amd64. Use Ubuntu 24.04 with at least 1 GB RAM and 20 GB storage for the
console path; more RAM makes installation and upgrades less constrained.

## Operation and recovery

1. Choose a provider and API or console setup.
2. Select a saved cloud account or enter its credentials in the native form.
3. Select or generate an SSH key. Lightsail requires RSA.
4. Choose the project, region, plan, image where necessary, and SSH source CIDR.
   The worker checks the selected provider offering using live read-only APIs.
5. Review the resources and current provider pricing page. Provisioning begins
   only after native approval. Provider accounts, billing activation, terms,
   capacity and quota approval are completed in the provider's console.
6. Approve the server's SSH host key using Mobile SSH's trust UI. The app creates
   a saved SSH server, installs wg-easy, and imports its first VPN profile.
7. Connect using the VPN page. A successful import does not by itself establish
   an internet route; check the WireGuard handshake and test internet access.

**Check server**, **Add client**, **Revoke client**, and **Delete deployment**
operate on the saved deployment. Revoking the client's server key prevents
future use of its configuration. Deletion of API-created servers uses the cloud
API even when SSH is unavailable. Console-created VMs remain the user's cloud
resources; the plugin removes its managed VPN installation, and the console
guide explains how to remove the VM and public IP.

Every resource receipt retains its provider ID, ownership and deletion status.
A lost creation response is reconciled against a stable deployment name;
ambiguous/missing matches pause for review instead of blindly repeating the
creation. Deletions poll until the provider confirms removal. Canceling a job
does not delete resources or stop charges. Resume or review cleanup afterward.

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
`python3 -m unittest discover -s plugins/vpnsetup/tests -p 'test_*.py'`.
The tests use fixture HTTP results and mock installer dependencies. No cloud
account, paid VM, live key or VPN connection is used. Real-cloud end-to-end and
Android device verification are separate release checks.

API references: [wg-easy unattended setup](https://wg-easy.github.io/wg-easy/latest/advanced/config/unattended-setup/),
[wg-easy pinned API source](https://github.com/wg-easy/wg-easy/tree/v15.4.0/src/server/api).
wg-easy is distributed by its authors under AGPL-3.0-only; this plugin downloads
the upstream container and does not embed its code.
