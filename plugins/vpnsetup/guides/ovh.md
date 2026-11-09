# OVHcloud Public Cloud

Activate a Public Cloud project and payment method and confirm regional quotas.
Create an application key/secret and a validated consumer key on the API site
matching your account: EU, CA or US. Consumer-key validation is performed in
OVHcloud's browser page before using the plugin. Allow the needed GET, POST
and DELETE paths for `/cloud/project/PROJECT/*` and
`/publicCloud/project/PROJECT/*` including v2 instance/security-group APIs.
Enter keys only in the native form; these are not OpenStack username/password
credentials. Choose the matching endpoint region in setup.

Select a cloud region, flavor ID and Ubuntu 24.04 image ID. Obtain IDs using
the project's flavor and image listings (the worker verifies them). The v2
security-group and instance APIs use the same OVH signed credentials; no
additional OpenStack password is required for this path.

For console setup:

1. Add the selected public SSH key to the Public Cloud project.
2. Create an Ubuntu 24.04 instance with an hourly plan and Basic Public IP
   connectivity on Ext-Net. The IP lasts for the instance's lifetime.
3. Apply a dedicated security group: ingress TCP 22 from your source CIDR,
   UDP 51820 from 0.0.0.0/0, outbound traffic permitted. Keep 51821 closed.
4. Enter the public IPv4 and user `ubuntu` in the plugin and verify SSH trust.

Automatic resources are a project SSH key, v2 security group and v2 compute
instance with an automatically assigned public address. Cleanup deletes the
instance and its public interface, waits for removal, then deletes the group
and imported key. Monthly conversion is deliberately excluded. Console users
must also release any Floating/Additional IP or volume they created separately.

[Official instance API implementation](https://github.com/ovh/terraform-provider-ovh/blob/master/docs/resources/cloud_instance.md),
[official security-group client](https://github.com/ovh/ovhcloud-cli/blob/v0.14.0/internal/services/cloud/cloud_security_group.go),
[create a Public Cloud instance](https://docs.ovhcloud.com/en/guides/public-cloud/compute/getting-started),
[pricing](https://www.ovhcloud.com/en/public-cloud/prices/).
