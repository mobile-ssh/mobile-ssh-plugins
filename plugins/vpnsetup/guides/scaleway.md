# Scaleway Instances

Activate billing, create a project, and check instance/IP/volume quotas. Create
an IAM application/API key with project permissions for Instances, public IPs,
security groups, volumes and SSH keys. Enter the API secret key in the native
form and the project UUID in setup; requests use X-Auth-Token. The project UUID
is not the organization UUID.

Choose a zone, x86 commercial type and Ubuntu 24.04/Noble image UUID compatible
with that zone. Get the image ID from the Instance image API/console, not a
marketplace product ID. The worker verifies the image architecture and type.

For console setup:

1. Add the selected SSH public key to the project.
2. Create an Ubuntu 24.04 amd64 Instance with at least 1 GB RAM and 20 GB boot disk.
3. Reserve/attach a flexible routed IPv4. API-created instances may begin
   powered off, so power the instance on after networking is attached.
4. Use a stateful security group with inbound DROP, outbound ACCEPT, TCP 22
   from your source CIDR and UDP 51820 from 0.0.0.0/0. Keep 51821 closed.
5. Enter the IPv4 and user `root` in the plugin, then verify SSH trust.

Automatic resources include an IAM SSH key, stateful security group/rules,
flexible IPv4, instance and its image-created boot volume. Cleanup powers off
and deletes the instance, checks/deletes owned retained boot volumes, releases
the flexible IP, then removes its group/key. Powering off retains billable
volumes and IPs. Do not attach unrelated volumes to the managed instance.

[Instance API](https://www.scaleway.com/en/developers/api/instance/),
[create an instance](https://www.scaleway.com/en/docs/instances/how-to/create-an-instance/),
[API authentication](https://www.scaleway.com/en/developers/api/),
[pricing](https://www.scaleway.com/en/pricing/virtual-instances/).
