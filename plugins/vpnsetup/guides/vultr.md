# Vultr

Activate billing and enable API access for your account. Create an API key and
configure its source-IP allowlist so the phone's connection can use it. A key
that only allows a fixed home address will fail when the phone switches to
mobile data. Enter the key in the native form.

Choose a region and available plan with at least 1 GB RAM. Obtain the current
Ubuntu 24.04 x64 OS ID from `GET /v2/os` or the API documentation; IDs must be
verified rather than assumed. The worker verifies the chosen OS and plan's
regional availability before approval.

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
