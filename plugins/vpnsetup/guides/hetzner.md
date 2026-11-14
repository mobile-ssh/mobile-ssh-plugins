# Hetzner Cloud

Create a Cloud project, activate billing, and check server/Primary IP limits.
Create a read/write API token for this project under Security→API tokens. It is
project-specific; a read-only token cannot provision or delete resources.
Enter it in the native credential form. The plugin then lists the locations
and x86 server types this project can order now, with their monthly prices,
and suggests the cheapest; choose **Other (type a value)** to enter another.
The plugin verifies the server type and location before creating anything.
The token can be entered directly; no credential file is required.

For console setup:

1. Add the selected SSH public key to the project.
2. Create an Ubuntu 24.04 server with at least 1 GB RAM and a Primary IPv4.
3. Attach a dedicated Cloud Firewall allowing TCP 22 from your source CIDR,
   UDP 51820 from 0.0.0.0/0 and ICMP. Leave outbound allowed and 51821 closed.
4. Enter its Primary IPv4 and user `root` in the plugin and verify SSH trust.

Automatic resources are a project SSH key, firewall, separately reserved Primary
IPv4 and server. The address remains tied to the server across normal stops/restarts.
Cleanup deletes the server, waits for its owned Primary IP to become unassigned,
then releases the IP,
followed by the firewall and imported key. In the console,
check whether the Primary IP's auto-delete option is enabled; otherwise remove
it separately. Powered-off servers and unassigned addresses can remain billable.

[Cloud API](https://docs.hetzner.cloud/),
[create a server](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/),
[Primary IPs](https://docs.hetzner.com/cloud/primary-ips/overview/),
[pricing](https://www.hetzner.com/cloud/).
