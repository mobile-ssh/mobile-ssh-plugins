# Vultr

Activate billing and enable API access for your account. Create an API key and
configure its source-IP allowlist so the phone's connection can use it. A key
that only allows a fixed home address will fail when the phone switches to
mobile data. Enter the key in the native form.

The plugin then lists Vultr's regions and the plans the chosen region can
deploy now with a public IPv4 address and at least 1 GB RAM, cheapest first,
and suggests the cheapest; choose **Other (type a value)** to enter another.
Plans that boot only from Block Storage (some VX1 plans) are not listed, and
the checks refuse one entered after Other, since the setup creates no boot
volume. It fills in the Ubuntu 24.04 x64 OS ID from Vultr's OS list (`GET /v2/os`);
when that list cannot be read, enter the ID yourself. These lists are public,
so they do not show whether the key works. The worker verifies the chosen OS
and plan's regional availability before approval.

For console setup:

1. Add your public SSH key and create an Ubuntu 24.04 x64 Cloud Compute instance.
2. Attach a Firewall Group permitting TCP 22 from your SSH source CIDR and
   UDP 51820 from 0.0.0.0/0. Do not open 51821.
3. Keep the assigned main IPv4, which survives normal restarts.
4. Enter that IPv4 and user `root` in the plugin; verify its SSH host key.

Automatic resources are an SSH key, Firewall Group/rules and instance. Delete
the instance to stop instance billing, then remove the dedicated firewall/key.
Check separately allocated Reserved IPs, snapshots and block storage if you
added any in the console; the plugin does not delete unrelated resources.

[Vultr API](https://www.vultr.com/api/),
[server deployment](https://docs.vultr.com/how-to-deploy-a-vultr-cloud-server),
[pricing](https://www.vultr.com/pricing/).
