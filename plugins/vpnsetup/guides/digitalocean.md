# DigitalOcean

Activate billing and confirm Droplet/Reserved IP limits. For automatic setup,
create a personal access token with read/create/delete access to Droplets,
SSH keys, Reserved IPs, Cloud Firewalls and tags, plus read access to regions,
sizes and images. A custom-scoped token must include the dependencies listed by
the provider for each action. Enter the token only in the native credential
form. The plugin then lists the regions where a Droplet can be created now,
and the sizes with at least 1 GB RAM offered in the chosen one, cheapest
first, and suggests the cheapest; choose **Other (type a value)** to enter
another. The worker checks availability live before approval.

For console setup:

1. Create an Ubuntu 24.04 x64 Droplet with at least 1 GB RAM and your selected
   public SSH key. Use user `root`.
2. Assign a Reserved IPv4 address to this Droplet.
3. Attach a Cloud Firewall allowing TCP 22 from your SSH source CIDR and
   UDP 51820 from 0.0.0.0/0; allow outbound traffic. Keep 51821 closed.
4. Enter the Reserved IPv4 in the plugin and verify SSH trust.

Automatic resources are one SSH key, Droplet, Reserved IP and Cloud Firewall.
Reserved IP billing depends on assignment; Droplet and egress charges still
apply. For console cleanup, unassign/release the Reserved IP, destroy the
Droplet and its unneeded backups/snapshots, then delete the dedicated firewall
and imported key. Powering off a Droplet does not end billing.

[API reference](https://docs.digitalocean.com/reference/api/digitalocean/),
[create Droplets](https://docs.digitalocean.com/products/droplets/how-to/create/),
[Reserved IPs](https://docs.digitalocean.com/products/networking/reserved-ips/),
[pricing](https://www.digitalocean.com/pricing/droplets).
