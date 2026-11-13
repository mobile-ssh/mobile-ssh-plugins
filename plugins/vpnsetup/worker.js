/* Pure, checkpointable workflow. No fetch, DOM, clock, random or credential bytes. */
(function (root) {
  'use strict';
  const IMAGE = 'ghcr.io/wg-easy/wg-easy:15.5.0@sha256:071f79a639e9361123a5e57733107320207b844ddbbd92dfa6962f541fe8aac8';
  const RELEASE = IMAGE.split(':')[1].split('@')[0];
  // Bridge 1.4.0 passes the installer's fixed update outcomes as these native codes; anything else is a plain interruption.
  const RECONNECT = ' If this phone\'s VPN was turned off for the update, reconnect it.';
  const UPDATE_FAILURES = {
    UPDATE_NOT_DOWNLOADED: 'The server could not download WireGuard '+RELEASE+'. WireGuard on the server was not changed.'+RECONNECT,
    UPDATE_ROLLED_BACK: 'WireGuard '+RELEASE+' did not start correctly, so the server went back to the previous version with its clients.'+RECONNECT,
    UPDATE_RESTORE_FAILED: 'WireGuard '+RELEASE+' did not start correctly and the previous version did not restart either: the VPN on this server is down. Retry the update, or check the server, which keeps the data from before the update.'
  };
  const PROVIDERS = {
    gcp: ['Google Cloud', 'https://cloud.google.com/compute/pricing', 'ubuntu'],
    aws: ['AWS Lightsail', 'https://aws.amazon.com/lightsail/pricing/', 'ubuntu'],
    azure: ['Microsoft Azure', 'https://azure.microsoft.com/pricing/details/virtual-machines/linux/', 'ubuntu'],
    digitalocean: ['DigitalOcean', 'https://www.digitalocean.com/pricing/droplets', 'root'],
    hetzner: ['Hetzner Cloud', 'https://www.hetzner.com/cloud/', 'root'],
    linode: ['Akamai / Linode', 'https://www.linode.com/pricing/', 'root'],
    vultr: ['Vultr', 'https://www.vultr.com/pricing/', 'root'],
    oci: ['Oracle Cloud', 'https://www.oracle.com/cloud/compute/pricing/', 'ubuntu'],
    ovh: ['OVHcloud Public Cloud', 'https://www.ovhcloud.com/en/public-cloud/prices/', 'ubuntu'],
    scaleway: ['Scaleway', 'https://www.scaleway.com/en/pricing/virtual-instances/', 'root'],
    existing: ['Existing public server', '', 'ubuntu']
  };
  const clone = v => JSON.parse(JSON.stringify(v));
  const enc = v => encodeURIComponent(String(v));
  const get = (o, path, fallback) => {
    const value = path ? path.split('.').reduce((a, k) => a == null ? undefined : a[k], o) : o;
    return value === undefined || value === null ? fallback : value;
  };
  const list = (b, path) => { const a = get(b, path, []); return Array.isArray(a) ? a : []; };
  const first = (b, path, field, value) => list(b, path).find(x => get(x, field) === value);
  function b64(value) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < value.length; i += 3) {
      const a = value.charCodeAt(i), b = value.charCodeAt(i + 1), c = value.charCodeAt(i + 2);
      if (a > 127 || b > 127 || c > 127) throw new Error('Only ASCII provisioning data is supported');
      out += alphabet[a >> 2] + alphabet[((a & 3) << 4) | ((b || 0) >> 4)] +
        (i + 1 < value.length ? alphabet[((b & 15) << 2) | ((c || 0) >> 6)] : '=') +
        (i + 2 < value.length ? alphabet[c & 63] : '=');
    }
    return out;
  }
  function cloudInit(s) {
    return '#cloud-config\nssh_pwauth: false\ndisable_root: false\nssh_authorized_keys:\n  - ' +
      JSON.stringify(s.publicKey) + '\n';
  }
  function request(s, method, url, body, extra) {
    return Object.assign({method, url, auth: {scheme: s.provider, credentialRef: s.credentialRef},
      headers: {'Content-Type': 'application/json'}}, body === undefined ? {} : {body}, extra || {});
  }
  function match(path, field, value) { return {path, field, value}; }
  function operation(key, create, read, extract, ready, remove, reconcile) {
    if (create && !['GET', 'HEAD'].includes(create.method)) create.reconcile = reconcile || read;
    if (remove && !['GET', 'HEAD'].includes(remove.method)) remove.reconcile = read;
    return {key, create, read, extract, ready: ready || (() => true), remove};
  }
  function keyLookup(s) {
    const p=s.inputs;
    const ovh='https://'+(p.endpoint==='ca'?'ca.api.ovh.com':p.endpoint==='us'?'api.us.ovhcloud.com':'eu.api.ovh.com')+'/1.0/cloud/project/'+enc(p.projectId);
    const endpoints={
      digitalocean:['https://api.digitalocean.com/v2/account/keys?per_page=200','ssh_keys','public_key'],
      hetzner:['https://api.hetzner.cloud/v1/ssh_keys?per_page=50','ssh_keys','public_key'],
      vultr:['https://api.vultr.com/v2/ssh-keys?per_page=500','ssh_keys','ssh_key'],
      ovh:[ovh+'/sshkey','','publicKey'],
      scaleway:['https://api.scaleway.com/iam/v1alpha1/ssh-keys?project_id='+enc(p.projectId)+'&page_size=100','ssh_keys','public_key']
    };
    return endpoints[s.provider];
  }
  function entity(path, name) {
    return b => { const value = get(b, path, {}); return {id: value.id || value.name || name, name: value.name || name}; };
  }
  function graph(s) {
    const p = s.inputs, r = s.resources, n = s.name, R = (key, field) => get(r, key + '.' + (field || 'id'));
    const req = (method, url, body, extra) => request(s, method, url, body, extra);
    const known = (key, create, read, extract, ready, remove, recover) => operation(key, create, read, extract, ready, remove, recover);
    const simple = (key, base, body, envelope, listPath, field) => {
      const id = R(key), read = req('GET', base + '/' + enc(id));
      const reconcile = Object.assign(req('GET', base), {match: match(listPath, field || 'name', n)});
      return known(key, req('POST', base, body), read, entity(envelope, n), null, req('DELETE', base + '/' + enc(id)), reconcile);
    };
    if (s.provider === 'digitalocean') {
      const b = 'https://api.digitalocean.com/v2';
      return [
        simple('key', b + '/account/keys', {name:n, public_key:s.publicKey}, 'ssh_key', 'ssh_keys'),
        known('server', req('POST', b + '/droplets', {name:n, region:p.region, size:p.size, image:'ubuntu-24-04-x64',
          ssh_keys:[R('key')], ipv6:false, tags:[n], user_data:cloudInit(s)}), req('GET', b + '/droplets/' + R('server')),
          b => ({id:get(b,'droplet.id'), name:n, host:get(b,'droplet.networks.v4',[]).find(x=>x.type==='public')?.ip_address}),
          b => get(b,'droplet.status') === 'active', req('DELETE', b + '/droplets/' + R('server')),
          Object.assign(req('GET', b + '/droplets?tag_name=' + enc(n)), {match:match('droplets','name',n)})),
        known('address', req('POST', b + '/reserved_ips', {droplet_id:R('server')}),
          req('GET', b + '/reserved_ips/' + R('address')),
          b => ({id:get(b,'reserved_ip.ip'),host:get(b,'reserved_ip.ip')}), null,
          req('DELETE', b + '/reserved_ips/' + R('address')),
          Object.assign(req('GET', b + '/reserved_ips'), {match:match('reserved_ips','droplet.id',R('server'))})),
        simple('firewall', b + '/firewalls', {name:n,droplet_ids:[R('server')],
          inbound_rules:[{protocol:'tcp',ports:'22',sources:{addresses:[p.sshCidr]}},{protocol:'udp',ports:'51820',sources:{addresses:['0.0.0.0/0']}}],
          outbound_rules:[{protocol:'tcp',ports:'all',destinations:{addresses:['0.0.0.0/0','::/0']}},
            {protocol:'udp',ports:'all',destinations:{addresses:['0.0.0.0/0','::/0']}},
            {protocol:'icmp',destinations:{addresses:['0.0.0.0/0','::/0']}}]}, 'firewall','firewalls')
      ];
    }
    if (s.provider === 'hetzner') {
      const b = 'https://api.hetzner.cloud/v1';
      return [simple('key',b+'/ssh_keys',{name:n,public_key:s.publicKey,labels:{'mobile-ssh':n}},'ssh_key','ssh_keys'),
        simple('firewall',b+'/firewalls',{name:n,labels:{'mobile-ssh':n},rules:[
          {direction:'in',protocol:'tcp',port:'22',source_ips:[p.sshCidr]},
          {direction:'in',protocol:'udp',port:'51820',source_ips:['0.0.0.0/0']},
          {direction:'in',protocol:'icmp',source_ips:['0.0.0.0/0']}]},'firewall','firewalls'),
        known('address',req('POST',b+'/primary_ips',{name:n,type:'ipv4',assignee_type:'server',auto_delete:false,location:p.region,labels:{'mobile-ssh':n}}),
          req('GET',b+'/primary_ips/'+R('address')),x=>({id:get(x,'primary_ip.id'),name:n,host:get(x,'primary_ip.ip')}),
          x=>!!get(x,'primary_ip.ip'),req('DELETE',b+'/primary_ips/'+R('address')),
          Object.assign(req('GET',b+'/primary_ips?name='+enc(n)),{match:match('primary_ips','name',n)})),
        known('server',req('POST',b+'/servers',{name:n,server_type:p.size,location:p.region,image:'ubuntu-24.04',
          ssh_keys:[R('key')],firewalls:[{firewall:R('firewall')}],labels:{'mobile-ssh':n},
          public_net:{ipv4:R('address'),enable_ipv4:true,enable_ipv6:false},user_data:cloudInit(s)}),req('GET',b+'/servers/'+R('server')),
          b=>({id:get(b,'server.id'),name:n,host:get(b,'server.public_net.ipv4.ip'),primaryIpId:get(b,'server.public_net.ipv4.id')}),
          b=>get(b,'server.status')==='running',req('DELETE',b+'/servers/'+R('server')),
          Object.assign(req('GET',b+'/servers?name='+enc(n)),{match:match('servers','name',n)}))];
    }
    if (s.provider === 'gcp') {
      const b='https://compute.googleapis.com/compute/v1/projects/'+enc(p.projectId), zone=b+'/zones/'+enc(p.zone);
      const region=b+'/regions/'+enc(p.region), network=b+'/global/networks/'+n;
      const named=(key,base,body,ready)=>known(key,req('POST',base,body),req('GET',base+'/'+n),
        b=>({id:b.id||n,name:n,host:b.address}),ready,req('DELETE',base+'/'+n),
        Object.assign(req('GET',base+'/'+n),{match:match('','name',n)}));
      return [named('network',b+'/global/networks',{name:n,autoCreateSubnetworks:true}),
        known('sshFirewall',req('POST',b+'/global/firewalls',{name:n+'-ssh',network,sourceRanges:[p.sshCidr],
          targetTags:[n],allowed:[{IPProtocol:'tcp',ports:['22']}]}),req('GET',b+'/global/firewalls/'+n+'-ssh'),
          ()=>({id:n+'-ssh'}),null,req('DELETE',b+'/global/firewalls/'+n+'-ssh')),
        known('vpnFirewall',req('POST',b+'/global/firewalls',{name:n+'-vpn',network,sourceRanges:['0.0.0.0/0'],
          targetTags:[n],allowed:[{IPProtocol:'udp',ports:['51820']}]}),req('GET',b+'/global/firewalls/'+n+'-vpn'),
          ()=>({id:n+'-vpn'}),null,req('DELETE',b+'/global/firewalls/'+n+'-vpn')),
        named('address',region+'/addresses',{name:n,addressType:'EXTERNAL',networkTier:'PREMIUM'},b=>!!b.address),
        known('server',req('POST',zone+'/instances',{name:n,machineType:zone+'/machineTypes/'+enc(p.size),tags:{items:[n]},
          disks:[{boot:true,autoDelete:true,initializeParams:{sourceImage:'projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64',diskSizeGb:'20'}}],
          networkInterfaces:[{network,accessConfigs:[{name:'External NAT',type:'ONE_TO_ONE_NAT',natIP:R('address','host'),networkTier:'PREMIUM'}]}],
          metadata:{items:[{key:'ssh-keys',value:'ubuntu:'+s.publicKey},{key:'enable-oslogin',value:'FALSE'},{key:'block-project-ssh-keys',value:'TRUE'}]}}),
          req('GET',zone+'/instances/'+n),()=>({id:n,name:n,host:R('address','host')}),b=>b.status==='RUNNING',req('DELETE',zone+'/instances/'+n))];
    }
    if (s.provider === 'aws') {
      const b='https://lightsail.'+p.region+'.amazonaws.com/';
      const aws=(action,body)=>req('POST',b,body,{headers:{'Content-Type':'application/x-amz-json-1.1','X-Amz-Target':'Lightsail_20161128.'+action},
        readOnly:action.startsWith('Get'),auth:{scheme:'aws',credentialRef:s.credentialRef,service:'lightsail',region:p.region}});
      return [known('key',aws('ImportKeyPair',{keyPairName:n,publicKeyBase64:b64(s.publicKey)}),aws('GetKeyPair',{keyPairName:n}),
          ()=>({id:n}),null,aws('DeleteKeyPair',{keyPairName:n})),
        known('address',aws('AllocateStaticIp',{staticIpName:n}),aws('GetStaticIp',{staticIpName:n}),
          b=>({id:n,host:get(b,'staticIp.ipAddress')}),b=>!!get(b,'staticIp.ipAddress'),aws('ReleaseStaticIp',{staticIpName:n})),
        known('server',aws('CreateInstances',{instanceNames:[n],availabilityZone:p.zone,blueprintId:'ubuntu_24_04',bundleId:p.size,
          keyPairName:n,userData:cloudInit(s),tags:[{key:'mobile-ssh',value:n}]}),aws('GetInstance',{instanceName:n}),
          ()=>({id:n,name:n,host:R('address','host')}),b=>get(b,'instance.state.name')==='running',aws('DeleteInstance',{instanceName:n})),
        known('firewall',aws('PutInstancePublicPorts',{instanceName:n,portInfos:[{fromPort:22,toPort:22,protocol:'tcp',cidrs:[p.sshCidr]},
          {fromPort:51820,toPort:51820,protocol:'udp',cidrs:['0.0.0.0/0']}]}),aws('GetInstancePortStates',{instanceName:n}),
          ()=>({id:n}),b=>list(b,'portStates').some(x=>x.fromPort===51820),null),
        known('attachment',aws('AttachStaticIp',{staticIpName:n,instanceName:n}),aws('GetStaticIp',{staticIpName:n}),
          ()=>({id:n,host:R('address','host')}),b=>get(b,'staticIp.attachedTo')===n,aws('DetachStaticIp',{staticIpName:n}))];
    }
    if (s.provider === 'azure') {
      const b='https://management.azure.com/subscriptions/'+enc(p.subscriptionId), group=b+'/resourceGroups/'+n;
      const network=group+'/providers/Microsoft.Network', compute=group+'/providers/Microsoft.Compute';
      const arm=(key,path,body,version='2024-05-01')=>known(key,req('PUT',path+'?api-version='+version,body),
        req('GET',path+'?api-version='+version),b=>({id:b.id||path,name:n,host:get(b,'properties.ipAddress')}),
        b=>!get(b,'properties.provisioningState')||get(b,'properties.provisioningState')==='Succeeded',null);
      return [known('group',req('PUT',group+'?api-version=2022-09-01',{location:p.region,tags:{'mobile-ssh':n}}),
        req('GET',group+'?api-version=2022-09-01'),()=>({id:group}),null,req('DELETE',group+'?api-version=2022-09-01')),
        arm('firewall',network+'/networkSecurityGroups/'+n,{location:p.region,properties:{securityRules:[
          {name:'ssh',properties:{priority:100,protocol:'Tcp',access:'Allow',direction:'Inbound',sourceAddressPrefix:p.sshCidr,sourcePortRange:'*',destinationAddressPrefix:'*',destinationPortRange:'22'}},
          {name:'wireguard',properties:{priority:110,protocol:'Udp',access:'Allow',direction:'Inbound',sourceAddressPrefix:'Internet',sourcePortRange:'*',destinationAddressPrefix:'*',destinationPortRange:'51820'}}]}}),
        arm('network',network+'/virtualNetworks/'+n,{location:p.region,properties:{addressSpace:{addressPrefixes:['10.16.0.0/16']},subnets:[{name:'vpn',properties:{addressPrefix:'10.16.1.0/24'}}]}}),
        arm('address',network+'/publicIPAddresses/'+n,{location:p.region,sku:{name:'Standard'},properties:{publicIPAllocationMethod:'Static',publicIPAddressVersion:'IPv4'}}),
        arm('nic',network+'/networkInterfaces/'+n,{location:p.region,properties:{networkSecurityGroup:{id:R('firewall')},ipConfigurations:[{name:'vpn',properties:{privateIPAllocationMethod:'Dynamic',subnet:{id:R('network')+'/subnets/vpn'},publicIPAddress:{id:R('address')}}}]}}),
        arm('server',compute+'/virtualMachines/'+n,{location:p.region,tags:{'mobile-ssh':n},properties:{hardwareProfile:{vmSize:p.size},
          storageProfile:{imageReference:{publisher:'Canonical',offer:'ubuntu-24_04-lts',sku:'server',version:'latest'},osDisk:{createOption:'FromImage',deleteOption:'Delete',managedDisk:{storageAccountType:'StandardSSD_LRS'}}},
          osProfile:{computerName:n,adminUsername:'ubuntu',linuxConfiguration:{disablePasswordAuthentication:true,ssh:{publicKeys:[{path:'/home/ubuntu/.ssh/authorized_keys',keyData:s.publicKey}]}}},
          networkProfile:{networkInterfaces:[{id:R('nic'),properties:{deleteOption:'Delete'}}]}}},'2024-07-01')];
    }
    return otherGraph(s, req, known, simple, R);
  }

  /* Remaining providers keep their native resource identifiers; no cloud CLI
     or credentials are ever placed in cloud-init or on the VPN machine. */
  function otherGraph(s, req, known, simple, R) {
    const p=s.inputs,n=s.name;
    if(s.provider==='linode') {
      const b='https://api.linode.com/v4';
      return [known('server',req('POST',b+'/linode/instances',{label:n,region:p.region,type:p.size,image:'linode/ubuntu24.04',
        authorized_keys:[s.publicKey],booted:true,tags:[n],metadata:{user_data:b64(cloudInit(s))}},{secretBody:{root_pass:'generatedPassword'}}),req('GET',b+'/linode/instances/'+R('server')),
        b=>({id:b.id,name:n,host:list(b,'ipv4').find(ip=>!ip.startsWith('192.168.'))}),b=>b.status==='running',
        req('DELETE',b+'/linode/instances/'+R('server')),Object.assign(req('GET',b+'/linode/instances'),{match:match('data','label',n)})),
        simple('firewall',b+'/networking/firewalls',{label:n,rules:{inbound_policy:'DROP',outbound_policy:'ACCEPT',inbound:[
          {label:'ssh',action:'ACCEPT',protocol:'TCP',ports:'22',addresses:{ipv4:[p.sshCidr]}},
          {label:'wireguard',action:'ACCEPT',protocol:'UDP',ports:'51820',addresses:{ipv4:['0.0.0.0/0']}}]},devices:{linodes:[R('server')]}},'','data','label')];
    }
    if(s.provider==='vultr') {
      const b='https://api.vultr.com/v2';
      return [simple('key',b+'/ssh-keys',{name:n,ssh_key:s.publicKey},'ssh_key','ssh_keys'),
        simple('firewall',b+'/firewalls',{description:n},'firewall_group','firewall_groups','description'),
        known('sshRule',req('POST',b+'/firewalls/'+R('firewall')+'/rules',{ip_type:'v4',protocol:'tcp',port:'22',subnet:p.sshCidr.split('/')[0],subnet_size:Number(p.sshCidr.split('/')[1]),notes:n+'-ssh'}),
          req('GET',b+'/firewalls/'+R('firewall')+'/rules'),b=>({id:get(b,'firewall_rule.id')}),null,null,
          Object.assign(req('GET',b+'/firewalls/'+R('firewall')+'/rules'),{match:match('firewall_rules','notes',n+'-ssh')})),
        known('vpnRule',req('POST',b+'/firewalls/'+R('firewall')+'/rules',{ip_type:'v4',protocol:'udp',port:'51820',subnet:'0.0.0.0',subnet_size:0,notes:n+'-vpn'}),
          req('GET',b+'/firewalls/'+R('firewall')+'/rules'),b=>({id:get(b,'firewall_rule.id')}),null,null,
          Object.assign(req('GET',b+'/firewalls/'+R('firewall')+'/rules'),{match:match('firewall_rules','notes',n+'-vpn')})),
        known('server',req('POST',b+'/instances',{label:n,hostname:n,region:p.region,plan:p.size,os_id:Number(p.imageId),sshkey_id:[R('key')],
          firewall_group_id:R('firewall'),enable_ipv6:false,tags:[n],user_data:b64(cloudInit(s))}),req('GET',b+'/instances/'+R('server')),
          b=>({id:get(b,'instance.id'),name:n,host:get(b,'instance.main_ip')}),b=>get(b,'instance.status')==='active'&&get(b,'instance.server_status')==='ok',
          req('DELETE',b+'/instances/'+R('server')),Object.assign(req('GET',b+'/instances'),{match:match('instances','label',n)}))];
    }
    if(s.provider==='oci') {
      const b='https://iaas.'+p.region+'.oraclecloud.com/20160918', compartmentId=p.compartmentId;
      const oci=(key,path,body,ready)=>known(key,req('POST',b+path,{compartmentId,displayName:n,...body}),req('GET',b+path+'/'+R(key)),
        x=>({id:x.id,name:n,host:x.ipAddress}),ready|| (x=>!x.lifecycleState||['AVAILABLE','RUNNING','ASSIGNED','ATTACHED'].includes(x.lifecycleState)),
        req('DELETE',b+path+'/'+R(key)+(key==='server'?'?preserveBootVolume=false':'')),Object.assign(req('GET',b+path+'?compartmentId='+enc(compartmentId)+(key==='address'?'&scope=REGION':'')),{match:match('','displayName',n)}));
      return [oci('network','/vcns',{cidrBlocks:['10.16.0.0/16'],dnsLabel:'mssh'+n.slice(-8).replace(/-/g,'')}),
        oci('gateway','/internetGateways',{vcnId:R('network'),isEnabled:true}),
        oci('route','/routeTables',{vcnId:R('network'),routeRules:[{destination:'0.0.0.0/0',destinationType:'CIDR_BLOCK',networkEntityId:R('gateway')}]}),
        oci('firewall','/securityLists',{vcnId:R('network'),egressSecurityRules:[{destination:'0.0.0.0/0',protocol:'all'}],ingressSecurityRules:[
          {source:p.sshCidr,protocol:'6',tcpOptions:{destinationPortRange:{min:22,max:22}}},
          {source:'0.0.0.0/0',protocol:'17',udpOptions:{destinationPortRange:{min:51820,max:51820}}}]}),
        oci('subnet','/subnets',{vcnId:R('network'),cidrBlock:'10.16.1.0/24',routeTableId:R('route'),securityListIds:[R('firewall')],prohibitPublicIpOnVnic:false}),
        oci('server','/instances',{availabilityDomain:p.zone,shape:p.size,shapeConfig:{ocpus:1,memoryInGBs:2},
          sourceDetails:{sourceType:'image',imageId:p.imageId},createVnicDetails:{subnetId:R('subnet'),assignPublicIp:false},metadata:{ssh_authorized_keys:s.publicKey}},x=>x.lifecycleState==='RUNNING'),
        known('vnic',req('GET',b+'/vnicAttachments?compartmentId='+enc(compartmentId)+'&instanceId='+enc(R('server'))),
          req('GET',b+'/vnicAttachments?compartmentId='+enc(compartmentId)+'&instanceId='+enc(R('server'))),
          x=>({id:get(x,'0.vnicId')}),x=>!!get(x,'0.vnicId'),null),
        known('privateIp',req('GET',b+'/privateIps?vnicId='+enc(R('vnic'))),req('GET',b+'/privateIps?vnicId='+enc(R('vnic'))),
          x=>({id:get(x,'0.id')}),x=>!!get(x,'0.id'),null),
        oci('address','/publicIps',{lifetime:'RESERVED',privateIpId:R('privateIp')},x=>!!x.ipAddress)];
    }
    if(s.provider==='ovh') {
      const base='https://'+(p.endpoint==='ca'?'ca.api.ovh.com':p.endpoint==='us'?'api.us.ovhcloud.com':'eu.api.ovh.com');
      const b=base+'/1.0/cloud/project/'+enc(p.projectId),v2=base+'/v2/publicCloud/project/'+enc(p.projectId);
      return [simple('key',b+'/sshkey',{name:n,publicKey:s.publicKey},'',''),
        known('firewall',req('POST',v2+'/securityGroup',{targetSpec:{name:n,description:n,location:{region:p.region},rules:[
          {direction:'INGRESS',ethernetType:'IPV4',protocol:'TCP',portRangeMin:22,portRangeMax:22,remoteIpPrefix:p.sshCidr},
          {direction:'INGRESS',ethernetType:'IPV4',protocol:'UDP',portRangeMin:51820,portRangeMax:51820,remoteIpPrefix:'0.0.0.0/0'},
          {direction:'EGRESS',ethernetType:'IPV4',protocol:'TCP',portRangeMin:1,portRangeMax:65535,remoteIpPrefix:'0.0.0.0/0'},
          {direction:'EGRESS',ethernetType:'IPV4',protocol:'UDP',portRangeMin:1,portRangeMax:65535,remoteIpPrefix:'0.0.0.0/0'},
          {direction:'EGRESS',ethernetType:'IPV4',protocol:'ICMP',remoteIpPrefix:'0.0.0.0/0'}]}}),
          req('GET',v2+'/securityGroup/'+R('firewall')),x=>({id:x.id,name:n}),x=>x.resourceStatus==='READY',
          req('DELETE',v2+'/securityGroup/'+R('firewall')),Object.assign(req('GET',v2+'/securityGroup'),{match:match('','currentState.name',n)})),
        known('server',req('POST',v2+'/compute/instance',{targetSpec:{name:n,location:{region:p.region},flavor:{id:p.size},
          image:{id:p.imageId},sshKeyName:R('key','name')||n,powerState:'ACTIVE',networks:[{autoAssignPublicIp:true}],securityGroups:[{id:R('firewall')}],userData:b64(cloudInit(s))}}),
          req('GET',v2+'/compute/instance/'+R('server')),
          x=>({id:x.id,name:n,host:list(x,'currentState.networks').filter(net=>!net.id).flatMap(net=>net.addresses||[]).find(ip=>ip.version===4)?.ip}),
          x=>x.resourceStatus==='READY'&&get(x,'currentState.powerState')==='ACTIVE',req('DELETE',v2+'/compute/instance/'+R('server')),
          Object.assign(req('GET',v2+'/compute/instance'),{match:match('','currentState.name',n)}))];
    }
    if(s.provider==='scaleway') {
      const b='https://api.scaleway.com/instance/v1/zones/'+enc(p.zone);
      return [simple('key','https://api.scaleway.com/iam/v1alpha1/ssh-keys',{name:n,public_key:s.publicKey,project_id:p.projectId},'','ssh_keys'),
        simple('firewall',b+'/security_groups',{name:n,project:p.projectId,inbound_default_policy:'drop',outbound_default_policy:'accept',stateful:true},'security_group','security_groups'),
        known('sshRule',req('POST',b+'/security_groups/'+R('firewall')+'/rules',{protocol:'TCP',direction:'inbound',action:'accept',ip_range:p.sshCidr,dest_port_from:22,dest_port_to:22,position:1}),
          req('GET',b+'/security_groups/'+R('firewall')+'/rules'),x=>({id:get(x,'rule.id')}),null,null,
          Object.assign(req('GET',b+'/security_groups/'+R('firewall')+'/rules'),{match:match('rules','dest_port_from',22)})),
        known('vpnRule',req('POST',b+'/security_groups/'+R('firewall')+'/rules',{protocol:'UDP',direction:'inbound',action:'accept',ip_range:'0.0.0.0/0',dest_port_from:51820,dest_port_to:51820,position:2}),
          req('GET',b+'/security_groups/'+R('firewall')+'/rules'),x=>({id:get(x,'rule.id')}),null,null,
          Object.assign(req('GET',b+'/security_groups/'+R('firewall')+'/rules'),{match:match('rules','dest_port_from',51820)})),
        known('address',req('POST',b+'/ips',{project:p.projectId,tags:[n],type:'routed_ipv4'}),req('GET',b+'/ips/'+R('address')),
          x=>({id:get(x,'ip.id'),host:get(x,'ip.address')}),x=>!!get(x,'ip.address'),req('DELETE',b+'/ips/'+R('address')),
          Object.assign(req('GET',b+'/ips?project='+enc(p.projectId)),{match:match('ips','tags.0',n)})),
        known('server',req('POST',b+'/servers',{name:n,project:p.projectId,commercial_type:p.size,image:p.imageId,
          public_ips:[R('address')],dynamic_ip_required:false,routed_ip_enabled:true,security_group:R('firewall'),tags:[n]}),
          req('GET',b+'/servers/'+R('server')),x=>({id:get(x,'server.id'),name:n,host:get(x,'server.public_ip.address'),volumes:get(x,'server.volumes',{})}),
          x=>!!get(x,'server.id'),req('DELETE',b+'/servers/'+R('server')),
          Object.assign(req('GET',b+'/servers?name='+enc(n)),{match:match('servers','name',n)})),
        known('power',req('POST',b+'/servers/'+R('server')+'/action',{action:'poweron'}),req('GET',b+'/servers/'+R('server')),
          ()=>({id:R('server')}),x=>get(x,'server.state')==='running',req('POST',b+'/servers/'+R('server')+'/action',{action:'poweroff'}))];
    }
    throw new Error('Unsupported provider');
  }

  function preflight(s) {
    const p=s.inputs,req=(url)=>request(s,'GET',url), checks=[];
    const check=(label,request,validate)=>checks.push({label,request,validate:validate||(()=>true)});
    if(s.provider==='gcp') {
      const b='https://compute.googleapis.com/compute/v1/projects/'+enc(p.projectId);
      check('Machine type',req(b+'/zones/'+enc(p.zone)+'/machineTypes/'+enc(p.size)),b=>b.name===p.size);
      check('Ubuntu image',req('https://compute.googleapis.com/compute/v1/projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64'),b=>b.status==='READY');
    } else if(s.provider==='aws') {
      const aws=(action,body)=>request(s,'POST','https://lightsail.'+p.region+'.amazonaws.com/',body,{readOnly:true,
        headers:{'Content-Type':'application/x-amz-json-1.1','X-Amz-Target':'Lightsail_20161128.'+action},
        auth:{scheme:'aws',credentialRef:s.credentialRef,service:'lightsail',region:p.region}});
      check('Lightsail bundle',aws('GetBundles',{includeInactive:false}),b=>list(b,'bundles').some(x=>x.bundleId===p.size&&x.isActive));
      check('Ubuntu image',aws('GetBlueprints',{includeInactive:false}),b=>list(b,'blueprints').some(x=>x.blueprintId==='ubuntu_24_04'&&x.isActive));
      check('Availability zone',aws('GetRegions',{includeAvailabilityZones:true}),b=>list(b,'regions').some(x=>x.name===p.region&&(x.availabilityZones||[]).some(z=>z.zoneName===p.zone)));
    } else if(s.provider==='azure') {
      check('Subscription',req('https://management.azure.com/subscriptions/'+enc(p.subscriptionId)+'?api-version=2022-12-01'),b=>b.state==='Enabled');
      check('VM size',req('https://management.azure.com/subscriptions/'+enc(p.subscriptionId)+'/providers/Microsoft.Compute/locations/'+enc(p.region)+'/vmSizes?api-version=2024-07-01'),b=>list(b,'value').some(x=>x.name===p.size));
    } else if(s.provider==='digitalocean') {
      check('Droplet region and size',req('https://api.digitalocean.com/v2/sizes?per_page=200'),b=>list(b,'sizes').some(x=>x.slug===p.size&&x.available&&(x.regions||[]).includes(p.region)));
      check('Ubuntu image',req('https://api.digitalocean.com/v2/images/ubuntu-24-04-x64'),b=>!!get(b,'image.id'));
    } else if(s.provider==='hetzner') {
      check('Server type in selected location',req('https://api.hetzner.cloud/v1/server_types?name='+enc(p.size)),b=>list(b,'server_types').some(x=>{
        if(x.name!==p.size||x.architecture!=='x86')return false;
        // Older API snapshots omit locations entirely. Current responses must
        // explicitly advertise capacity in the selected location; availability
        // elsewhere, a missing entry or a malformed flag does not authorize it.
        if(!Object.prototype.hasOwnProperty.call(x,'locations'))return true;
        return Array.isArray(x.locations)&&x.locations.some(location=>location&&location.name===p.region&&location.available===true);
      }));
      check('Location',req('https://api.hetzner.cloud/v1/locations?name='+enc(p.region)),b=>list(b,'locations').some(x=>x.name===p.region));
    } else if(s.provider==='linode') {
      check('Instance plan',req('https://api.linode.com/v4/linode/types/'+enc(p.size)),b=>b.id===p.size);
      check('Ubuntu image',req('https://api.linode.com/v4/images/linode/ubuntu24.04'),b=>b.id==='linode/ubuntu24.04');
      check('Region',req('https://api.linode.com/v4/regions/'+enc(p.region)),b=>b.status==='ok');
    } else if(s.provider==='vultr') {
      check('Ubuntu image',req('https://api.vultr.com/v2/os?per_page=500'),b=>list(b,'os').some(x=>String(x.id)===p.imageId&&/ubuntu/i.test(x.name)&&/24\.04/.test(x.name)&&x.arch==='x64'));
      check('Instance plan',req('https://api.vultr.com/v2/plans?per_page=500'),b=>list(b,'plans').some(x=>x.id===p.size&&(x.locations||[]).includes(p.region)));
    } else if(s.provider==='oci') {
      check('Ubuntu image',req('https://iaas.'+p.region+'.oraclecloud.com/20160918/images/'+enc(p.imageId)),b=>/ubuntu/i.test(b.operatingSystem||'')&&/24\.04/.test(b.operatingSystemVersion||''));
      check('Instance shape',req('https://iaas.'+p.region+'.oraclecloud.com/20160918/shapes?compartmentId='+enc(p.compartmentId)+'&availabilityDomain='+enc(p.zone)+'&imageId='+enc(p.imageId)),b=>Array.isArray(b)&&b.some(x=>x.shape===p.size));
    } else if(s.provider==='ovh') {
      const base='https://'+(p.endpoint==='ca'?'ca.api.ovh.com':p.endpoint==='us'?'api.us.ovhcloud.com':'eu.api.ovh.com')+'/1.0/cloud/project/'+enc(p.projectId);
      check('Ubuntu image',req(base+'/image?region='+enc(p.region)),b=>Array.isArray(b)&&b.some(x=>x.id===p.imageId&&/ubuntu/i.test(x.name)&&/24\.04/.test(x.name)));
      check('Instance flavor',req(base+'/flavor?region='+enc(p.region)),b=>Array.isArray(b)&&b.some(x=>x.id===p.size&&x.available!==false));
    } else if(s.provider==='scaleway') {
      const b='https://api.scaleway.com/instance/v1/zones/'+enc(p.zone);
      check('Ubuntu image',req(b+'/images/'+enc(p.imageId)),x=>get(x,'image.arch')==='x86_64'&&/ubuntu/i.test(get(x,'image.name',''))&&/24\.04|noble/i.test(get(x,'image.name','')));
      check('Instance type',req(b+'/products/servers'),x=>!!get(x,'servers.'+p.size));
    }
    return checks;
  }

  const field=(key,label,defaultValue,extra)=>Object.assign({key,label,type:'string',required:true},defaultValue===undefined?{}:{default:defaultValue},extra||{});
  const secret=(key,label)=>field(key,label,undefined,{type:'secret'});
  const CREDENTIALS={
    gcp:[secret('serviceAccountJson','Service account JSON key')],
    aws:[secret('accessKeyId','Access key ID'),secret('secretAccessKey','Secret access key'),field('sessionToken','Session token','',{type:'secret',required:false})],
    azure:[field('tenantId','Tenant ID'),field('clientId','Application / client ID'),secret('clientSecret','Client secret')],
    digitalocean:[secret('token','Personal access token')],hetzner:[secret('token','Read/write API token')],linode:[secret('token','Personal access token')],vultr:[secret('apiKey','API key')],
    oci:[field('tenancyId','Tenancy OCID'),field('userId','User OCID'),field('fingerprint','API key fingerprint'),secret('privateKey','API signing private key (PEM)')],
    ovh:[secret('applicationKey','Application key'),secret('applicationSecret','Application secret'),secret('consumerKey','Consumer key')],
    scaleway:[secret('secretKey','API secret key')]
  };
  const OPTIONS={
    gcp:[field('projectId','Project ID'),field('region','Region','us-central1'),field('zone','Zone','us-central1-a'),field('size','Machine type','e2-small')],
    aws:[field('region','Region','us-east-1'),field('zone','Availability zone','us-east-1a'),field('size','Lightsail bundle','micro_3_0')],
    azure:[field('subscriptionId','Subscription ID'),field('region','Region','eastus'),field('size','VM size','Standard_B1s')],
    digitalocean:[field('region','Region','nyc3'),field('size','Droplet size','s-1vcpu-1gb')],
    hetzner:[field('region','Location','fsn1'),field('size','Server type','cx23')],
    linode:[field('region','Region','us-east'),field('size','Plan','g6-nanode-1')],
    vultr:[field('region','Region','ewr'),field('size','Plan','vc2-1c-1gb'),field('imageId','Ubuntu 24.04 OS ID')],
    oci:[field('compartmentId','Compartment OCID'),field('region','Region','us-ashburn-1'),field('zone','Availability domain'),field('size','Flex shape','VM.Standard.E4.Flex'),field('imageId','Ubuntu 24.04 amd64 image OCID')],
    ovh:[field('projectId','Public Cloud project ID'),field('endpoint','API account region','eu',{type:'select',options:['eu','ca','us'].map(value=>({value,label:value.toUpperCase()}))}),field('region','Cloud region','GRA11'),field('size','Flavor ID'),field('imageId','Ubuntu 24.04 image ID')],
    scaleway:[field('projectId','Project UUID'),field('zone','Zone','fr-par-1'),field('size','Commercial type','DEV1-S'),field('imageId','Ubuntu 24.04 image UUID')]
  };

  function output(s, step) { s.pending = step ? step.id : null; return {state:s,step:step || {kind:'complete',id:s.deploymentId+'-done',result:{deploymentId:s.deploymentId,status:s.phase}}}; }
  function input(s, form, title, fields, more) {
    return output(s,Object.assign({kind:'input',id:s.deploymentId+'-'+s.phase,form,title,fields:fields||[]},more||{}));
  }
  function http(s, req, stage) {
    s.httpStage=stage;
    return output(s,Object.assign({kind:'http',id:s.deploymentId+'-'+s.phase+'-'+s.index+'-'+stage+'-'+s.attempt},req));
  }
  function pause(s,message) { if(s.phase!=='recovery')s.interruptedPhase=s.phase;s.error={code:'workflow_failed',message};s.phase='recovery';return render(s); }
  function body(event) {
    const raw=get(event,'result.body',event.result||{});
    if(typeof raw==='string') { try{return JSON.parse(raw);}catch(_){return raw;} }
    return raw;
  }
  function recoveryBody(op,b) {
    const m=get(op,'create.reconcile.match');
    if(!m) return b;
    const values=get(b,m.path);
    if(Array.isArray(values)) {
      const found=values.filter(x=>get(x,m.field)===m.value);
      if(found.length!==1) return null;
      // Reconstruct single-resource envelopes expected by provider extractors.
      const envelope={droplets:'droplet',ssh_keys:'ssh_key',firewalls:'firewall',servers:'server',reserved_ips:'reserved_ip',
        firewall_groups:'firewall_group',instances:'instance',security_groups:'security_group',ips:'ip',primary_ips:'primary_ip',rules:'rule',firewall_rules:'firewall_rule'}[m.path];
      return envelope?{[envelope]:found[0]}:found[0];
    }
    return get(values,m.field)===m.value?b:null;
  }
  function confirmedAbsent(op,b) {
    const m=get(op,'create.reconcile.match');
    if(!m)return false;
    const values=get(b,m.path);
    return Array.isArray(values)&&values.filter(x=>get(x,m.field)===m.value).length===0;
  }
  // A first page is not proof of absence or uniqueness. Native HTTP preserves
  // continuation headers; fail closed rather than recreate a potentially billed VM.
  function incompleteList(s,b,response,values,url) {
    if(!Array.isArray(values))return false;
    const headers=get(response,'headers',{});
    if(headers['opc-next-page']||headers['x-pagination-cursor-next']||
      /(?:^|[,;])\s*rel\s*=\s*["']?next(?:["';,\s]|$)/i.test(headers.link||''))return true;
    if(get(b,'links.pages.next')||get(b,'meta.links.next')||get(b,'links.next')||
      get(b,'meta.pagination.next_page')||get(b,'next_page')||get(b,'nextPageToken')||get(b,'next_token'))return true;
    if(Number(get(b,'pages',1))>Number(get(b,'page',1))||
      Number(get(b,'meta.pagination.last_page',1))>Number(get(b,'meta.pagination.page',1)))return true;
    const counts=[headers['x-total-count'],get(b,'total_count'),get(b,'totalCount'),get(b,'results'),
      get(b,'meta.total'),get(b,'meta.pagination.total_entries')].filter(x=>x!==undefined&&x!==null&&x!=='').map(Number);
    if(counts.some(n=>Number.isFinite(n)&&n>values.length))return true;
    if(counts.some(n=>Number.isFinite(n)&&n===values.length))return false;
    // If pagination metadata is absent, a full default/requested page is still
    // ambiguous. Small fixtures and documented nonpaginated lists remain usable.
    const requested=String(url||'').match(/[?&](?:per_page|page_size|limit)=([0-9]+)/);
    const limit=requested?Number(requested[1]):Number(headers['x-pagination-limit'])||
      ({digitalocean:20,hetzner:25,linode:100,vultr:100,scaleway:50,oci:1000,ovh:50}[s.provider]||1000);
    return values.length>=limit;
  }
  function notFound(s,status,b) {
    const code=get(b,'__type',get(b,'code',get(b,'error.code','')));
    return status===404||(s.provider==='aws'&&status===400&&/(^|[.#:])NotFoundException$/.test(String(code)));
  }
  // Pause text for a provider error. Bodies are untrusted: keep only an identifier-like
  // code and the structured error object's message, without token-like runs and capped.
  // Response headers are never read; other free-form body text stays out of the journal.
  function providerError(status,b) {
    const e=get(b,'error',{}),code=[get(e,'code'),get(e,'status'),get(b,'__type'),get(b,'code'),get(b,'type'),get(b,'id')]
      .find(x=>typeof x==='string'&&/^[A-Za-z0-9_.:#-]{1,64}$/.test(x));
    let text=typeof get(e,'message')==='string'?e.message.replace(/[A-Za-z0-9+/=_-]{24,}/g,'[redacted]').replace(/[\s\u0000-\u001f\u007f]+/g,' ').trim():'';
    if(text.length>120)text=text.slice(0,117)+'...';
    return 'HTTP '+status+(code?', '+code:'')+(text?': '+text:'');
  }
  // Hetzner keeps a firewall applied, or a resource locked by a running action, for a
  // short time after its server is gone. Repeating the DELETE is safe and stays within
  // the polling limit. The primary IPv4 already waits for a verified detach instead.
  function busyDelete(s,op,status,b) {
    const code=get(b,'error.code');
    return s.provider==='hetzner'&&s.httpStage==='delete'&&op.key!=='address'&&
      ((status===422&&code==='resource_in_use')||((status===409||status===423)&&(code==='locked'||code==='conflict')));
  }
  function absentCreation(s) {
    if(s.allowRecreate){delete s.allowRecreate;delete s.creationAbsent;s.httpStage='create';return render(s);}
    s.creationAbsent=true;
    return pause(s,'No matching cloud resource was found. Review the cloud console before approving a new creation attempt.');
  }
  function cleanInputs(provider,value) {
    const result={};
    for(const f of OPTIONS[provider]||[]) { const v=value[f.key]===undefined?f.default:value[f.key]; if(f.required&&!v)throw new Error(f.label+' is required');result[f.key]=String(v||'').trim(); }
    const cidr=String(value.sshCidr||'').trim();
    const parts=cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
    if(!parts||parts.slice(1,5).some(x=>Number(x)>255)||Number(parts[5])>32)throw new Error('SSH source must be an IPv4 CIDR');
    result.sshCidr=cidr;
    for(const [key,val] of Object.entries(result)) if(key!=='sshCidr'&&!/^[a-zA-Z0-9_.:-]{1,256}$/.test(val))throw new Error('Invalid '+key);
    return result;
  }
  function ssh(s,operation) {
    return output(s,{kind:'ssh',id:s.deploymentId+'-'+operation+'-'+(s.clientSequence||0),operation,deploymentId:s.deploymentId,
      host:s.host,port:22,user:s.user,credentialRef:s.sshCredentialRef,
      args:{image:IMAGE,endpoint:s.host,udpPort:51820,clientKey:s.deploymentId+'-'+(s.clientSequence||0),clientId:s.targetClientId}});
  }
  // Native receipts carry only a plain x.y.z version and booleans; anything else is left out.
  // An update reports no clients, so the last check's list stays. target is the release this bundle installs.
  function health(s,b) {
    const value={healthy:b.healthy===true,clients:Array.isArray(b.clients)?b.clients:s.phase==='update'?list(s,'health.clients'):[],target:RELEASE};
    if(typeof b.version==='string'&&/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(b.version))value.version=b.version;
    for(const key of ['current','updated'])if(typeof b[key]==='boolean')value[key]=b[key];
    return value;
  }
  function render(s) {
    if(s.phase==='provider')return input(s,'provider','Where should your VPN run?',[
      field('provider','Cloud provider','digitalocean',{type:'select',options:Object.keys(PROVIDERS).map(value=>({value,label:PROVIDERS[value][0]}))})]);
    if(s.phase==='mode')return input(s,'choice','How would you like to create the server?',[
      field('mode','Setup method','automatic',{type:'select',options:[{value:'automatic',label:'Create with cloud API'},{value:'manual',label:'Create in cloud console'}]})]);
    if(s.phase==='credential')return input(s,'credential','Connect '+PROVIDERS[s.provider][0],CREDENTIALS[s.provider],{provider:s.provider,persistent:true,guide:'guides/'+s.provider+'.md'});
    if(s.phase==='sshKey')return input(s,'sshKey','Select or create the server SSH key',[],{provider:s.provider,algorithm:s.provider==='aws'?'rsa':'ed25519',guide:'guides/'+s.provider+'.md'});
    if(s.phase==='options'){
      const fields=[...OPTIONS[s.provider],field('sshCidr','Allow SSH from IPv4 CIDR','0.0.0.0/0')],current=fields[s.optionIndex||0];
      return input(s,'instance',current.label,[Object.assign({},current,s.inputs[current.key]?{default:s.inputs[current.key]}:{})],{id:s.deploymentId+'-options-'+(s.optionIndex||0),guide:'guides/'+s.provider+'.md',pricingUrl:PROVIDERS[s.provider][1]});
    }
    if(s.phase==='manual')return input(s,'instance','Create Ubuntu 24.04 using the console guide',[
      field('host','Public IPv4 address')],{guide:'guides/'+s.provider+'.md',publicKey:s.publicKey});
    if(s.phase==='manualUser')return input(s,'instance','Which SSH user should connect?',[
      field('user','SSH user',PROVIDERS[s.provider][2])],{guide:'guides/'+s.provider+'.md'});
    if(s.phase==='confirm')return input(s,'confirm','Review VPN setup',[],{summary:{provider:PROVIDERS[s.provider][0],name:s.name,
      settings:s.inputs,host:s.host,verified:s.verified||[],pricingUrl:PROVIDERS[s.provider][1],billing:'Cloud billing continues until its resources are deleted. Public IPv4 and bandwidth may be charged separately.'}});
    if(s.phase==='preflight') {
      const check=preflight(s)[s.preflightIndex||0];
      if(!check){s.phase='confirm';return render(s);}
      return output(s,{kind:'http',id:s.deploymentId+'-preflight-'+(s.preflightIndex||0),...check.request});
    }
    // An update job only updates or checks its server: the native host refuses any other step in it.
    if(s.phase==='recovery'&&s.operation==='update')return input(s,'recovery','Update needs attention',[field('action','Next step','health',{type:'select',options:[
      {value:'health',label:'Check server (changes nothing)'},{value:'retry',label:'Retry the update'},{value:'keep',label:'Stop here'}]})],{error:s.error});
    if(s.phase==='recovery')return input(s,'recovery','Setup needs attention',[field('action','Next step','reconcile',{type:'select',options:[
      {value:'reconcile',label:'Check current cloud state'},{value:'retry',label:'Retry reconciliation'},
      ...(s.creationAbsent?[{value:'recreate',label:'Review a new creation attempt'}]:[]),
      {value:'edit',label:'Change server settings'},...(s.mode==='automatic'&&CREDENTIALS[s.provider]?[{value:'account',label:'Update cloud account credentials'}]:[]),
      {value:'cleanup',label:'Review removal of created resources'},{value:'keep',label:'Keep resources and stop'}]})],{error:s.error,resources:s.resources});
    if(s.phase==='recreateConfirm')return input(s,'confirm','Approve a new creation attempt?',[],{summary:{provider:s.provider,name:s.name,
      resource:graph(s)[s.index].key,warning:'No matching resource was found. Check the cloud console for delayed creation before approving; a new resource can add charges.'}});
    if(s.phase==='deleteConfirm')return input(s,'confirm','Delete this deployment?',[],{destructive:true,summary:{deploymentId:s.deploymentId,
      provider:s.provider,host:s.host,resources:s.resources,warning:s.mode==='manual'
        ?'The VPN container, its data and local client profiles will be removed. Delete the VM, disks and public IP separately in your cloud console to stop their charges.'
        :'The VPN, clients and owned cloud resources will be removed. This cannot be undone.'}});
    if(s.phase==='clientConfirm')return input(s,'confirm',s.operation==='createClient'?'Register a new VPN client?':'Revoke this VPN client?',[],{
      destructive:s.operation==='revokeClient',summary:{deploymentId:s.deploymentId,host:s.host,clientId:s.targetClientId,operation:s.operation}});
    if(s.phase==='updateConfirm')return input(s,'confirm','Update WireGuard to '+RELEASE+'?',[],{summary:{deploymentId:s.deploymentId,host:s.host,operation:'update',version:RELEASE,
      warning:'Installs wg-easy '+RELEASE+' and restarts WireGuard on the server. Existing clients and VPN profiles stay. If this phone is connected through this server, its VPN is turned off first: reconnect when the update finishes. If the new version does not start, the previous one is restored.'}});
    if(s.phase==='provision') {
      const op=graph(s)[s.index];
      if(!op){s.host=s.host||get(s.resources,'address.host')||get(s.resources,'server.host');if(!s.host)return pause(s,'Cloud did not return a public IPv4 address');s.phase='bootstrap';return render(s);}
      if(op.key==='key'&&!s.keyChecked&&keyLookup(s))return http(s,request(s,'GET',keyLookup(s)[0]),'keyLookup');
      if(s.httpStage==='reconcile')return http(s,op.create.reconcile||op.read,'reconcile');
      return http(s,s.httpStage==='read'?op.read:op.create,s.httpStage==='read'?'read':'create');
    }
    if(s.phase==='wait'||s.phase==='cleanupWait'||s.phase==='extraWait')return output(s,{kind:'delay',id:s.deploymentId+'-'+s.phase+'-'+s.index+'-'+s.attempt,milliseconds:Math.min(30000,2000*Math.pow(2,Math.min(4,s.attempt))),delayMs:Math.min(30000,2000*Math.pow(2,Math.min(4,s.attempt)))});
    if(['bootstrap','health','createClient','revokeClient','update'].includes(s.phase))return ssh(s,s.phase);
    if(s.phase==='import')return output(s,{kind:'vpn.import',id:s.deploymentId+'-import-'+s.clientSequence,configRef:s.configRef,name:'VPN '+s.name,
      deploymentId:s.deploymentId,clientId:s.lastClientId});
    if(s.phase==='deleteServer')return ssh(s,'delete');
    if(s.phase==='cleanup') {
      const ops=graph(s);while(s.index>=0&&(!ops[s.index].remove||!s.resources[ops[s.index].key]||!s.resources[ops[s.index].key].owned||s.resources[ops[s.index].key].status==='deleted'))s.index--;
      if(s.index<0){for(const value of Object.values(s.resources))if(value.owned)value.status='deleted';s.phase='cleanupLocal';return render(s);}
      if(s.provider==='hetzner'&&ops[s.index].key==='address'&&['delete','deleteCheck'].includes(s.httpStage))
        return http(s,ops[s.index].read,'deleteCheck');
      return http(s,s.httpStage==='deleteRead'?ops[s.index].read:ops[s.index].remove,s.httpStage==='deleteRead'?'deleteRead':'delete');
    }
    if(s.phase==='cleanupLocal')return output(s,{kind:'vpn.cleanup',id:s.deploymentId+'-cleanup-local',deploymentId:s.deploymentId});
    if(s.phase==='cleanupExtra') {
      const item=s.extraCleanup[0];
      if(!item){s.phase='cleanup';s.httpStage='delete';return render(s);}
      const req=request(s,s.httpStage==='deleteRead'?'GET':'DELETE',item.url);
      if(req.method==='DELETE')req.reconcile=request(s,'GET',item.url);
      return http(s,req,s.httpStage==='deleteRead'?'deleteRead':'delete');
    }
    return output(s);
  }
  function next(snapshot,event) {
    let s=clone(snapshot||{});event=event||{type:'start'};
    if(!s.phase){
      const prior=get(s,'inputs.deployment');
      const operation=s.operation||'setup';
      if(prior){s=Object.assign(clone(prior),{operation,targetClientId:get(snapshot,'inputs.clientId'),pending:null,error:null});}
      s.version=1;s.operation=operation;s.deploymentId=s.deploymentId||get(snapshot,'inputs.deploymentId');
      if(!/^[a-zA-Z0-9_-]{1,64}$/.test(s.deploymentId||''))throw new Error('Native runner must supply a stable deploymentId');
      s.name=s.name||'mssh-'+s.deploymentId.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,20);
      s.resources=s.resources||{};s.inputs=s.inputs||{};s.index=0;s.attempt=0;s.clientSequence=s.clientSequence||0;
      if(operation==='setup')s.phase='provider';
      else if(operation==='delete')s.phase='deleteConfirm';
      else if(!s.host||!s.sshCredentialRef)throw new Error('Lifecycle operations require an owned deployment snapshot');
      else if(['health','createClient','revokeClient','update'].includes(operation)){s.phase=operation==='health'?'health':operation==='update'?'updateConfirm':'clientConfirm';if(operation==='createClient')s.clientSequence++;}
      else throw new Error('Unknown workflow operation');
      return render(s);
    }
    if(event.requestId&&event.requestId!==s.pending)throw new Error('Stale workflow response');
    if(event.type==='cancel'){s.suspendedPhase=s.phase;s.phase='cancelled';return output(s);}
    if(event.type==='error'){
      const failure=s.phase==='update'&&UPDATE_FAILURES[event.code];
      if(event.code==='UPDATE_RESTORE_FAILED'&&failure)delete s.health; // Its version line would describe a VPN that is down.
      return pause(s,failure||'The operation was interrupted. Check current state before retrying.');
    }
    if(event.type==='resume'){if(s.phase==='cancelled'&&s.suspendedPhase)s.phase=s.suspendedPhase;return render(s);}
    try {
      if(event.type==='input') {
        const v=event.value||{};
        if(s.phase==='provider'){if(!PROVIDERS[v.provider])throw new Error('Choose a supported provider');s.provider=v.provider;s.user=PROVIDERS[s.provider][2];s.phase=s.provider==='existing'?'sshKey':'mode';if(s.provider==='existing')s.mode='manual';}
        else if(s.phase==='mode'){s.mode=v.mode==='manual'?'manual':'automatic';s.phase=s.mode==='manual'?'sshKey':'credential';}
        else if(s.phase==='credential'){if(typeof v.credentialRef!=='string')throw new Error('A native credential reference is required');s.credentialRef=v.credentialRef;s.phase=s.accountResumePhase||(s.sshCredentialRef?'options':'sshKey');if(s.accountResumePhase==='provision')s.httpStage='reconcile';delete s.accountResumePhase;s.optionIndex=0;}
        else if(s.phase==='sshKey'){if(typeof v.credentialRef!=='string'||!/^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/.test(v.publicKey||'')||(s.provider==='aws'&&!v.publicKey.startsWith('ssh-rsa ')))throw new Error('Select a valid SSH key (RSA for Lightsail)');s.sshCredentialRef=v.credentialRef;s.publicKey=v.publicKey.split(/\s+/).slice(0,2).join(' ');s.phase=s.mode==='manual'?'manual':'options';}
        else if(s.phase==='options'){
          const fields=[...OPTIONS[s.provider],field('sshCidr','Allow SSH from IPv4 CIDR','0.0.0.0/0')],f=fields[s.optionIndex||0];
          const value=v[f.key]===undefined?f.default:v[f.key];if(f.required&&!value)throw new Error(f.label+' is required');
          s.inputs[f.key]=String(value||'').trim();
          if((s.optionIndex||0)+1===fields.length){s.inputs=cleanInputs(s.provider,s.inputs);s.preflightIndex=0;s.phase='preflight';}
          else s.optionIndex=(s.optionIndex||0)+1;
        }
        else if(s.phase==='manual'){if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(v.host||''))throw new Error('Enter public IPv4');s.host=v.host;s.phase='manualUser';}
        else if(s.phase==='manualUser'){if(!/^[a-z_][a-z0-9_-]{0,31}$/.test(v.user||''))throw new Error('Enter an SSH login name');s.user=v.user;s.phase='confirm';}
        else if(s.phase==='confirm'){if(v.confirmed!==true&&v.approved!==true){s.phase='cancelled';return output(s);}s.phase=s.mode==='manual'?'bootstrap':'provision';s.httpStage='create';}
        else if(s.phase==='deleteConfirm'){
          if(v.confirmed!==true&&v.approved!==true){s.phase='cancelled';return output(s);}
          const ownsCloud=Object.values(s.resources).some(x=>x.owned&&x.status!=='deleted');
          s.phase=s.mode==='manual'&&s.host?'deleteServer':ownsCloud?'cleanup':'cleanupLocal';
          s.index=ownsCloud?graph(s).length-1:-1;s.httpStage='delete';s.attempt=0;
        }
        else if(s.phase==='clientConfirm'){if(v.confirmed!==true&&v.approved!==true){s.phase='cancelled';return output(s);}s.phase=s.operation;}
        else if(s.phase==='updateConfirm'){if(v.confirmed!==true&&v.approved!==true){s.phase='cancelled';return output(s);}s.phase='update';}
        else if(s.phase==='recreateConfirm'){
          if(v.confirmed!==true&&v.approved!==true){s.phase='recovery';return render(s);}
          s.allowRecreate=true;s.phase='provision';s.httpStage='reconcile';return render(s);
        }
        else if(s.phase==='recovery'){
          if(v.action==='keep'){s.phase='cancelled';return output(s);}
          if(s.operation==='update'){s.phase=v.action==='retry'?'update':'health';return render(s);}
          if(v.action==='cleanup'){s.phase='deleteConfirm';return render(s);}
          if(v.action==='recreate'){if(!s.creationAbsent)throw new Error('Reconcile the missing resource first');s.phase='recreateConfirm';return render(s);}
          if(v.action==='edit'){
            if(Object.values(s.resources).some(x=>x.status!=='deleted'))throw new Error('Clean up created resources before changing their cloud settings');
            s.optionIndex=0;s.phase=s.mode==='manual'?'manual':OPTIONS[s.provider]?'options':'provider';return render(s);
          }
          if(v.action==='account'){s.accountResumePhase=s.interruptedPhase||'options';s.phase='credential';return render(s);}
          s.phase=s.interruptedPhase||'provision';
          s.httpStage=['cleanup','cleanupExtra','cleanupWait','extraWait'].includes(s.phase)?(v.action==='retry'?'delete':s.httpStage==='deleteCheck'?'deleteCheck':'deleteRead'):'reconcile';
          if(s.phase==='cleanupWait')s.phase='cleanup';if(s.phase==='extraWait')s.phase='cleanupExtra';
          if(s.phase==='wait')s.phase='provision';s.attempt=0;
        }
        return render(s);
      }
      if(event.type!=='result')return render(s);
      if(s.phase==='wait'){s.phase='provision';s.httpStage='read';return render(s);}
      if(s.phase==='cleanupWait'){s.phase='cleanup';if(!['deleteCheck','deleteRetry'].includes(s.httpStage))s.httpStage='deleteRead';return render(s);}
      if(s.phase==='extraWait'){s.phase='cleanupExtra';s.httpStage='deleteRead';return render(s);}
      const b=body(event),status=get(event,'result.status',200);
      if(s.phase==='preflight') {
        const check=preflight(s)[s.preflightIndex||0];
        if(status<200||status>=300||!check.validate(b))return pause(s,check.label+' could not be verified'+(status<200||status>=300?' ('+providerError(status,b)+')':'')+'. Check account permissions, region, plan and Ubuntu 24.04 image.');
        s.verified=(s.verified||[]).concat(check.label);s.preflightIndex=(s.preflightIndex||0)+1;return render(s);
      }
      if(s.phase==='provision') {
        const op=graph(s)[s.index];
        if(s.httpStage==='keyLookup') {
          if(status<200||status>=300)return pause(s,'Could not list public SSH keys in this account ('+providerError(status,b)+').');
          const lookup=keyLookup(s),publicKey=x=>String(get(x,lookup[2],'')).trim().split(/\s+/).slice(0,2).join(' ');
          const keys=list(b,lookup[1]).filter(x=>publicKey(x)===s.publicKey);
          if(!keys.length&&incompleteList(s,b,event.result,list(b,lookup[1]),lookup[0]))
            return pause(s,'The account SSH-key list is incomplete. Reconcile it in the cloud console before creating another key.');
          s.keyChecked=true;
          if(keys.length){const found=keys[0];s.resources.key={provider:s.provider,type:'key',id:found.id,name:found.name,owned:false,status:'existing'};s.index++;}
          s.httpStage='create';return render(s);
        }
        const recovered=(event.result&&event.result.recovered)||s.httpStage==='reconcile';
        const recoveryMatch=get(op,'create.reconcile.match');
        if(recovered&&recoveryMatch&&incompleteList(s,b,event.result,get(b,recoveryMatch.path),get(op,'create.reconcile.url'))){
          delete s.creationAbsent;delete s.allowRecreate;
          return pause(s,'Cloud reconciliation returned an incomplete list. Check all pages in the cloud console; another resource cannot be created safely.');
        }
        if(recovered&&notFound(s,status,b))return absentCreation(s);
        if(status<200||status>=300){if((status===404||status===429||status===503)&&s.httpStage==='read'&&s.attempt<60){s.attempt++;s.phase='wait';return render(s);}return pause(s,'Cloud '+op.key+' request failed ('+providerError(status,b)+'). Review credentials, quota, image and region.');}
        const value=recovered?recoveryBody(op,b):b;
        if(!value&&confirmedAbsent(op,b))return absentCreation(s);
        if(!value)return pause(s,'Interrupted creation could not be matched uniquely. Review cloud resources before retrying.');
        delete s.creationAbsent;delete s.allowRecreate;
        const found=op.extract(value);s.resources[op.key]=Object.assign(s.resources[op.key]||{},{provider:s.provider,type:op.key,owned:true,status:'created'},Object.fromEntries(Object.entries(found).filter(([,v])=>v!==undefined)));
        if(s.provider==='scaleway'&&op.key==='server')for(const volume of Object.values(found.volumes||{}))if(volume.id)s.resources['volume_'+volume.id]={provider:s.provider,type:'volume',id:volume.id,owned:true,status:'created',metadata:{parentId:found.id}};
        if(s.httpStage==='create'&&!recovered){s.httpStage='read';s.attempt=0;return render(s);}
        if(!op.ready(value)){if(s.attempt++>=60)return pause(s,'Cloud resource did not become ready within the polling limit');s.phase='wait';return render(s);}
        s.index++;s.httpStage='create';s.attempt=0;return render(s);
      }
      if(s.phase==='cleanup') {
        const op=graph(s)[s.index];
        if(busyDelete(s,op,status,b)){
          if(s.attempt++>=60)return pause(s,'Cloud '+op.key+' stayed in use past the polling limit ('+providerError(status,b)+'). Remaining resources are retained for retry.');
          s.httpStage='deleteRetry';s.phase='cleanupWait';return render(s);
        }
        if((status<200||status>=300)&&!notFound(s,status,b))return pause(s,'Cloud '+op.key+' deletion failed ('+providerError(status,b)+'). Remaining resources are retained for retry.');
        if(s.provider==='hetzner'&&op.key==='address'&&s.httpStage==='deleteCheck'&&!notFound(s,status,b)){
          const ip=get(b,'primary_ip'),server=s.resources.server;
          if(!ip||!Number.isSafeInteger(ip.id)||ip.id<=0||String(ip.id)!==String(s.resources.address.id)||
            !Object.prototype.hasOwnProperty.call(ip,'assignee_id'))
            return pause(s,'The primary IPv4 assignment could not be verified. Its deletion receipt is retained.');
          if(ip.assignee_id===null){s.httpStage='deleteReady';s.attempt=0;return render(s);}
          if(!Number.isSafeInteger(ip.assignee_id)||ip.assignee_id<=0||!server||server.owned!==true||
            server.status!=='deleted'||String(ip.assignee_id)!==String(server.id))
            return pause(s,'The primary IPv4 is assigned to an unverified server. Review its cloud assignment before deletion.');
          if(s.attempt++>=60)return pause(s,'The primary IPv4 did not detach within the polling limit. Its deletion receipt is retained.');
          s.phase='cleanupWait';return render(s);
        }
        const detached=s.provider==='aws'&&op.key==='attachment'&&!get(b,'staticIp.isAttached',true);
        const stopped=s.provider==='scaleway'&&op.key==='power'&&get(b,'server.state')==='stopped';
        const gone=notFound(s,status,b)||get(b,'lifecycleState')==='TERMINATED'||detached||stopped;
        if(!gone){if(s.attempt++>=60)return pause(s,'Cloud deletion did not finish within the polling limit');s.phase='cleanupWait';return render(s);}
        s.resources[op.key].status='deleted';s.index--;s.attempt=0;s.httpStage='delete';
        if(op.key==='server'&&s.provider==='scaleway') {
          s.extraCleanup=Object.values(s.resources.server.volumes||{}).filter(v=>v.id).map(v=>({id:v.id,type:'volume',url:'https://api.scaleway.com/instance/v1/zones/'+enc(s.inputs.zone)+'/volumes/'+enc(v.id)}));
          s.phase='cleanupExtra';
        }
        return render(s);
      }
      if(s.phase==='cleanupExtra') {
        if((status<200||status>=300)&&status!==404)return pause(s,'Additional cloud resource deletion failed ('+providerError(status,b)+'); its receipt is retained.');
        if(status===404){const removed=s.extraCleanup.shift();if(s.resources['volume_'+removed.id])s.resources['volume_'+removed.id].status='deleted';s.httpStage='delete';s.attempt=0;return render(s);}
        if(s.attempt++>=60)return pause(s,'Additional cloud resource deletion did not finish');
        s.httpStage='deleteRead';s.phase='extraWait';return render(s);
      }
      if(s.phase==='deleteServer'){s.phase='cleanupLocal';return render(s);}
      if(s.phase==='cleanupLocal'){s.phase='deleted';return output(s);}
      if(s.phase==='bootstrap'||s.phase==='createClient') {
        if(!b.configRef||!b.clientId)throw new Error('Native SSH executor did not return a vaulted configuration');
        s.configRef=b.configRef;s.lastClientId=String(b.clientId);s.phase='import';return render(s);
      }
      if(s.phase==='import'){s.profileId=b.profileId;s.clients=(s.clients||[]).filter(x=>x.clientId!==s.lastClientId);s.clients.push({clientId:s.lastClientId,profileId:b.profileId});delete s.configRef;s.phase='ready';return output(s);}
      // A check that ends an update job without the pinned version running ends it as stopped, not done.
      if(s.phase==='health'||s.phase==='update'){s.health=health(s,b);s.phase=s.operation==='update'&&b.current!==true?'cancelled':'ready';return output(s);}
      if(s.phase==='revokeClient'){
        s.clients=(s.clients||[]).filter(x=>x.clientId!==s.targetClientId);
        const selected=s.clients.find(x=>x.profileId===s.profileId)||s.clients[s.clients.length-1];
        if(selected){s.profileId=selected.profileId;s.lastClientId=selected.clientId;}
        else{delete s.profileId;delete s.lastClientId;}
        s.phase='ready';return output(s);
      }
      return render(s);
    } catch(error) {s.interruptedPhase=s.phase;return pause(s,error.message);}
  }
  root.MobileSSHWorkflow={next,providers:PROVIDERS,graph,credentialFields:CREDENTIALS,optionFields:OPTIONS,image:IMAGE,release:RELEASE};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.MobileSSHWorkflow;
})(typeof globalThis!=='undefined'?globalThis:this);
