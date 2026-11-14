# Microsoft Azure

Create/activate an Azure subscription, register Microsoft.Compute and
Microsoft.Network if needed, and confirm regional vCPU/public-IP quotas. For
automatic setup, register an application in Microsoft Entra ID, create a client
secret, and assign its service principal Contributor at a dedicated
subscription scope that permits creation of the deployment's resource group.
A custom role may narrow this to resource-group, compute, disk and network
create/read/delete operations. Enter tenant ID, client ID and the client-secret
**value**, not its secret ID, in the native form. Enter the subscription ID
separately. Note the secret expiry date and renew it before future lifecycle
operations.

With that role the plugin lists your enabled subscriptions, the
subscription's regions (Azure's recommended ones first; the others are marked,
as some need an access request before VMs can be created there) and the region's x64 VM sizes
that boot its Ubuntu 24.04 image, with at least 1 GB RAM. Azure's API gives the
plugin no prices, so sizes are shown without one, in list-price order:
`Standard_B2ats_v2` is suggested (cheaper than `Standard_B1s`, whose B-series
v1 retires in November 2028). Choose **Other (type a value)** to enter another
value; the checks refuse an Arm size, since the server boots the x64 image. A
size listed can still be restricted for a subscription (SkuNotAvailable), which
shows only when the VM is created.

For console setup:

1. Create a dedicated resource group and virtual network/subnet.
2. Create a Standard static IPv4 Public IP in the VM's region.
3. Create Ubuntu Server 24.04 LTS amd64 with at least 1 GB RAM, an SSH public key,
   login `ubuntu`, and a 20 GB or larger OS disk.
4. Attach the Public IP to its NIC and a network security group allowing TCP 22
   from your SSH source CIDR and UDP 51820 from the internet. Keep 51821 closed.
5. Enter the public IPv4 and username in the plugin, then verify SSH trust.

Automatic setup uses a dedicated resource group containing an NSG, VNet/subnet,
static Public IP, NIC, VM and managed OS disk. Automatic deletion removes that
entire owned group. Do not add unrelated resources to it. For console cleanup,
remove the dedicated group after checking its contents; deallocation alone
does not stop disk or public-IP charges.

[Create a Linux VM](https://learn.microsoft.com/azure/virtual-machines/linux/quick-create-portal),
[service principal](https://learn.microsoft.com/entra/identity-platform/howto-create-service-principal-portal),
[Public IPs](https://learn.microsoft.com/azure/virtual-network/ip-services/public-ip-addresses),
[pricing](https://azure.microsoft.com/pricing/details/virtual-machines/linux/).
