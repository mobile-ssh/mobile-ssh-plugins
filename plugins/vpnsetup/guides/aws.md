# Amazon Lightsail (automatic) and EC2 (console)

Activate an AWS account with billing, then choose a Lightsail region with
capacity. Automatic setup uses Lightsail, not EC2. Create a dedicated IAM
identity with permission for the needed Lightsail actions: GetRegions,
GetBundles, GetBlueprints, ImportKeyPair, GetKeyPair, DeleteKeyPair,
AllocateStaticIp, GetStaticIp, ReleaseStaticIp, AttachStaticIp, DetachStaticIp,
CreateInstances, GetInstance, DeleteInstance, PutInstancePublicPorts and
GetInstancePortStates. Apply resource restrictions where each action supports
them. Enter its access-key ID and secret in the native credential form; include
the session token for temporary credentials. Renew temporary credentials before
resuming after expiry. A secret access key is not the account password.

For Lightsail console setup:

1. Create a Linux/Unix Ubuntu 24.04 instance with at least 1 GB RAM.
2. Import/select the plugin's RSA public SSH key. The login user is `ubuntu`.
3. In Networking create and attach a static IPv4 address.
4. Restrict TCP 22 to your SSH source CIDR, add UDP 51820 for all IPv4 sources,
   and remove unused public ports. Keep TCP 51821 closed.
5. Enter its static IPv4 in the plugin and verify the SSH host key.

For the EC2 console alternative, create a VPC with an internet gateway and
public subnet whose route table sends 0.0.0.0/0 to that gateway. Launch Canonical
Ubuntu 24.04 with a key pair, encrypted EBS root disk and a security group with
the same two ingress rules. Allocate an Elastic IP and associate it with the
VM. Use the console method in the plugin with user `ubuntu`. EC2 IAM and billing
are separate from Lightsail permissions and bundles.

Automatic cleanup detaches/releases the static IP, deletes the instance and
imported key pair. For console-created instances, delete the instance, release
the static/Elastic IP and delete unneeded EBS volumes/security groups. Check
snapshots separately. Stopped instances can still incur storage/IP charges.

[Lightsail API](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/Welcome.html),
[static IP](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html),
[EC2 Ubuntu launch](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EC2_GetStarted.html),
[pricing](https://aws.amazon.com/lightsail/pricing/).
