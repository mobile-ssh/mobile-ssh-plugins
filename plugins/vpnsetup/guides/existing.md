# Existing public server

Use a dedicated Ubuntu 24.04 server with a public IPv4, at least 1 GB RAM / 20 GB
storage and SSH access as root or a user with passwordless sudo. The container
image supports linux amd64 and arm64. Cloud account credentials are not needed.

1. Select an existing SSH private-key credential in the native key picker. If
   you generate a new key, add its public key to the server's authorized_keys
   using an already trusted console or SSH connection.
2. Permit inbound TCP 22 from the phone's source CIDR and UDP 51820 from the
   internet in the provider firewall. Keep TCP 51821 closed.
3. Enter the public IPv4 and the matching SSH login name. Verify the server's
   host-key fingerprint through a trusted channel.
4. Review installation. Mobile SSH installs Docker if needed and deploys the
   pinned wg-easy container, then saves its SSH server and VPN profile.

The wg-easy administrator web UI listens on 127.0.0.1:51821; use an SSH tunnel
to open it. The installer does not flush existing firewall rules. An existing
Docker network conflicting with 10.42.42.0/24 or fdcc:ad94:bacf:61a3::/64 must
be resolved by the server administrator before installation.

Delete deployment removes this plugin's container and data and its local
profiles. It does not delete your existing VM, cloud address, account, shared
Docker installation, or unrelated containers. Remove the VM/address through
its hosting provider if you no longer need them.
