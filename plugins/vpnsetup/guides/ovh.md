# OVHcloud Public Cloud

Activate a Public Cloud project and payment method and confirm regional quotas.
Create an application key/secret and a validated consumer key on the API site
matching your account: EU, CA or US. Consumer-key validation is performed in
OVHcloud's browser page before using the plugin. Allow the needed GET, POST
and DELETE paths for `/cloud/project/PROJECT/*` and
`/publicCloud/project/PROJECT/*` including v2 instance/security-group APIs.
Enter keys only in the native form; these are not OpenStack username/password
credentials. Setup first asks the API account region (EU, CA or US): choose the
site where you created the keys, since every request goes there.

Optionally also allow `GET /publicCloud/project` (or the older
`GET /cloud/project`): the plugin can then list your Public Cloud projects to
choose from; without it, enter the project ID yourself. It then lists the
project's enabled regions, the Linux flavors in stock in the chosen region
(with OVHcloud's list price, cheapest first, approximate as your account's
currency or tax may differ) and fills in the newest Ubuntu 24.04 image ID, and
suggests the cheapest flavor; choose **Other (type a value)** to enter another
flavor ID, or another region. When a list cannot be read, enter the value
from the project's flavor and image listings; the worker verifies them. The v2
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
