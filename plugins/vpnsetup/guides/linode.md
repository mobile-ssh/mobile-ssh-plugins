# Akamai Cloud / Linode

Activate billing and check account limits and available regions. Create a
personal access token with Linodes read/write, Firewalls read/write and read
access to required images/types/regions. Enter it only in the native form.
Automatic creation generates the API-required root password in the native
vault; it does not expose the password to the worker, and cloud-init disables
SSH password authentication. SSH uses the selected public key.

The plugin lists the regions that can run a Linode with cloud-init and a Cloud
Firewall, then the plans available in the chosen region now with at least
1 GB RAM, cheapest first at that region's price, and suggests the cheapest;
choose **Other (type a value)** to enter another.

For console setup:

1. Create a Linode using Ubuntu 24.04, at least 1 GB RAM, and your public SSH key.
2. Keep the assigned public IPv4; it persists across normal reboots.
3. Create/attach a Cloud Firewall with inbound default DROP, outbound ACCEPT,
   TCP 22 from your source CIDR, and UDP 51820 from 0.0.0.0/0.
4. Enter the public IPv4 and user `root` in the plugin, then verify host trust.

Automatic resources are the Linode, its local root disk/configuration and a
Cloud Firewall. Deleting the Linode releases its included address and disks;
the dedicated firewall is also deleted. Console users should delete the
instance and firewall and inspect any separately created backups/volumes.
Shutdown does not end the instance's billing.

[Create instance API](https://techdocs.akamai.com/linode-api/reference/post-linode-instance),
[API tokens](https://techdocs.akamai.com/cloud-computing/docs/manage-personal-access-tokens),
[Cloud Firewalls](https://techdocs.akamai.com/cloud-computing/docs/getting-started-with-cloud-firewalls),
[pricing](https://www.linode.com/pricing/).
