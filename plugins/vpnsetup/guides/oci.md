# Oracle Cloud Infrastructure

Create/activate an OCI tenancy and a dedicated compartment, then check shape,
boot-volume and public-IP quotas/capacity in your subscribed region. Free-tier
capacity is not guaranteed. Add an API signing public key to an IAM user and
enter tenancy OCID, user OCID, fingerprint and signing private PEM key in the
native credential form. The signing key is separate from the server's SSH key.

An administrator must grant the user/group permission to manage instance-family
and virtual-network-family in the chosen compartment, and the volume/image
permissions required for booting and terminating the selected image. Provide
the compartment OCID, region, full availability-domain name, supported Flex
shape, and Canonical Ubuntu 24.04 amd64 image OCID. Image OCIDs are regional;
select one in the console and copy its OCID. The worker verifies OS and shape
compatibility. The automatic default is a 1 OCPU / 2 GB E4 Flex VM, not a promise of
Always Free eligibility.

The plugin offers the tenancy's root compartment (from the tenancy OCID you
entered) and Oracle's main commercial regions; choose **Other (type a value)** to
enter a dedicated compartment's OCID or another region, and choose a region
your tenancy is subscribed to. Optionally also grant
`Allow group <group> to inspect compute-capacity-reservations in compartment <compartment>`:
the plugin can then list the region's availability domains; without it, enter
the full name (such as `Uocm:US-ASHBURN-AD-1`). It then lists the x86 Flex
shapes that can run with 1 OCPU and 2 GB RAM in that domain, with Oracle's
approximate list price, cheapest first, and fills in the newest Canonical
Ubuntu 24.04 image for the chosen shape. Fixed shapes, such as the Always Free
`VM.Standard.E2.1.Micro`, cannot take the 1 OCPU / 2 GB size the plugin
creates; the checks refuse them. Capacity and service limits are not visible
before creation: a listed shape can still fail when the VM is launched.

For console setup:

1. Create a VCN, Internet Gateway and public subnet. Route 0.0.0.0/0 through
   the gateway and permit outbound traffic.
2. Create security-list/NSG ingress rules for TCP 22 from your source CIDR and
   UDP 51820 from 0.0.0.0/0. Keep 51821 closed.
3. Launch Canonical Ubuntu 24.04 with your SSH public key; use user `ubuntu`.
4. Create a Reserved Public IPv4 and assign it to the VM's primary private IP.
5. Enter that address in the plugin and verify SSH trust. Preserve OCI's
   existing guest firewall/iSCSI rules; do not flush iptables or enable UFW.

Automatic cleanup releases the Reserved Public IP, terminates the instance
with its boot volume, then removes the dedicated subnet, security list, route
table, gateway and VCN. Check the console for any pending failures. A stopped
VM, boot volume or unassigned Reserved IP may remain billable.

[API signing keys](https://docs.oracle.com/en-us/iaas/Content/API/Concepts/apisigningkey.htm),
[public IPs](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingpublicIPs.htm),
[Compute API](https://docs.oracle.com/en-us/iaas/api/#/en/iaas/20160918/),
[pricing](https://www.oracle.com/cloud/compute/pricing/).
