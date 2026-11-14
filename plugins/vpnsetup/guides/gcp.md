# Google Cloud Compute Engine

Create a Google Cloud account, attach a billing account to a dedicated project,
enable the Compute Engine API, and check VM and external IPv4 quotas in the
desired region. Billing and organization policy can prevent resource creation
even when credentials are valid.

For automatic setup, create a service account under **IAM & Admin → Service
Accounts**, grant Compute Instance Admin (v1) and Compute Network Admin in this
project, then create a JSON key. Enter the JSON only in Mobile SSH's native
credential form. Provide the project ID, region, zone and machine type. The
worker verifies the type and Ubuntu 24.04 image before approval. Network and
instance permissions must include create/get/list/delete for the dedicated
VPC, firewalls, address and VM. If organization policy enforces OS Login or
prohibits service-account keys/external IPs, use an administrator-approved
console configuration and the console path instead.

Optionally also enable the **Cloud Resource Manager API** in the key's
project: the plugin can then list your projects to choose from; without it,
enter the project ID yourself. It then lists the project's regions and the
chosen region's zones that are up, and the x86 machine types offered in that
zone with at least 1 GB RAM. Google Cloud's API gives the plugin no prices, so
they are shown without one, in list-price order: `e2-micro` (the smallest, in
the free tier for one VM in us-west1, us-central1 and us-east1) is suggested;
`e2-small` gives more headroom. Choose **Other (type a value)** to enter
another value. The zone must be in the chosen region; the checks refuse one
that is not, and an Arm machine type, since the server boots Ubuntu for amd64.

For console setup:

1. Create a VPC/subnet in the chosen region, with internet routing.
2. Reserve a regional external IPv4 address in **VPC network → IP addresses**.
3. Create an Ubuntu 24.04 LTS amd64 VM, at least 1 GB RAM / 20 GB boot disk. Attach
   the reserved IPv4 and the plugin's public SSH key as `ubuntu:PUBLIC_KEY`.
4. Use a dedicated network tag. Add ingress TCP 22 from your SSH source CIDR
   and UDP 51820 from 0.0.0.0/0 targeting that tag. Do not open TCP 51821.
5. Enter the public IPv4 and user `ubuntu` in the plugin. Verify host trust
   using the serial console or another trusted channel.

Automatic setup creates a dedicated auto-mode VPC, two firewall rules,
regional reserved address and VM with an auto-deleted boot disk. Charges can
include VM, disk, IPv4 and egress. For console cleanup, delete the VM and boot
disk, release the reserved address, then remove the dedicated firewall rules
and VPC. Stopping the VM does not release the disk or address.

[Create a VM](https://cloud.google.com/compute/docs/instances/create-start-instance),
[static external IP](https://cloud.google.com/compute/docs/ip-addresses/reserve-static-external-ip-address),
[service-account keys](https://cloud.google.com/iam/docs/creating-managing-service-account-keys),
[pricing](https://cloud.google.com/compute/pricing).
