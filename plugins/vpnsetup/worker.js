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
      // envelope: the shape a found list item is wrapped in, the same as the create answer (Scaleway keys have none).
      return Object.assign(known(key, req('POST', base, body), read, entity(envelope, n), null, req('DELETE', base + '/' + enc(id)), reconcile), {envelope});
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
      // An insert answers with its Operation, whose own id is not the resource's: the receipt takes targetId from it, the id
      // the resource's read gives, so the phone's ledger never holds a row for the Operation.
      const named=(key,base,body,ready)=>known(key,req('POST',base,body),req('GET',base+'/'+n),
        b=>({id:(b.kind==='compute#operation'?b.targetId:b.id)||n,name:n,host:b.address}),ready,req('DELETE',base+'/'+n),
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

  // Preflight reasons are shown on the page and in the native review and spoken by the voice. Provider data
  // enters them only as identifier-like values (8 at most); the user's own validated settings are capped.
  const safe=v=>(typeof v==='string'||typeof v==='number')&&/^[A-Za-z0-9_.:-]{1,40}$/.test(String(v))?String(v):'';
  const shown=v=>{const t=String(v==null?'':v);return t.length>40?t.slice(0,37)+'...':t;};
  const SETTING=/^[a-zA-Z0-9_.:-]{1,256}$/; // What a setting may hold (cleanInputs).
  function names(values) {
    const all=[...new Set(values.map(safe).filter(Boolean))];
    return all.slice(0,8).join(', ')+(all.length>8?' and '+(all.length-8)+' more':'');
  }
  const items=v=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'):[];
  // A check's answer that the setting may be on its list's next page: that page is read under the same check (preflightPage).
  const NEXT_PAGE={next:true},PREFLIGHT_PAGES=5;
  function preflight(s) {
    const p=s.inputs,req=(url)=>request(s,'GET',url), checks=[];
    const size=shown(p.size),region=shown(p.region),zone=shown(p.zone);
    // problem(body, response) is '' once the setting is verified, otherwise one short self-contained reason.
    const check=(label,request,problem)=>checks.push({label,request,problem:problem||(()=>'')});
    if(s.provider==='gcp') {
      const b='https://compute.googleapis.com/compute/v1/projects/'+enc(p.projectId);
      // The address is made in the region and the server in the zone: a zone of another region fails only at the server's create.
      // The create boots the amd64 image: an Arm type would fail there too (1.0.6).
      check('Machine type',req(b+'/zones/'+enc(p.zone)+'/machineTypes/'+enc(p.size)),b=>{
        if(!String(p.zone).startsWith(p.region+'-'))return 'Zone '+zone+' is not in region '+region+'. A Google Cloud zone is its region\'s name and a letter, such as us-central1-a in us-central1.';
        if(b.name!==p.size)return 'Google Cloud did not confirm machine type '+size+' in zone '+zone+'.';
        return b.architecture==='ARM64'?'Machine type '+size+' is an Arm type, and this setup boots Ubuntu 24.04 for x86 (amd64). Choose an x86 type, such as e2-small.':'';
      });
      check('Ubuntu image',req('https://compute.googleapis.com/compute/v1/projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64'),
        b=>b.status==='READY'?'':'Google Cloud\'s Ubuntu 24.04 image is not ready'+(safe(b.status)?' (status '+safe(b.status)+')':'')+'.');
    } else if(s.provider==='aws') {
      const aws=(action,body)=>lightsail(s,p.region,action,body);
      check('Lightsail bundle',aws('GetBundles',{includeInactive:false}),b=>{
        const bundle=items(get(b,'bundles')).find(x=>x.bundleId===p.size);
        return !bundle?'Lightsail has no bundle '+size+' in '+region+'.':bundle.isActive?'':'Lightsail bundle '+size+' is no longer offered.';
      });
      check('Ubuntu image',aws('GetBlueprints',{includeInactive:false}),b=>items(get(b,'blueprints')).some(x=>x.blueprintId==='ubuntu_24_04'&&x.isActive)?'':
        'Lightsail does not offer the Ubuntu 24.04 blueprint in '+region+'.');
      check('Availability zone',aws('GetRegions',{includeAvailabilityZones:true}),b=>{
        const area=items(get(b,'regions')).find(x=>x.name===p.region),zones=area?items(area.availabilityZones).map(z=>z.zoneName):[];
        if(!area)return 'Lightsail has no region '+region+'.';
        return zones.includes(p.zone)?'':'Availability zone '+zone+' is not in Lightsail region '+region+'.'+(names(zones)?' Zones there: '+names(zones)+'.':'');
      });
    } else if(s.provider==='azure') {
      check('Subscription',req('https://management.azure.com/subscriptions/'+enc(p.subscriptionId)+'?api-version=2022-12-01'),
        b=>b.state==='Enabled'?'':safe(b.state)?'The Azure subscription is '+safe(b.state)+', not Enabled.':'Azure did not confirm that the subscription is enabled.');
      check('VM size',req('https://management.azure.com/subscriptions/'+enc(p.subscriptionId)+'/providers/Microsoft.Compute/locations/'+enc(p.region)+'/vmSizes?api-version=2024-07-01'),b=>{
        const sizes=items(get(b,'value'));
        if(!sizes.some(x=>x.name===p.size))return sizes.length?'VM size '+size+' isn\'t offered in '+region+'.':'Azure listed no VM sizes in '+region+'. Check the region name.';
        // A lower-case p among the size's feature letters is Arm (Azure's naming); the create boots the x64 image (1.0.6).
        return /^Standard_[A-Z]+[0-9]+[a-z]*p[a-z]*(_|$)/.test(p.size)?'VM size '+size+' is an Arm size, and this setup boots Ubuntu 24.04 for x64. Choose an x64 size, such as Standard_B2ats_v2.':'';
      });
    } else if(s.provider==='digitalocean') {
      const url='https://api.digitalocean.com/v2/sizes?per_page=200';
      check('Droplet region and size',req(url),(b,response)=>{
        const sizes=items(get(b,'sizes')),found=sizes.find(x=>x.slug===p.size),regions=found&&Array.isArray(found.regions)?found.regions:[];
        // Listing sizes needs the sizes:read and regions:read scopes.
        if(!sizes.length)return 'DigitalOcean listed no Droplet sizes. The token may lack read access to sizes and regions.';
        if(!found)return incompleteList(s,b,response,sizes,url)?'DigitalOcean listed only part of its Droplet sizes, without '+size+'. Check again later.':'DigitalOcean has no Droplet size '+size+'.';
        if(!found.available)return 'Droplet size '+size+' isn\'t available to this account for new Droplets.';
        if(!regions.includes(p.region))return 'Droplet size '+size+' isn\'t offered in '+region+'.'+(names(regions)?' Regions with it: '+names(regions)+'.':' No region has it right now.');
        return '';
      });
      check('Ubuntu image',req('https://api.digitalocean.com/v2/images/ubuntu-24-04-x64'),b=>get(b,'image.id')?'':
        'DigitalOcean did not return its Ubuntu 24.04 image. The token may lack read access to images.');
    } else if(s.provider==='hetzner') {
      check('Server type in selected location',req('https://api.hetzner.cloud/v1/server_types?name='+enc(p.size)),b=>{
        const type=items(get(b,'server_types')).find(x=>x.name===p.size);
        if(!type)return 'Hetzner Cloud has no server type '+size+'.';
        if(type.architecture!=='x86')return 'Server type '+size+' is not an x86 type'+(safe(type.architecture)?' (it is '+safe(type.architecture)+')':'')+'. Choose an x86 server type.';
        // Older API snapshots omit locations entirely. Current responses must
        // explicitly advertise capacity in the selected location; availability
        // elsewhere, a missing entry or a malformed flag does not authorize it.
        if(!Object.prototype.hasOwnProperty.call(type,'locations'))return '';
        if(!Array.isArray(type.locations))return 'Hetzner did not list where server type '+size+' can be ordered.';
        const locations=items(type.locations),here=locations.find(x=>x.name===p.region);
        if(here&&here.available===true)return '';
        // Since 2026-04-01 each entry says whether it can be ordered now; recommended locations are named first.
        const open=locations.filter(x=>x.available===true&&x.name!==p.region).sort((a,b)=>(b.recommended===true)-(a.recommended===true)).map(x=>x.name);
        const elsewhere=names(open)?' Locations with it: '+names(open)+'.':' No location has it right now.';
        if(!here)return 'Server type '+size+' isn\'t offered in '+region+'.'+elsewhere;
        if(here.available===false)return (here.deprecation?'Server type '+size+' is being retired in '+region+' and can\'t be ordered there.':
          'Server type '+size+' is sold out in '+region+' right now.')+elsewhere;
        return 'Hetzner did not confirm that server type '+size+' can be ordered in '+region+'.'+elsewhere;
      });
      check('Location',req('https://api.hetzner.cloud/v1/locations?name='+enc(p.region)),b=>items(get(b,'locations')).some(x=>x.name===p.region)?'':'Hetzner Cloud has no location '+region+'.');
    } else if(s.provider==='linode') {
      check('Instance plan',req('https://api.linode.com/v4/linode/types/'+enc(p.size)),b=>b.id===p.size?'':'Linode has no plan '+size+'.');
      check('Ubuntu image',req('https://api.linode.com/v4/images/linode/ubuntu24.04'),b=>b.id==='linode/ubuntu24.04'?'':'Linode did not return its Ubuntu 24.04 image.');
      check('Region',req('https://api.linode.com/v4/regions/'+enc(p.region)),b=>b.status==='ok'?'':'Linode region '+region+' is not available right now'+(safe(b.status)?' (status '+safe(b.status)+')':'')+'.');
    } else if(s.provider==='vultr') {
      check('Ubuntu image',req('https://api.vultr.com/v2/os?per_page=500'),b=>{
        const os=items(get(b,'os')),ubuntu=x=>/ubuntu/i.test(x.name)&&/24\.04/.test(x.name)&&x.arch==='x64',found=os.find(x=>String(x.id)===p.imageId);
        if(found&&ubuntu(found))return '';
        const hint=names(os.filter(ubuntu).map(x=>x.id));
        return (found?'Vultr OS ID '+shown(p.imageId)+' is not Ubuntu 24.04 x64.':'Vultr has no OS ID '+shown(p.imageId)+'.')+(hint?' Ubuntu 24.04 x64 is OS ID '+hint+'.':'');
      });
      check('Instance plan',req('https://api.vultr.com/v2/plans?per_page=500'),b=>{
        const plan=items(get(b,'plans')).find(x=>x.id===p.size),regions=plan&&Array.isArray(plan.locations)?plan.locations:[];
        if(!plan)return 'Vultr has no plan '+size+'.';
        if(!vultrLocal(plan))return 'Vultr plan '+size+' boots from Block Storage, which this setup does not create. Choose a plan with local storage, such as vc2-1c-1gb.';
        return regions.includes(p.region)?'':'Vultr plan '+size+' isn\'t offered in '+region+'.'+(names(regions)?' Regions with it: '+names(regions)+'.':'');
      });
    } else if(s.provider==='oci') {
      check('Ubuntu image',req('https://iaas.'+p.region+'.oraclecloud.com/20160918/images/'+enc(p.imageId)),
        b=>/ubuntu/i.test(b.operatingSystem||'')&&/24\.04/.test(b.operatingSystemVersion||'')?'':'The selected Oracle Cloud image is not Ubuntu 24.04.');
      check('Instance shape',req('https://iaas.'+p.region+'.oraclecloud.com/20160918/shapes?compartmentId='+enc(p.compartmentId)+'&availabilityDomain='+enc(p.zone)+'&imageId='+enc(p.imageId)),b=>{
        const shapes=items(b).map(x=>x.shape),found=items(b).find(x=>x.shape===p.size);
        if(!found)return 'Shape '+size+' isn\'t offered with this image in availability domain '+zone+'.'+(names(shapes)?' Shapes there: '+names(shapes)+'.':'');
        // The create asks for 1 OCPU and 2 GB (shapeConfig), which a fixed shape (VM.Standard.E2.1.Micro, say) refuses (1.0.6).
        if(found.isFlexible===false)return 'Shape '+size+' has a fixed size, and this setup creates a Flex shape with 1 OCPU and 2 GB RAM. Choose a Flex shape, such as VM.Standard.E4.Flex.';
        return found.isFlexible===true&&!ociFits(found)?'Shape '+size+' cannot run with 1 OCPU and 2 GB RAM, as this setup creates it. Choose another Flex shape, such as VM.Standard.E4.Flex.':'';
      });
    } else if(s.provider==='ovh') {
      const base='https://'+(p.endpoint==='ca'?'ca.api.ovh.com':p.endpoint==='us'?'api.us.ovhcloud.com':'eu.api.ovh.com')+'/1.0/cloud/project/'+enc(p.projectId);
      check('Ubuntu image',req(base+'/image?region='+enc(p.region)),b=>{
        const image=items(b).find(x=>x.id===p.imageId);
        if(!image)return 'OVHcloud has no image with the selected ID in '+region+'.';
        return /ubuntu/i.test(image.name)&&/24\.04/.test(image.name)?'':'The selected OVHcloud image is not Ubuntu 24.04.';
      });
      check('Instance flavor',req(base+'/flavor?region='+enc(p.region)),b=>{
        const flavor=items(b).find(x=>x.id===p.size);
        if(!flavor)return 'OVHcloud has no flavor with the selected ID in '+region+'.';
        return flavor.available!==false?'':(safe(flavor.name)?'OVHcloud flavor '+safe(flavor.name):'The selected OVHcloud flavor')+' is sold out in '+region+' right now.';
      });
    } else if(s.provider==='scaleway') {
      const b='https://api.scaleway.com/instance/v1/zones/'+enc(p.zone);
      check('Ubuntu image',req(b+'/images/'+enc(p.imageId)),x=>{
        const arch=get(x,'image.arch'),name=String(get(x,'image.name',''));
        if(arch!=='x86_64')return 'The selected Scaleway image is not for x86_64'+(safe(arch)?' (it is '+safe(arch)+')':'')+'.';
        return /ubuntu/i.test(name)&&/24\.04|noble/i.test(name)?'':'The selected Scaleway image is not Ubuntu 24.04.';
      });
      // Scaleway lists its types alphabetically, 50 a page unless asked: before 1.0.6 only the first page was read, so a type
      // further on (PLAY2, PRO2, STARDUST1...) was refused. 100 a page now, and the next page while x-total-count says more.
      const page=s.preflightPage||1;
      check('Instance type',req(b+'/products/servers?per_page=100&page='+page),(x,response)=>{
        const servers=get(x,'servers',{}),keys=servers&&typeof servers==='object'&&!Array.isArray(servers)?Object.keys(servers):[];
        if(keys.includes(p.size)&&servers[p.size])return '';
        const total=Number(get(response,'headers',{})['x-total-count']);
        if(keys.length&&Number.isFinite(total)&&total>(page-1)*100+keys.length&&page<PREFLIGHT_PAGES)return NEXT_PAGE;
        return 'Scaleway has no instance type '+size+' in '+zone+'.';
      });
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
    // The API account region first (1.0.6): every OVHcloud request, the lists' too, goes to its host.
    ovh:[field('endpoint','API account region','eu',{type:'select',options:[['eu','EU · Europe (eu.api.ovh.com)'],['ca','CA · Canada, Asia, Oceania (ca.api.ovh.com)'],
      ['us','US · United States (api.us.ovhcloud.com)']].map(([value,label])=>({value,label}))}),field('projectId','Public Cloud project ID'),field('region','Cloud region','GRA11'),field('size','Flavor ID'),field('imageId','Ubuntu 24.04 image ID')],
    scaleway:[field('projectId','Project UUID'),field('zone','Zone','fr-par-1'),field('size','Commercial type','DEV1-S'),field('imageId','Ubuntu 24.04 image UUID')]
  };
  const SSH_FIELD=field('sshCidr','Allow SSH from IPv4 CIDR','0.0.0.0/0');
  // The settings questions as asked: [title, message when listed, message when typed, title when typed after Other]. The
  // native review shows the message (else the title) above the field's label and the voice says the title, so neither repeats
  // the label ("Location" twice before 1.0.5). The message starts with the title. After Other the voice says what to give,
  // not the same question again (which sounded as if Other was not understood). Other providers keep the label as the title.
  // {where} is the region answered before.
  const WHERE='Where should the VPN server run?',LITTLE=' A VPN needs little, so the suggested one is plenty.';
  const SSH_QUESTION=['Which addresses may connect over SSH?','','Enter an IPv4 range in CIDR form. 0.0.0.0/0 allows any address; logins still need this setup\'s SSH key.'];
  const QUESTIONS={hetzner:{
    region:[WHERE,'These Hetzner locations can take a new server in your account now.',
      'Enter a Hetzner location name, such as fsn1, nbg1 or hel1.','Which location? Type or say its Hetzner name, such as fsn1.'],
    size:['Which server type should it use?','These can be ordered in {where} now{order}.'+LITTLE,
      'Enter an x86 Hetzner server type, such as cx23.','Which server type? Type or say its name, such as cx23.'],
    sshCidr:SSH_QUESTION},
  vultr:{
    region:[WHERE,'These Vultr regions offer plans with a public IPv4 address.','Enter a Vultr region ID, such as ewr, ams or sgp.',
      'Which region? Type or say its Vultr ID, such as ewr.'],
    size:['Which plan should it use?','These can be deployed in {where} now{order}.'+LITTLE,
      'Enter a Vultr plan ID with at least 1 GB RAM, such as vc2-1c-1gb.','Which plan? Type or say its ID, such as vc2-1c-1gb.'],
    imageId:['Which Ubuntu 24.04 image should it use?','These are Vultr\'s Ubuntu 24.04 x64 images; the newest is suggested.',
      'Enter the Vultr OS ID of Ubuntu 24.04 LTS x64. The checks before anything is created name it if this one is wrong.','Which OS ID? Type or say the number.'],
    sshCidr:SSH_QUESTION},
  linode:{
    region:[WHERE,'These Linode regions can run a new Linode with a Cloud Firewall now.','Enter a Linode region ID, such as us-east, eu-west or ap-south.',
      'Which region? Type or say its Linode ID, such as us-east.'],
    size:['Which plan should it use?','These are available in {where} now{order}.'+LITTLE,
      'Enter a Linode plan ID with at least 1 GB RAM, such as g6-nanode-1.','Which plan? Type or say its ID, such as g6-nanode-1.'],
    sshCidr:SSH_QUESTION},
  digitalocean:{
    region:[WHERE,'These DigitalOcean regions can take a new Droplet now.','Enter a DigitalOcean region slug, such as nyc3, ams3 or sfo3.',
      'Which region? Type or say its slug, such as nyc3.'],
    size:['Which Droplet size should it use?','These can be created in {where} now{order}.'+LITTLE,
      'Enter a Droplet size slug with at least 1 GB RAM, such as s-1vcpu-1gb.','Which size? Type or say its slug, such as s-1vcpu-1gb.'],
    sshCidr:SSH_QUESTION},
  aws:{
    region:[WHERE,'These are the Lightsail regions; those marked must be enabled in your AWS account first.','Enter a Lightsail region, such as us-east-1, eu-central-1 or ap-south-1.',
      'Which region? Type or say its name, such as us-east-1.'],
    zone:['Which availability zone should it use?','These zones are available in {where} now.','Enter an availability zone of {where}, such as {where}a.',
      'Which zone? Type or say its name, such as {where}a.'],
    size:['Which bundle should it use?','These Lightsail bundles with a public IPv4 address are offered in {where}{order}.'+LITTLE,
      'Enter a Lightsail bundle ID with at least 1 GB RAM, such as micro_3_0.','Which bundle? Type or say its ID, such as micro_3_0.'],
    sshCidr:SSH_QUESTION},
  // A fixed list with no Other (the API account region) has only its title and the typed message, which says how to choose.
  ovh:{
    endpoint:['Which OVHcloud API site is your account on?','','Choose the one where you created the application key: EU for OVHcloud Europe, CA for Canada, Asia and Oceania, US for OVHcloud US.'],
    projectId:['Which Public Cloud project should it use?','These are the Public Cloud projects these keys can see.',
      'Enter the ID of your Public Cloud project: 32 letters and digits, shown under the project name in the OVHcloud Control Panel.','Which project? Type or say its ID.'],
    region:[WHERE,'These regions are enabled for the project and take a new instance.','Enter an OVHcloud region name, such as GRA11, SBG5 or BHS5.',
      'Which region? Type or say its name, such as GRA11.'],
    size:['Which flavor should it use?','These Linux flavors are in stock in {where}{order}.'+LITTLE,
      'Enter the ID of a Linux flavor in {where}, from the project\'s flavor list.','Which flavor ID? Type or say it.'],
    imageId:['Which Ubuntu 24.04 image should it use?','These are OVHcloud\'s Ubuntu 24.04 images in {where}; the newest is suggested.',
      'Enter the ID of the Ubuntu 24.04 image in {where}, from the project\'s image list.','Which image ID? Type or say it.'],
    sshCidr:SSH_QUESTION},
  scaleway:{
    projectId:['Which Scaleway project should it use?','These are the projects this API key can see.',
      'Enter the project ID, a UUID from the project\'s settings in the Scaleway console. It is not the organization ID.','Which project? Type or say its ID.'],
    zone:[WHERE,'These are the Scaleway zones for Instances.','Enter a Scaleway zone, such as fr-par-1, nl-ams-1 or pl-waw-1.',
      'Which zone? Type or say its name, such as fr-par-1.'],
    size:['Which instance type should it use?','These x86 types with a local disk can be ordered in {where} now{order}.'+LITTLE,
      'Enter an x86 Scaleway instance type with a local disk, such as DEV1-S.','Which instance type? Type or say its name, such as DEV1-S.'],
    imageId:['Which Ubuntu 24.04 image should it use?','These are Scaleway\'s Ubuntu 24.04 images with a local disk for this type in {where}.',
      'Enter the UUID of an Ubuntu 24.04 x86_64 image in {where}, from the Instance images list, not a marketplace product ID.','Which image UUID? Type or say it.'],
    sshCidr:SSH_QUESTION},
  // Google Cloud's and Azure's APIs give no prices the phone can read: their sizes are ordered by a list-price rank, not priced.
  gcp:{
    projectId:['Which Google Cloud project should it use?','These are the projects this service account can see.',
      'Enter the project ID (not its name or number), as the project picker in the Google Cloud console shows it.','Which project? Type or say its ID.'],
    region:[WHERE,'These Google Cloud regions have zones up in this project.','Enter a Google Cloud region, such as us-central1, europe-west1 or asia-southeast1.',
      'Which region? Type or say its name, such as us-central1.'],
    zone:['Which zone should it use?','These zones of {where} are up now.','Enter a zone of {where}: its name is the region\'s and a letter, such as us-central1-a in us-central1.',
      'Which zone? Type or say its name, such as us-central1-a.'],
    size:['Which machine type should it use?','These x86 machine types are offered in {zone}{order}.'+LITTLE+' Google Cloud\'s API gives no prices; its pricing page has them.',
      'Enter an x86 machine type with at least 1 GB RAM, such as e2-small.','Which machine type? Type or say its name, such as e2-micro.'],
    sshCidr:SSH_QUESTION},
  azure:{
    subscriptionId:['Which Azure subscription should it use?','These are the enabled subscriptions this app registration can use.',
      'Enter the subscription ID, a GUID shown under Subscriptions in the Azure portal.','Which subscription? Type or say its ID.'],
    region:[WHERE,'These are the subscription\'s regions, Azure\'s recommended ones first; those marked may need an access request first.',
      'Enter an Azure region name, such as eastus, westeurope or southeastasia.','Which region? Type or say its name, such as eastus.'],
    size:['Which VM size should it use?','These x64 sizes are offered in {where}{order}.'+LITTLE+' Azure\'s API gives no prices; its pricing page has them.',
      'Enter an x64 VM size with at least 1 GB RAM, such as Standard_B1s or Standard_B2ats_v2.','Which VM size? Type or say its name, such as Standard_B2ats_v2.'],
    sshCidr:SSH_QUESTION},
  oci:{
    compartmentId:['Which compartment should it use?','The root compartment is the whole tenancy; a dedicated one keeps the VPN\'s resources apart.',
      'Enter the OCID of the compartment, from Identity, Compartments in the Oracle Cloud console.','Which compartment? Type or say its OCID.'],
    region:[WHERE,'These are Oracle Cloud\'s main commercial regions; choose one your tenancy is subscribed to.',
      'Enter an Oracle Cloud region identifier, such as us-ashburn-1, eu-frankfurt-1 or ap-tokyo-1.','Which region? Type or say its identifier, such as us-ashburn-1.'],
    zone:['Which availability domain should it use?','These are the availability domains of {where}.',
      'Enter the full availability domain name with its prefix, such as Uocm:US-ASHBURN-AD-1, as the console\'s instance page shows it.','Which availability domain? Type or say its full name.'],
    size:['Which shape should it use?','These x86 Flex shapes can run with 1 OCPU and 2 GB RAM in this availability domain{order}.'+LITTLE,
      'Enter an x86 Flex shape that allows 1 OCPU and 2 GB RAM, such as VM.Standard.E4.Flex.','Which shape? Type or say its name, such as VM.Standard.E4.Flex.'],
    imageId:['Which Ubuntu 24.04 image should it use?','This is Oracle Cloud\'s newest Ubuntu 24.04 image for this shape in {where}.',
      'Enter the OCID of a Canonical Ubuntu 24.04 image in {where} (amd64 for an x86 shape), from the console\'s image list.','Which image? Type or say its OCID.'],
    sshCidr:SSH_QUESTION}};
  // The place the questions name as {where}: the region, or Scaleway's zone (its sizes and images are per zone). {zone}: the
  // zone answered before (Google Cloud's machine types are per zone).
  const whereOf=s=>shown(s.provider==='scaleway'?s.inputs.zone:s.inputs.region);
  const fill=(s,text)=>text.replace(/\{where\}/g,whereOf(s)).replace(/\{zone\}/g,shown(s.inputs.zone));
  // A listed question's last answer: the same setting asked again, typed (the host takes only listed values). The
  // parentheses keep it from ever being a setting (settingProblem).
  const OTHER='(other)',OTHER_LABEL='Other (type a value)',LISTED=12,LISTS=['region','size'];
  // The app's voice offers at most 26 choices (more, and it sends the user to the phone): a longer list keeps LONG entries,
  // so that with the earlier or entered-before answer, the suggestion and Other it stays within 26 (1.0.6).
  const LONG=23;
  // What a provider offers this account now, read with its API key before the settings questions: read-only GETs, at most
  // CATALOG_PAGES pages each. reads: in order; list: where a read's array is ('' for one that is not a list); page: adds a
  // read's answer to the catalog read so far. Only Hetzner so far: its server types, its locations, and the currency of the
  // prices (with the public IPv4's price) from its pricing.
  const CATALOG_PAGES=4,CATALOG={hetzner:{reads:['server_types','locations','pricing'],list:what=>what==='pricing'?'':what,
    url:(what,page)=>'https://api.hetzner.cloud/v1/'+what+(what==='pricing'?'':'?per_page=50&page='+page),
    next:b=>get(b,'meta.pagination.next_page'),page:hetznerPage}};
  // A place's name as provider data may give it: letters, digits and simple punctuation, short.
  const place=v=>typeof v==='string'&&/^[\p{L}\p{M}0-9 .,'()-]{1,40}$/u.test(v.trim())?v.trim():'';
  // A name the account gave (an OVHcloud or Scaleway project): any text, without control or format characters, short.
  const given=v=>typeof v==='string'?v.replace(/\p{C}+/gu,' ').replace(/[<>]/g,'').replace(/\s+/g,' ').trim().slice(0,32).trim():'';
  // Hetzner writes prices as decimal strings, the gross with 16 decimals ("1.1900000000000000"), the net with 10.
  const amount=v=>{const n=typeof v==='string'&&/^[0-9]{1,6}(\.[0-9]{1,20})?$/.test(v)?Number(v):typeof v==='number'?v:NaN;return Number.isFinite(n)&&n>=0&&n<1e6?n:null;};
  const count=v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<100000?v:null;
  // One answer into the compact catalog the job's state keeps: per type its name, cores, memory (GB) and, per location it
  // can be ordered in now (available, not being retired there), [location, monthly gross price or null, recommended there].
  // Only x86 types: the read-only checks refuse others (Automatic VM choices target amd64). A type's own deprecation is
  // not used: Hetzner retires types per location, and that field may stay set where one can still be ordered.
  function hetznerPage(r,what,values,b) {
    if(what==='server_types')for(const x of items(values)){
      if(!safe(x.name)||x.architecture!=='x86'||r.types.some(t=>t.n===x.name))continue;
      const at=items(x.locations).filter(l=>safe(l.name)&&l.available===true&&!l.deprecation).map(l=>
        [l.name,amount(get(items(x.prices).find(p=>p.location===l.name),'price_monthly.gross')),l.recommended===true]);
      if(at.length)r.types.push({n:x.name,c:count(x.cores),m:count(x.memory),at});
    }
    else if(what==='locations')for(const x of items(values)){
      if(!safe(x.name)||r.places.some(p=>p[0]===x.name))continue;
      const country=typeof x.country==='string'&&/^[A-Z]{2}$/.test(x.country)?x.country:'';
      r.places.push([x.name,[place(x.city),country].filter(Boolean).join(', ')]);
    }
    else {
      const currency=get(b,'pricing.currency'),ipv4=items(get(b,'pricing.primary_ips')).find(x=>x.type==='ipv4');
      if(typeof currency==='string'&&/^[A-Z]{3}$/.test(currency))r.currency=currency;
      r.ipv4=items(ipv4&&ipv4.prices).map(p=>[safe(p.location),amount(get(p,'price_monthly.gross'))]).filter(p=>p[0]&&p[1]!==null);
    }
  }
  // Every order the catalog allows now: a type in a listed location, cheapest first; at the same price, where the provider
  // recommends that type, then the smaller type. The first is the suggestion. Equal ones keep the provider's order.
  const price=x=>x.price===null?Infinity:x.price;
  const offers=c=>c.types.flatMap(t=>t.at.map(([loc,cost,rec])=>({t,loc,price:cost,rec}))).filter(x=>c.locations.some(p=>p[0]===x.loc));
  const cheaper=(a,b)=>((price(a)-price(b))||0)||(b.rec-a.rec)||((a.t.c||0)-(b.t.c||0))||((a.t.m||0)-(b.t.m||0));
  // Half a cent up, as a price list shows it: 0.595 is 0.59499.. in binary and toFixed alone says 0.59.
  const money=(value,currency)=>(Math.round(value*100+1e-6)/100).toFixed(2)+' '+currency;
  // Short, what one chooses by first: the native list shows one line and cuts the end ("40 GB di.."), so the name, whether
  // it is the suggestion, the price, then cores and memory; disk sizes are on the pricing page.
  const sizeLabel=(x,currency,first)=>[x.t.n+(first?' (suggested)':''),x.price!==null&&currency?money(x.price,currency)+'/mo':'',
    [x.t.c&&x.t.c+' vCPU',x.t.m&&x.t.m+' GB RAM'].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  // A listed question's answers and the one selected: the earlier answer while it is listed; else a value typed before while
  // the catalog listed (custom), offered as entered before and selected, unless the catalog knows that type cannot be
  // ordered in this location (it would stop on the same check again); else the suggestion. The selected one comes first,
  // since a voice "yes" takes the first choice, and Other last. null when the catalog lists nothing for it (server types in
  // a location typed after Other, say), which leaves the question typed as before. away: a type the catalog knows but not here.
  function choices(s,key) {
    const found=LOOKUPS[s.provider]?listing(s,key):hetznerList(s,key);
    return found&&offer(s,key,found);
  }
  function hetznerList(s,key) {
    const c=s.catalog,all=c&&Array.isArray(c.types)&&Array.isArray(c.locations)?offers(c).sort(cheaper):[];
    let full,suggested,sorted=false;
    if(key==='region'){
      if(!all.length)return null;
      suggested=all[0].loc;
      full=c.locations.filter(p=>all.some(x=>x.loc===p[0])).map(([value,label])=>({value,label:[value+(value===suggested?' (suggested)':''),label].filter(Boolean).join(' · ')}));
    }
    else if(key==='size'){
      const here=all.filter(x=>x.loc===s.inputs.region);
      if(!here.length)return null;
      suggested=here[0].t.n;sorted=here.some(x=>x.price!==null);
      full=here.map(x=>({value:x.t.n,label:sizeLabel(x,c.currency,x===here[0])}));
    }
    else return null;
    return {full,suggested,sorted,priced:sorted&&!!c.currency,cap:LISTED,away:v=>key==='size'&&!full.some(o=>o.value===v)&&c.types.some(t=>t.n===v),
      about:v=>hetznerAbout(c,all,s.inputs.region,key,v)};
  }
  // The review's words for a Hetzner answer (1.0.7), as its list shows them: a location's city and country; a server type
  // orderable in the chosen location, its price there, cores and memory, and in a note the public IPv4 address's price there
  // (its prices leave it out). A type not orderable there gets none, as its list said none.
  function hetznerAbout(c,all,region,key,v) {
    if(key==='region')return {name:'',detail:(c.locations.find(p=>p[0]===v)||[])[1]||''};
    const x=all.find(o=>o.loc===region&&o.t.n===v),ip=x&&x.price!==null&&c.currency&&(c.ipv4||[]).find(p=>p[0]===region);
    return {name:'',detail:x?[x.price!==null&&c.currency?money(x.price,c.currency)+'/mo':'',[x.t.c&&x.t.c+' vCPU',x.t.m&&x.t.m+' GB RAM'].filter(Boolean).join(', ')]
      .filter(Boolean).join(' · '):'',note:ip?'Plus '+money(ip[1],c.currency)+'/mo for its public IPv4 address':''};
  }
  // Any provider's list as asked (full: its answers, suggestion first in price order; cap: how many before Other).
  // lead: the suggestion is not the cheapest listed (one cheaper is low on stock, say).
  // within: the entries a long list keeps (LONG), else the first cap. named: an entry's name where its value is an opaque ID
  // (an OVHcloud flavor's UUID), for the entered-before label and the review.
  function offer(s,key,{full,suggested,sorted,priced,cap,away,lead,within,named}) {
    const previous=s.inputs[key],custom=get(s,'custom.'+key),kept=full.some(o=>o.value===previous),name=v=>named&&named(v)||v;
    const before=!kept&&!!custom&&custom===previous?[{value:custom,label:name(custom)+(away(custom)?' (entered before, not available here)':' (entered before)')}]:[];
    const chosen=kept||before.length&&!away(custom)?previous:suggested;
    const offered=before.concat(full.filter((o,at)=>(within?within(o.value):at<cap)||o.value===previous||o.value===suggested));
    return {default:chosen,suggested,away,sorted,earlier:chosen!==suggested,lead:!!lead,priced,named,
      options:offered.filter(o=>o.value===chosen).concat(offered.filter(o=>o.value!==chosen),[{value:OTHER,label:OTHER_LABEL}])};
  }

  // VPN Setup 1.0.6: the other providers' lists. A lookup is one read-only request (paged up to `pages`), sent just before the
  // question `before` names, once the questions before it are answered; parse keeps a compact projection of its answer (a
  // falsy one: unusable), and a request of null skips it (a read it builds on failed, or rule H below). catalog.read[name] holds
  // what it kept, or null when it was refused, odd or skipped: the questions it feeds are then typed as before. fields: a listed
  // question's entries from what was read; auto: a question answered without asking when its list holds one answer and
  // nothing was typed for it before (Vultr's Ubuntu OS ID). Any refused, failed or odd read never stops the setup.
  const strs=v=>Array.isArray(v)?v.filter(x=>typeof x==='string'):[];
  const mb=v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<1e8?v:null;
  const gigs=v=>mb(v)&&Math.round(v/102.4)/10; // MB as GB with one decimal, as the labels show it
  const where=(city,cc)=>[place(city),typeof cc==='string'&&/^[A-Za-z]{2}$/.test(cc)?cc.toUpperCase():''].filter(Boolean).join(', ');
  // [region, cheapest monthly price there] pairs (a list, as region ids are object keys nowhere in the state).
  function cheapest(at,region,cost){const x=at.find(p=>p[0]===region);if(cost===null||!(cost>0))return;if(!x)at.push([region,cost]);else if(cost<x[1])x[1]=cost;}
  // The earlier, typed-before and usual answers the provider knows but cannot order here (a plan sold out there, say): one
  // offered again is labelled as not available here, and after Other the suggestion is filled in instead.
  function awayOf(s,key,known,listed) {
    const usual=(OPTIONS[s.provider].find(f=>f.key===key)||{}).default;
    return [...new Set([s.inputs[key],get(s,'custom.'+key),usual])].filter(v=>typeof v==='string'&&!listed.includes(v)&&known(v));
  }
  // A region list read, with the earlier, typed-before and usual regions the read names but leaves out (nyc2, not available).
  const regionsRead=(s,all,id,list)=>({list,away:awayOf(s,'region',v=>items(all).some(x=>x[id]===v),list.map(x=>x[0]))});
  const V='https://api.vultr.com/v2',LN='https://api.linode.com/v4',DO='https://api.digitalocean.com/v2';
  // Vultr: the create asks for no IPv6 and connects to main_ip, so no IPv6-only (-v6) or VPC-only plan; x86 CPU plans only.
  // And a local boot disk: a VX1 plan on Block Storage alone needs a boot volume the create does not send (one it made would
  // outlive the deletion), so only local_storage and local_and_block_storage plans.
  const vultrLocal=p=>/local/.test(String(p.storage_type||'local_storage'));
  const vultrPrice=(p,r)=>{const here=amount(get(p,'location_cost.'+r+'.monthly_cost'));return here!==null?here:amount(p.monthly_cost);};
  const vultrPlan=(p,r)=>!!safe(p.id)&&['vc2','vhf','vhp','voc','vx1','vdc'].includes(p.type)&&strs(p.locations).includes(r)&&mb(p.ram)>=1024&&
    !!count(p.vcpu_count)&&vultrPrice(p,r)>0&&[undefined,null,'','none'].includes(p.gpu_brand)&&!/-v6$/.test(p.id)&&p.deploy_ondemand!==false&&
    !/arm|ampere|graviton/i.test(String(p.cpu_vendor||''))&&vultrLocal(p);
  // More than one page: Vultr's next cursor, DigitalOcean's next link (not followed: a page holds 500 and 200 here).
  const pagesLeft=key=>b=>!!get(b,'meta.links.next')||!!get(b,'links.pages.next')||Number(get(b,'meta.total',0))>list(b,key).length;
  // The same test as the checks' Ubuntu image check.
  const vultrUbuntu=x=>Number.isSafeInteger(x.id)&&x.id>0&&typeof x.name==='string'&&/ubuntu/i.test(x.name)&&/24\.04/.test(x.name)&&x.arch==='x64';
  // Linode: cloud-init (Metadata), the Cloud Firewall and a Linode itself must be offered in the region.
  const linodePrice=(t,r)=>{const here=amount(get(items(t.region_prices).find(p=>p.id===r),'monthly'));return here!==null?here:amount(get(t,'price.monthly'));};
  const linodePages=b=>Number(get(b,'pages',1))>Number(get(b,'page',1));
  // DigitalOcean: a size is ordered in a region its own regions list names, as the checks require; no GPU, at least 1 GB.
  const doSize=(x,disk)=>!!safe(x.slug)&&x.available===true&&mb(x.memory)>=1024&&!!count(x.vcpus)&&amount(x.price_monthly)>0&&
    !/^gpu-/.test(x.slug)&&!(get(x,'gpu_info.count')>0)&&(typeof x.disk==='number'?x.disk>=disk:!disk);
  // Lightsail: the setup attaches a static IPv4 and connects over it, so no IPv6-only bundle; Linux, not a Research bundle.
  const lightsail=(s,region,action,body)=>request(s,'POST','https://lightsail.'+region+'.amazonaws.com/',body,{readOnly:true,
    headers:{'Content-Type':'application/x-amz-json-1.1','X-Amz-Target':'Lightsail_20161128.'+action},auth:{scheme:'aws',credentialRef:s.credentialRef,service:'lightsail',region}});
  const awsBundle=x=>!!safe(x.bundleId)&&x.isActive===true&&strs(x.supportedPlatforms).includes('LINUX_UNIX')&&x.publicIpv4AddressCount!==0&&
    !/_ipv6_/.test(x.bundleId)&&!strs(x.supportedAppCategories).length&&typeof x.ramSizeInGb==='number'&&x.ramSizeInGb>=1&&amount(x.price)>0;
  // Rule H: a region typed after Other never goes into a host name (a typo there is a DNS failure, which pauses the setup).
  const awsListed=s=>!!s.catalog.read.regions&&s.catalog.read.regions.list.some(r=>r[0]===s.inputs.region);
  // Regions a Lightsail account must enable before use (AWS's Lightsail regions page): listed last, marked, never suggested.
  const AWS_OPT_IN=['ap-east-1','ap-southeast-3','ap-southeast-5','eu-south-2'],optIn=x=>AWS_OPT_IN.includes(x.name)?1:0;
  const CONTINENTS=['NA','EU','AP','SA'],continent=x=>{const at=CONTINENTS.indexOf(x.continentCode);return at<0?CONTINENTS.length:at;};
  // OVHcloud: every request goes to the API account region's host, signed natively. v2 lists page by a cursor header (100 a
  // page asked); v1 lists are whole arrays (rule I: incompleteList's 50 for OVHcloud would misjudge them).
  const OVH_HOSTS={eu:'eu.api.ovh.com',ca:'ca.api.ovh.com',us:'api.us.ovhcloud.com'},OVH_REGION={eu:'GRA11',ca:'BHS5',us:'US-EAST-VA-1'};
  const ovhGet=(s,path,cursor)=>request(s,'GET','https://'+(OVH_HOSTS[s.inputs.endpoint]||OVH_HOSTS.eu)+path,undefined,/^\/v2\//.test(path)?
    {headers:Object.assign({'Content-Type':'application/json','X-Pagination-Size':'100'},cursor?{'X-Pagination-Cursor':cursor}:{})}:{});
  const ovhCursor=(b,response)=>{const c=get(response,'headers',{})['x-pagination-cursor-next'];return typeof c==='string'&&/^[\x21-\x7e]{1,1024}$/.test(c)?c:null;};
  const ovhProject=s=>'/1.0/cloud/project/'+enc(s.inputs.projectId);
  // OVHcloud's API has no prices but its public catalog, too large for the phone to read (about 8 MB): its monthly prices without
  // tax (hourly × 730) as read on 2026-11-14, [EUR (EU site), CAD (CA site), USD (US site)], shown as approximate. Others unpriced.
  const OVH_PRICES={'d2-2':[7.59,12.19,9.42],'d2-4':[15.04,24.09,18.69],'d2-8':[27.16,43.51,33.65],'c3-4':[33.36,53.44,39.42],'b3-8':[37.38,59.86,44.16],
    'r3-16':[48.40,77.45,57.16],'b2-7':[51.76,82.86,64.17],'c3-8':[66.65,106.65,78.69],'c2-7':[74.31,118.92,92.13],'r2-15':[74.31,118.92,92.13],
    'b3-16':[74.68,119.50,88.18],'r2-30':[85.85,137.39,106.43],'r3-32':[96.65,154.69,114.10],'b2-15':[97.97,156.80,121.40],'c3-16':[133.22,213.16,157.24],
    'c2-15':[144.25,230.83,178.78],'b3-32':[149.36,239.00,176.29],'r2-60':[167.02,267.25,206.95],'r3-64':[193.30,309.30,228.12],'b2-30':[198.20,317.11,245.57]};
  // The names of the earlier and typed-before IDs the read knows but does not list, for their entered-before labels.
  const ovhNames=(s,key,all,list)=>askedFor(s,key).filter(v=>!list.some(x=>x[0]===v)).map(v=>[v,given(get(all.find(x=>x.id===v),'name'))]).filter(x=>x[1]);
  const OVH_SITES=['eu','ca','us'],OVH_CURRENCIES=['EUR','CAD','USD'],ovhSite=s=>Math.max(0,OVH_SITES.indexOf(s.inputs.endpoint));
  // v1 flavors give RAM in GB by the schema, in MB on some answers: either is read as GB, else the name's last number (b2-7: 7 GB).
  const ovhRam=x=>{const r=typeof x.ram==='number'&&Number.isFinite(x.ram)&&x.ram>0?(x.ram>=256?Math.round(x.ram/1000):x.ram):0,n=/-(\d{1,4})$/.exec(x.name);
    return r>=1?r:n&&Number(n[1])>=1?Number(n[1]):null;};
  // A Linux flavor in stock, named <family><generation>-<n> (no Windows, -flex or other variants), not GPU, IOPS or bare metal.
  const ovhFlavor=x=>safe(x.id)&&x.osType==='linux'&&x.available===true&&typeof x.name==='string'&&/^[a-z]\d+-\d+$/.test(x.name)&&
    !/^(t1|t2|l4|a10|a100|h100|h200|i1|bm)-/.test(x.name)&&!!count(x.vcpus)&&ovhRam(x)>=1;
  // Scaleway: one host for every list. Its products are a map of commercial types, paged by x-total-count (100 a page asked).
  const SCW='https://api.scaleway.com',scwZone=s=>SCW+'/instance/v1/zones/'+enc(s.inputs.zone);
  // No API lists the Instance zones; Scaleway's own SDKs hold the same list.
  const SCW_ZONES=[['fr-par-1','Paris, FR'],['fr-par-2','Paris, FR'],['fr-par-3','Paris, FR'],['nl-ams-1','Amsterdam, NL'],['nl-ams-2','Amsterdam, NL'],
    ['nl-ams-3','Amsterdam, NL'],['pl-waw-1','Warsaw, PL'],['pl-waw-2','Warsaw, PL'],['pl-waw-3','Warsaw, PL'],['it-mil-1','Milan, IT']];
  const scwMap=b=>{const m=get(b,'servers');return m&&typeof m==='object'&&!Array.isArray(m)?m:null;};
  const scwMore=(b,response,kept,page)=>{const total=Number(get(response,'headers',{})['x-total-count']),m=scwMap(b);
    return m&&Object.keys(m).length&&Number.isFinite(total)&&total>kept.seen?page+1:null;};
  const scwPrice=x=>{const h=amount(x.hourly_price);return h===null?null:h*730;};
  const gib=v=>{const g=typeof v==='number'&&Number.isFinite(v)&&v>0?v/1073741824:0;return g?g<10?Math.round(g*10)/10:Math.round(g):null;};
  // A type the setup can use as it creates: x86 (the image is), not retired, no GPU or Windows, at least 1 GB, and a local (l_ssd)
  // boot volume. The create sends no volumes, so the root disk follows the image; deletion removes Instance-API volumes only, so
  // a Block Storage (SBS) root would be left billing: only local-disk types with a local-disk Ubuntu image are listed.
  const scwType=(x,k)=>!!x&&typeof x==='object'&&x.arch==='x86_64'&&x.end_of_service!==true&&!(Number(x.gpu)>0)&&!/-WIN$/.test(k)&&
    Number(x.ram)>=1073741824&&Number(get(x,'per_volume_constraint.l_ssd.max_size',0))>0;
  // Google Cloud: a token page (nextPageToken, sent back as pageToken). The phone cannot reach Cloud Billing, so machine types are
  // ordered by this rank of us-central1 list prices, never shown; others follow by size. Only x86 types of the series that boot
  // from the pd-standard disk the create gets (it names no disk type) and the amd64 image it boots: no Arm, GPU or custom types,
  // 1 to 16 GB and at most 4 vCPU. Zones are the region's name and a letter: the address is made in the region, the server in the zone.
  const GCE='https://compute.googleapis.com/compute/v1/projects/',gcpProject=s=>GCE+enc(s.inputs.projectId);
  const tokenNext=b=>typeof b.nextPageToken==='string'&&/^[\x21-\x7e]{1,2048}$/.test(b.nextPageToken)?b.nextPageToken:null;
  const gcpFields=(list,token)=>'&fields='+enc(list)+(token?'&pageToken='+enc(token):'');
  const GCP_RANK=['e2-micro','e2-small','e2-medium','t2d-standard-1','n1-standard-1','e2-standard-2','n2d-standard-2','n2-standard-2'];
  const gcpArm=name=>/^(t2a|c4a|n4a|a4x)-/.test(String(name));
  const gcpType=x=>!!safe(x.name)&&get(x,'deprecated.state','ACTIVE')==='ACTIVE'&&x.architecture!=='ARM64'&&!gcpArm(x.name)&&!items(x.accelerators).length&&
    ['e2','n1','n2','n2d','t2d'].includes(x.name.split('-')[0])&&!/-custom-/.test(x.name)&&!!count(x.guestCpus)&&x.guestCpus<=4&&mb(x.memoryMb)>=1024&&x.memoryMb<=16384;
  // The regions' short names, from Google Cloud's regions table (2026-11): its API names none.
  const GCP_PLACES={'africa-south1':'Johannesburg','asia-east1':'Taiwan','asia-east2':'Hong Kong','asia-northeast1':'Tokyo','asia-northeast2':'Osaka',
    'asia-northeast3':'Seoul','asia-south1':'Mumbai','asia-south2':'Delhi','asia-southeast1':'Singapore','asia-southeast2':'Jakarta','asia-southeast3':'Bangkok',
    'australia-southeast1':'Sydney','australia-southeast2':'Melbourne','europe-central2':'Warsaw','europe-north1':'Finland','europe-north2':'Stockholm',
    'europe-southwest1':'Madrid','europe-west1':'Belgium','europe-west10':'Berlin','europe-west12':'Turin','europe-west2':'London','europe-west3':'Frankfurt',
    'europe-west4':'Netherlands','europe-west6':'Zurich','europe-west8':'Milan','europe-west9':'Paris','me-central1':'Doha','me-central2':'Dammam',
    'me-west1':'Tel Aviv','northamerica-northeast1':'Montreal','northamerica-northeast2':'Toronto','northamerica-south1':'Queretaro',
    'southamerica-east1':'Sao Paulo','southamerica-west1':'Santiago','us-central1':'Iowa','us-east1':'South Carolina','us-east4':'Virginia',
    'us-east5':'Columbus','us-south1':'Dallas','us-west1':'Oregon','us-west2':'Los Angeles','us-west3':'Salt Lake City','us-west4':'Las Vegas'};
  // The earlier, typed-before and usual answers a full per-place list (a zone's machine types, a region's VM sizes) leaves out:
  // they cannot be ordered there. found: which of them the list named, page by page.
  const askedFor=(s,key)=>[s.inputs[key],get(s,'custom.'+key),(OPTIONS[s.provider].find(f=>f.key===key)||{}).default].filter(v=>typeof v==='string');
  const absent=(s,key,x)=>x.partial?[]:awayOf(s,key,v=>!x.found.includes(v),x.list.map(y=>y[0]));
  // Azure: one host for every list, paged by an absolute nextLink, followed only there (any other host would pause the setup).
  // No price API is reachable and its VM-size list says nothing of architecture or generation, while the create boots the x64
  // Gen2 Ubuntu 24.04 image on a Standard SSD: so only these sizes, known to fit, in East US list-price order. No B1ls (0.5 GB) or Arm.
  const AZ='https://management.azure.com',azureSub=s=>AZ+'/subscriptions/'+enc(s.inputs.subscriptionId);
  const azureNext=b=>typeof b.nextLink==='string'&&/^https:\/\/management\.azure\.com\/[\x21-\x7e]{1,2000}$/.test(b.nextLink)&&!/[@#\\]/.test(b.nextLink)?b.nextLink:null;
  const AZURE_SIZES=['Standard_B2ats_v2','Standard_B2ts_v2','Standard_B1s','Standard_B1ms','Standard_B2als_v2','Standard_B2ls_v2','Standard_B2s','Standard_B2as_v2',
    'Standard_B2s_v2','Standard_B2ms','Standard_D2as_v5','Standard_D2s_v5'];
  const GUID=/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  // Oracle Cloud: every list from the region's own host, so only for a listed region (rule H: a typed one could be a DNS failure,
  // which pauses the setup); pages by the opc-next-page header. Its identity host (subscribed regions, compartments, availability
  // domains) is not one the key may reach: the regions are this static oc1 list (Oracle's public regions table, 2026-11-14), the compartment the tenancy's root, and the
  // availability domains those the capacity-reservation list names (it needs inspect compute-capacity-reservations; refused: typed).
  const OCI_REGIONS=[['af-casablanca-1','Casablanca, MA'],['af-johannesburg-1','Johannesburg, ZA'],['ap-batam-1','Batam, ID'],['ap-chuncheon-1','Chuncheon, KR'],
    ['ap-hyderabad-1','Hyderabad, IN'],['ap-kulai-2','Kulai, MY'],['ap-melbourne-1','Melbourne, AU'],['ap-mumbai-1','Mumbai, IN'],
    ['ap-osaka-1','Osaka, JP'],['ap-seoul-1','Seoul, KR'],['ap-singapore-1','Singapore, SG'],['ap-singapore-2','Singapore, SG'],['ap-sydney-1','Sydney, AU'],
    ['ap-tokyo-1','Tokyo, JP'],['ca-montreal-1','Montreal, CA'],['ca-toronto-1','Toronto, CA'],['eu-amsterdam-1','Amsterdam, NL'],['eu-frankfurt-1','Frankfurt, DE'],
    ['eu-madrid-1','Madrid, ES'],['eu-madrid-3','Madrid, ES'],['eu-marseille-1','Marseille, FR'],['eu-milan-1','Milan, IT'],['eu-paris-1','Paris, FR'],
    ['eu-stockholm-1','Stockholm, SE'],['eu-turin-1','Turin, IT'],['eu-zurich-1','Zurich, CH'],['il-jerusalem-1','Jerusalem, IL'],['me-abudhabi-1','Abu Dhabi, AE'],
    ['me-dubai-1','Dubai, AE'],['me-jeddah-1','Jeddah, SA'],['me-riyadh-1','Riyadh, SA'],['mx-monterrey-1','Monterrey, MX'],['mx-queretaro-1','Queretaro, MX'],
    ['sa-bogota-1','Bogota, CO'],['sa-santiago-1','Santiago, CL'],['sa-saopaulo-1','Sao Paulo, BR'],['sa-valparaiso-1','Valparaiso, CL'],['sa-vinhedo-1','Vinhedo, BR'],
    ['uk-cardiff-1','Newport, GB'],['uk-london-1','London, GB'],['us-ashburn-1','Ashburn, US'],['us-chicago-1','Chicago, US'],['us-phoenix-1','Phoenix, US'],
    ['us-sanjose-1','San Jose, US']];
  const ociListed=s=>OCI_REGIONS.some(r=>r[0]===s.inputs.region),ociBase=s=>'https://iaas.'+s.inputs.region+'.oraclecloud.com/20160918';
  const ociGet=(s,path,page)=>ociListed(s)&&request(s,'GET',ociBase(s)+path+'compartmentId='+enc(s.inputs.compartmentId)+(page?'&page='+enc(page):''));
  const ociNext=(b,response)=>{const t=get(response,'headers',{})['opc-next-page'];return typeof t==='string'&&/^[\x21-\x7e]{1,2048}$/.test(t)?t:null;};
  const OCID=/^ocid1\.[a-z0-9]{1,30}\.oc1\.[a-z0-9-]{0,30}\.[a-z0-9]{1,100}$/;
  // The create always asks for 1 OCPU and 2 GB (shapeConfig): only a Flex shape allowing that, and x86 only (the automatic
  // choices target amd64; an Arm shape typed after Other gets its aarch64 image). Its monthly list price for that size in USD,
  // read from Oracle's price list on 2026-11-14 (OCPU-hours and GB-hours × 730); others are listed unpriced and never suggested.
  const OCI_PRICES={'VM.Standard.E3.Flex':20.44,'VM.Standard.E4.Flex':20.44,'VM.Standard.E5.Flex':24.82,'VM.Standard.E6.Flex':24.82,'VM.Standard3.Flex':31.39,'VM.Optimized3.Flex':41.61};
  const ociArm=x=>/^VM\.Standard\.A[0-9]+\./.test(typeof x==='string'?x:String(x.shape||''))||typeof x==='object'&&/\b(Ampere|Arm)\b/i.test(String(x.processorDescription||''));
  const bound=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
  // Whether a shape can run with 1 OCPU and 2 GB: a bound it does not state counts as none (as the checks treat it).
  function ociFits(x) {
    const o=x.ocpuOptions||{},m=x.memoryOptions||{},lo=Math.max(bound(m.minInGBs)||0,bound(m.minPerOcpuInGBs)||0);
    const hi=Math.min(...[bound(m.maxInGBs),bound(m.maxPerOcpuInGBs)].filter(v=>v!==null),Infinity);
    return (bound(o.min)===null||o.min<=1)&&(bound(o.max)===null||o.max>=1)&&lo<=2&&hi>=2;
  }
  const ociShape=x=>!!safe(x.shape)&&x.isFlexible===true&&/^VM\./.test(x.shape)&&!ociArm(x)&&!(Number(x.gpus)>0)&&!(Number(x.localDisks)>0)&&ociFits(x);
  // Canonical's own builds: Canonical-Ubuntu-24.04[-Minimal][-aarch64]-YYYY.MM.DD-n.
  const OCI_IMAGE=/^Canonical-Ubuntu-24\.04-(Minimal-)?(aarch64-)?([0-9]{4}\.[0-9]{2}\.[0-9]{2})-[0-9]+$/;
  // Each provider's main regions, kept when its region list is longer than LONG: about one per large metro, the
  // usual one among them. Only which entries stay; they are shown in the list's own order, and Other reaches the rest.
  const MAIN={vultr:['ewr','ord','dfw','lax','sea','atl','mia','sjc','yto','sao','lhr','ams','fra','cdg','waw','sto','mad','nrt','icn','sgp','syd','bom','jnb'],
    linode:['us-east','us-central','us-west','us-southeast','us-iad','us-ord','us-sea','us-lax','ca-central','br-gru','eu-west','gb-lon','eu-central','fr-par',
      'nl-ams','se-sto','it-mil','es-mad','ap-south','ap-northeast','ap-west','ap-southeast','id-cgk'],
    oci:['us-ashburn-1','us-phoenix-1','us-chicago-1','us-sanjose-1','ca-toronto-1','ca-montreal-1','sa-saopaulo-1','mx-queretaro-1','uk-london-1','eu-frankfurt-1',
      'eu-amsterdam-1','eu-paris-1','eu-zurich-1','eu-stockholm-1','eu-milan-1','eu-madrid-1','me-dubai-1','ap-mumbai-1','ap-singapore-1','ap-tokyo-1','ap-seoul-1',
      'ap-sydney-1','af-johannesburg-1'],
    azure:['eastus','eastus2','centralus','westus2','westus3','southcentralus','canadacentral','brazilsouth','northeurope','westeurope','uksouth','francecentral',
      'germanywestcentral','swedencentral','switzerlandnorth','polandcentral','italynorth','centralindia','southeastasia','japaneast','koreacentral','australiaeast',
      'southafricanorth'],
    gcp:['us-central1','us-east1','us-east4','us-west1','us-west2','us-south1','northamerica-northeast1','southamerica-east1','europe-west1','europe-west2',
      'europe-west3','europe-west4','europe-west9','europe-north1','europe-central2','europe-southwest1','asia-south1','asia-southeast1','asia-east1',
      'asia-northeast1','asia-northeast3','australia-southeast1','me-west1'],
    ovh:['GRA11','GRA9','GRA7','SBG5','SBG7','BHS5','DE1','UK1','WAW1','SGP1','SYD1','US-EAST-VA-1','US-WEST-OR-1','EU-WEST-PAR','EU-SOUTH-MIL','CA-EAST-TOR','AP-SOUTH-MUM']};
  const LOOKUPS={
    vultr:{currency:'USD',lookups:[
      {name:'regions',before:'region',url:()=>V+'/regions?per_page=500',next:pagesLeft('regions'),parse:(s,b)=>Array.isArray(b.regions)&&regionsRead(s,b.regions,'id',items(b.regions)
        .filter(x=>safe(x.id)&&(!Array.isArray(x.connectivity)||x.connectivity.includes('public_ip'))).map(x=>[x.id,where(x.city,x.country)]))},
      {name:'plans',before:'region',url:s=>s.catalog.read.regions&&V+'/plans?per_page=500',next:pagesLeft('plans'),parse:(s,b)=>{
        if(!Array.isArray(b.plans))return null;const at=[];
        for(const p of items(b.plans))for(const r of strs(p.locations))if(safe(r)&&vultrPlan(p,r))cheapest(at,r,vultrPrice(p,r));
        return {at};
      }},
      // The region's own list: a plan it lacks is sold out there. Any refusal (an unknown region answers 401) leaves plans typed.
      {name:'availability',before:'size',url:s=>s.catalog.read.plans&&V+'/regions/'+enc(s.inputs.region)+'/availability',parse:(s,b)=>
        Array.isArray(b.available_plans)&&{open:strs(b.available_plans).filter(id=>safe(id)&&!strs(b.available_vpc_only_plans).includes(id))}},
      {name:'sizes',before:'size',url:s=>s.catalog.read.availability&&V+'/plans?per_page=500',next:pagesLeft('plans'),parse:(s,b)=>{
        if(!Array.isArray(b.plans))return null;const r=s.inputs.region,open=s.catalog.read.availability.open,plans=items(b.plans);
        const here=plans.filter(p=>vultrPlan(p,r)&&open.includes(p.id)).map(p=>[p.id,count(p.vcpu_count),gigs(p.ram),vultrPrice(p,r)]);
        return {list:here,away:awayOf(s,'size',v=>plans.some(p=>p.id===v),here.map(x=>x[0]))};
      }},
      {name:'os',before:'imageId',url:()=>V+'/os?per_page=500',next:pagesLeft('os'),parse:(s,b)=>{
        if(!Array.isArray(b.os))return null;const here=items(b.os).filter(vultrUbuntu).sort((x,y)=>y.id-x.id).map(x=>[String(x.id),place(x.name)]);
        return {list:here,away:awayOf(s,'imageId',v=>items(b.os).some(x=>String(x.id)===v),here.map(x=>x[0]))};
      }}],
    fields:{region:s=>regionList(s,'regions','plans','ewr'),size:s=>sizeList(s,'sizes','vc2-1c-1gb'),
      imageId:s=>s.catalog.read.os&&{keep:true,away:s.catalog.read.os.away,entries:s.catalog.read.os.list.map(([value,rest])=>({value,rest}))}},
    auto:['imageId']},
    linode:{currency:'USD',lookups:[
      {name:'regions',before:'region',url:()=>LN+'/regions?page_size=500',next:linodePages,parse:(s,b)=>Array.isArray(b.data)&&regionsRead(s,b.data,'id',items(b.data)
        .filter(x=>safe(x.id)&&x.status==='ok'&&x.site_type!=='distributed'&&['Linodes','Metadata','Cloud Firewall'].every(c=>strs(x.capabilities).includes(c)))
        .map(x=>[x.id,place(x.label)]))},
      // A bare list of the region's plans, each available or not (sold out): the only signal of what can be ordered now.
      {name:'availability',before:'size',url:s=>LN+'/regions/'+enc(s.inputs.region)+'/availability',parse:(s,b)=>Array.isArray(b)&&
        {open:items(b).filter(x=>x.region===s.inputs.region&&x.available===true&&safe(x.plan)).map(x=>x.plan)}},
      {name:'sizes',before:'size',url:s=>s.catalog.read.availability&&LN+'/linode/types?page_size=500',next:linodePages,parse:(s,b)=>{
        if(!Array.isArray(b.data))return null;const r=s.inputs.region,open=s.catalog.read.availability.open,types=items(b.data);
        const here=types.filter(t=>safe(t.id)&&open.includes(t.id)&&['nanode','standard','dedicated','premium','highmem'].includes(t.class)&&!(t.gpus>0)&&
          !(t.accelerated_devices>0)&&mb(t.memory)>=1024&&!!count(t.vcpus)&&linodePrice(t,r)>0).map(t=>[t.id,count(t.vcpus),gigs(t.memory),linodePrice(t,r)]);
        return {list:here,away:awayOf(s,'size',v=>types.some(t=>t.id===v),here.map(x=>x[0]))};
      }}],
    fields:{region:s=>regionList(s,'regions',null,'us-east'),size:s=>sizeList(s,'sizes','g6-nanode-1')}},
    digitalocean:{currency:'USD',lookups:[
      {name:'plans',before:'region',url:()=>DO+'/sizes?per_page=200',next:pagesLeft('sizes'),parse:(s,b)=>{
        if(!Array.isArray(b.sizes))return null;const at=[];
        for(const x of items(b.sizes))if(doSize(x,0))for(const r of strs(x.regions))if(safe(r))cheapest(at,r,amount(x.price_monthly));
        return {at};
      }},
      {name:'image',before:'region',url:s=>s.catalog.read.plans&&DO+'/images/ubuntu-24-04-x64',parse:(s,b)=>!!get(b,'image.id')&&
        {disk:count(get(b,'image.min_disk_size'))||0,regions:Array.isArray(get(b,'image.regions'))?strs(b.image.regions).filter(safe):null}},
      // The create sends cloud-init, which needs the metadata service: where some region names it, regions without it are left out.
      {name:'regions',before:'region',url:s=>s.catalog.read.plans&&DO+'/regions?per_page=200',next:pagesLeft('regions'),parse:(s,b)=>{
        if(!Array.isArray(b.regions))return null;const all=items(b.regions),meta=all.some(x=>strs(x.features).includes('metadata')),image=s.catalog.read.image;
        return regionsRead(s,all,'slug',all.filter(x=>safe(x.slug)&&x.available===true&&(!meta||strs(x.features).includes('metadata'))&&(!image||!image.regions||image.regions.includes(x.slug)))
          .map(x=>[x.slug,place(x.name)]));
      }},
      {name:'sizes',before:'size',url:s=>s.catalog.read.plans&&DO+'/sizes?per_page=200',next:pagesLeft('sizes'),parse:(s,b)=>{
        if(!Array.isArray(b.sizes))return null;const r=s.inputs.region,disk=get(s,'catalog.read.image.disk',0),sizes=items(b.sizes);
        const here=sizes.filter(x=>doSize(x,disk)&&strs(x.regions).includes(r)).map(x=>[x.slug,count(x.vcpus),gigs(x.memory),amount(x.price_monthly)]);
        return {list:here,away:awayOf(s,'size',v=>sizes.some(x=>x.slug===v),here.map(x=>x[0]))};
      }}],
    fields:{region:s=>regionList(s,'regions','plans','nyc3'),size:s=>sizeList(s,'sizes','s-1vcpu-1gb')}},
    aws:{currency:'USD',lookups:[
      // Regions from us-east-1's endpoint (one is needed before a region is chosen); zones and bundles from the chosen one's.
      {name:'regions',before:'region',request:s=>lightsail(s,'us-east-1','GetRegions',{includeAvailabilityZones:false}),parse:(s,b)=>Array.isArray(b.regions)&&
        {list:items(b.regions).filter(x=>typeof x.name==='string'&&/^[a-z]{2}-[a-z]+-[0-9]{1,2}$/.test(x.name))
          .sort((x,y)=>optIn(x)-optIn(y)||continent(x)-continent(y)||(x.name<y.name?-1:1)).map(x=>[x.name,place(x.displayName)])}},
      // Refused in an opt-in region: most likely not enabled for the account, so the region is asked again with that reason.
      {name:'zones',before:'zone',request:s=>awsListed(s)&&lightsail(s,s.inputs.region,'GetRegions',{includeAvailabilityZones:true}),
        ask:'region',refused:s=>AWS_OPT_IN.includes(s.inputs.region)&&'Lightsail did not answer in '+s.inputs.region+'. It is an opt-in region, which may not be enabled for this account: enable it in your AWS account settings, or choose another region.',
        parse:(s,b)=>{
        const area=items(b.regions).find(x=>x.name===s.inputs.region);if(!area)return null;
        const all=items(area.availabilityZones).filter(z=>safe(z.zoneName)),stated=all.some(z=>Object.prototype.hasOwnProperty.call(z,'state'));
        const here=all.filter(z=>!stated||z.state==='available').map(z=>z.zoneName);
        return {list:here,away:awayOf(s,'zone',()=>true,here)};
      }},
      {name:'bundles',before:'size',pages:3,request:(s,token)=>awsListed(s)&&lightsail(s,s.inputs.region,'GetBundles',Object.assign({includeInactive:false},token?{pageToken:token}:{})),
        next:b=>typeof b.nextPageToken==='string'&&/^[\x21-\x7e]{1,2048}$/.test(b.nextPageToken)?b.nextPageToken:null,parse:(s,b,read)=>{
          if(!Array.isArray(b.bundles))return null;const all=items(b.bundles),was=read||{list:[],seen:[]};
          const here=was.list.concat(all.filter(x=>awsBundle(x)&&!was.list.some(y=>y[0]===x.bundleId)).map(x=>[x.bundleId,count(x.cpuCount),x.ramSizeInGb,amount(x.price)]));
          const seen=[...new Set(was.seen.concat(awayOf(s,'size',v=>all.some(x=>x.bundleId===v),[])))];
          return {list:here,seen,away:seen.filter(v=>!here.some(x=>x[0]===v))};
        }}],
    fields:{region:s=>{const x=regionList(s,'regions',null,'us-east-1',true);
        return x&&Object.assign(x,{entries:x.entries.map(e=>AWS_OPT_IN.includes(e.value)?Object.assign(e,{hold:true,note:'must be enabled first'}):e)});},
      size:s=>sizeList(s,'bundles','micro_3_0'),
      zone:s=>s.catalog.read.zones&&{entries:s.catalog.read.zones.list.map(value=>({value})),base:s.inputs.region+'a',away:s.catalog.read.zones.away}}},
    ovh:{currency:s=>OVH_CURRENCIES[ovhSite(s)],approx:true,prices:' Prices are approximate, per month without tax, from OVHcloud\'s price list.',lookups:[
      // The project list needs an access rule for GET /publicCloud/project, which keys made from the guide before 1.0.6 lack
      // (refused: typed). Then, with v2 refused or failing, v1's list of IDs, which has no names.
      {name:'projects',before:'projectId',pages:5,request:(s,cursor)=>ovhGet(s,'/v2/publicCloud/project',cursor),next:ovhCursor,parse:(s,b,read)=>{
        if(!Array.isArray(b))return null;const was=read?read.list:[];
        return {list:was.concat(items(b).filter(x=>safe(x.id)&&x.resourceStatus==='READY'&&!was.some(y=>y[0]===x.id)).map(x=>[x.id,
          given(get(x,'currentState.name'))||given(get(x,'targetSpec.name'))||given(get(x,'iam.displayName')),get(x,'currentState.mode')==='DISCOVERY'?1:0]))};
      }},
      {name:'projectIds',before:'projectId',request:s=>s.catalog.read.projects===null&&ovhGet(s,'/1.0/cloud/project'),parse:(s,b)=>Array.isArray(b)&&
        {list:strs(b).filter(safe).map(id=>[id,'',0])}},
      // v2's regions (a BETA route) say what each is: only enabled single-zone regions activated for the project, as the create
      // names no availability zone (a 3-AZ region needs one). v1's names alone, by their form, when v2 lists none (refused,
      // failing, or its answer changed shape).
      {name:'regions',before:'region',pages:3,request:(s,cursor)=>ovhGet(s,'/v2/publicCloud/project/'+enc(s.inputs.projectId)+'/reference/region',cursor),next:ovhCursor,
        parse:(s,b,read)=>{
          if(!Array.isArray(b))return null;const was=read?read.list:[];
          const list=was.concat(items(b).filter(x=>safe(x.name)&&x.type==='REGION-1-AZ'&&x.status==='ENABLED'&&x.activated===true&&!was.some(y=>y[0]===x.name))
            .map(x=>[x.name,where(x.datacenterName,x.country)]));
          return {list,away:[...new Set((read&&read.away||[]).concat(regionsRead(s,b,'name',list).away))]};
        }},
      {name:'regionNames',before:'region',request:s=>!get(s,'catalog.read.regions.list.length')&&ovhGet(s,ovhProject(s)+'/region'),parse:(s,b)=>Array.isArray(b)&&regionsRead(s,strs(b).map(name=>({name})),'name',strs(b)
        .filter(n=>safe(n)&&!/-LZ-/.test(n)&&(/^[A-Z]{2,4}[0-9]{1,2}$/.test(n)||/^[A-Z]{2}-[A-Z]+-[A-Z]+-[0-9]+$/.test(n))).map(n=>[n,'']))},
      // The checks' own flavor list: what is in stock there now; one sold out is not available here.
      {name:'flavors',before:'size',request:s=>ovhGet(s,ovhProject(s)+'/flavor?region='+enc(s.inputs.region)),parse:(s,b)=>{
        if(!Array.isArray(b))return null;const all=items(b),price=n=>OVH_PRICES[n]?OVH_PRICES[n][ovhSite(s)]:null;
        const list=all.filter(ovhFlavor).map(x=>[x.id,x.name,count(x.vcpus),ovhRam(x),price(x.name),x.quota===0?1:0,safe(x.type)]);
        return {list,away:awayOf(s,'size',v=>all.some(x=>x.id===v&&x.available===false),list.map(x=>x[0])),names:ovhNames(s,'size',all,list)};
      }},
      // Ubuntu 24.04 as OVHcloud names it (else a plain variant), public and active, for this flavor's type if it names one; the
      // newest and one older.
      {name:'images',before:'imageId',request:s=>ovhGet(s,ovhProject(s)+'/image?osType=linux&region='+enc(s.inputs.region)),parse:(s,b)=>{
        if(!Array.isArray(b))return null;const all=items(b),flavor=items(get(s,'catalog.read.flavors.list',[]).map(x=>({id:x[0],type:x[6]}))).find(x=>x.id===s.inputs.size);
        const fits=all.filter(x=>safe(x.id)&&x.status==='active'&&x.type==='linux'&&x.visibility==='public'&&(x.flavorType==null||!!flavor&&!!flavor.type&&x.flavorType===flavor.type)&&
          typeof x.name==='string'&&/ubuntu/i.test(x.name)&&/24\.04/.test(x.name)&&!/baremetal|gpu|uefi|docker/i.test(x.name));
        const exact=fits.filter(x=>/^Ubuntu 24\.04$/i.test(x.name.trim())),made=x=>String(x.creationDate||'');
        const pick=(exact.length?exact:fits).sort((x,y)=>made(y)<made(x)?-1:made(y)>made(x)?1:0).slice(0,2);
        return {list:pick.map(x=>[x.id,given(x.name),/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(made(x))?made(x).slice(0,10):'']),
          away:awayOf(s,'imageId',v=>all.some(x=>x.id===v),pick.map(x=>x[0])),names:ovhNames(s,'imageId',all,pick.map(x=>[x.id]))};
      }}],
    fields:{
      projectId:s=>{const x=s.catalog.read.projects||s.catalog.read.projectIds;return x&&{account:true,entries:x.list.map(([value,name,trial])=>
        ({value,name,hold:!!trial,note:trial?'discovery mode, no payment method':''}))};},
      region:s=>{const r=s.catalog.read,x=get(r,'regions.list.length')?r.regions:r.regionNames;return x&&{base:OVH_REGION[s.inputs.endpoint]||'GRA11',away:x.away,entries:x.list.map(([value,rest])=>({value,rest}))};},
      // Shown by name (the value is its UUID); one without a known price, or with its quota used up, is never suggested.
      size:s=>{const x=s.catalog.read.flavors;return x&&{sizes:true,away:x.away,names:x.names,entries:x.list.map(([value,name,c,m,price,full])=>
        ({value,name,c,m,price,hold:!!full||!(price>0),note:full?'quota full':''}))};},
      imageId:s=>s.catalog.read.images&&{keep:true,away:s.catalog.read.images.away,names:s.catalog.read.images.names,entries:s.catalog.read.images.list.map(([value,name,rest])=>({value,name,rest}))}},
    auto:['imageId']},
    scaleway:{currency:'EUR',prices:' Prices are per month without VAT.',lookups:[
      // Listing projects needs project read access for the organization, which keys made from the guide may lack (typed then).
      {name:'projects',before:'projectId',pages:5,request:(s,page)=>request(s,'GET',SCW+'/account/v3/projects?page_size=100&order_by=name_asc'+(page>1?'&page='+page:'')),
        next:(b,response,kept,page)=>items(b.projects).length&&Number(b.total_count)>kept.seen?page+1:null,parse:(s,b,read)=>{
          if(!Array.isArray(b.projects))return null;const was=read||{list:[],seen:0};
          return {list:was.list.concat(items(b.projects).filter(x=>safe(x.id)&&!was.list.some(y=>y[0]===x.id)).map(x=>[x.id,given(x.name),given(x.description)])),
            seen:was.seen+b.projects.length};
        }},
      // Before the type: the zone's local-disk Ubuntu 24.04 images, its types and what is in stock. Without such an image nothing
      // can be listed, so the rest are not read.
      {name:'images',before:'size',request:s=>request(s,'GET',SCW+'/marketplace/v2/local-images?image_label=ubuntu_noble&zone='+enc(s.inputs.zone)+'&arch=x86_64&page_size=100'),
        parse:(s,b)=>{
          if(!Array.isArray(b.local_images))return null;
          const list=items(b.local_images).filter(x=>safe(x.id)&&x.type==='instance_local'&&x.arch==='x86_64'&&x.zone===s.inputs.zone&&x.label==='ubuntu_noble')
            .map(x=>[x.id,strs(x.compatible_commercial_types).filter(safe)]).filter(x=>x[1].length);
          return list.length&&{list};
        }},
      {name:'types',before:'size',pages:5,request:(s,page)=>s.catalog.read.images&&request(s,'GET',scwZone(s)+'/products/servers?per_page=100&page='+(page||1)),next:scwMore,
        parse:(s,b,read)=>{
          const map=scwMap(b);if(!map)return null;
          const was=read||{list:[],seen:0,gone:[]},fits=items(get(s,'catalog.read.images.list',[]).map(x=>({types:x[1]}))).flatMap(x=>strs(x.types)),keys=Object.keys(map).filter(safe);
          const asked=[s.inputs.size,get(s,'custom.size'),'DEV1-S'];
          return {list:was.list.concat(keys.filter(k=>scwType(map[k],k)&&fits.includes(k)&&!was.list.some(x=>x[0]===k)).map(k=>[k,count(map[k].ncpus),gib(map[k].ram),scwPrice(map[k])])),
            seen:was.seen+Object.keys(map).length,gone:[...new Set(was.gone.concat(keys.filter(k=>asked.includes(k)&&get(map[k],'end_of_service')===true)))]};
        }},
      // available, scarce (low stock: listed, never suggested) or shortage (cannot be ordered now: left out). Kept for the types
      // listed and the earlier, typed and usual answers only.
      {name:'availability',before:'size',pages:5,request:(s,page)=>s.catalog.read.types&&request(s,'GET',scwZone(s)+'/products/servers/availability?per_page=100&page='+(page||1)),
        next:scwMore,parse:(s,b,read)=>{
          const map=scwMap(b);if(!map)return null;
          const was=read||{open:[],out:[],seen:0},want=s.catalog.read.types.list.map(x=>x[0]).concat([s.inputs.size,get(s,'custom.size'),'DEV1-S']);
          const now=k=>get(map[k],'availability'),here=Object.keys(map).filter(k=>safe(k)&&want.includes(k));
          return {open:[...new Set(was.open.concat(here.filter(k=>now(k)==='available')))],out:[...new Set(was.out.concat(here.filter(k=>now(k)==='shortage')))],
            seen:was.seen+Object.keys(map).length};
        }}],
    fields:{
      projectId:s=>{const x=s.catalog.read.projects;return x&&{account:true,base:(x.list.find(p=>p[1]==='default')||[])[0],entries:x.list.map(([value,name,rest])=>({value,name,rest}))};},
      zone:()=>({keep:true,base:'fr-par-1',entries:SCW_ZONES.map(([value,rest])=>({value,rest}))}),
      size:s=>{const r=s.catalog.read,t=r.types,a=r.availability;if(!t||!a)return null;
        return {sizes:true,base:'DEV1-S',partial:t.partial||a.partial,away:t.gone.concat(a.out),entries:t.list.filter(x=>!a.out.includes(x[0])).map(([value,c,m,price])=>
          ({value,c,m,price,hold:!a.open.includes(value),note:a.open.includes(value)?'':'low stock'}))};},
      // The local-disk image this type can boot: normally one, filled in without asking.
      imageId:s=>s.catalog.read.images&&{keep:true,entries:s.catalog.read.images.list.filter(x=>x[1].includes(s.inputs.size)).map(([value])=>({value,name:'Ubuntu 24.04 Noble',rest:'local disk'}))}},
    auto:['imageId']},
    gcp:{lookups:[
      // Listing projects needs the Cloud Resource Manager API enabled in the key's project, which the guide made optional (refused: typed).
      {name:'projects',before:'projectId',pages:3,request:(s,token)=>request(s,'GET','https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState%3AACTIVE&pageSize=50'+
        (token?'&pageToken='+enc(token):'')),next:tokenNext,parse:(s,b,read)=>{
          if(!Array.isArray(b.projects))return null;const was=read?read.list:[];
          return {list:was.concat(items(b.projects).filter(x=>x.lifecycleState==='ACTIVE'&&typeof x.projectId==='string'&&SETTING.test(x.projectId)&&!was.some(y=>y[0]===x.projectId))
            .map(x=>[x.projectId,given(x.name)===x.projectId?'':given(x.name)]))};
        }},
      // One list gives the regions and their zones: zones up and not deprecated, grouped by the region they name.
      {name:'zones',before:'region',pages:2,request:(s,token)=>request(s,'GET',gcpProject(s)+'/zones?maxResults=500'+gcpFields('items(name,status,region,deprecated/state),nextPageToken',token)),
        next:tokenNext,parse:(s,b,read)=>{
          if(!Array.isArray(b.items))return null;const at=read?read.at:[],seen=read&&read.seen||[];
          for(const z of items(b.items)){
            const r=String(z.region||'').split('/').pop();
            if(askedFor(s,'region').includes(r)&&!seen.includes(r))seen.push(r); // Named, if only with zones down.
            if(!safe(z.name)||!safe(r)||z.status!=='UP'||get(z,'deprecated.state','ACTIVE')!=='ACTIVE'||!z.name.startsWith(r+'-'))continue;
            const x=at.find(y=>y[0]===r);if(!x)at.push([r,[z.name]]);else if(!x[1].includes(z.name))x[1].push(z.name);
          }
          return {at,seen};
        }},
      {name:'types',before:'size',pages:3,request:(s,token)=>request(s,'GET',gcpProject(s)+'/zones/'+enc(s.inputs.zone)+'/machineTypes?maxResults=500'+
        gcpFields('items(name,guestCpus,memoryMb,isSharedCpu,architecture,accelerators,deprecated/state),nextPageToken',token)),next:tokenNext,parse:(s,b,read)=>{
          if(!Array.isArray(b.items))return null;const was=read||{list:[],found:[]},all=items(b.items);
          return {list:was.list.concat(all.filter(x=>gcpType(x)&&!was.list.some(y=>y[0]===x.name)).map(x=>[x.name,count(x.guestCpus),Math.round(x.memoryMb/10.24)/100,x.isSharedCpu===true?1:0])),
            found:[...new Set(was.found.concat(askedFor(s,'size').filter(v=>all.some(x=>x.name===v))))]};
        }}],
    fields:{
      projectId:s=>s.catalog.read.projects&&{account:true,entries:s.catalog.read.projects.list.map(([value,rest])=>({value,rest}))},
      // us-* first, then by name; us-central1 (the usual one, with the e2-micro free tier) suggested.
      region:s=>{const z=s.catalog.read.zones;return z&&{keep:true,base:'us-central1',away:awayOf(s,'region',v=>strs(z.seen).includes(v),z.at.map(x=>x[0])),entries:z.at.map(x=>x[0])
        .sort((a,b)=>(!a.startsWith('us-'))-(!b.startsWith('us-'))||(a<b?-1:a>b?1:0)).map(value=>({value,rest:GCP_PLACES[value]||''}))};},
      // Only the chosen region's zones: a zone elsewhere (the usual us-central1-a for europe-west1, say) is not available here.
      zone:s=>{const z=s.catalog.read.zones,here=z&&(z.at.find(x=>x[0]===s.inputs.region)||[])[1];
        return here&&{base:'us-central1-a',away:awayOf(s,'zone',v=>z.at.some(x=>x[1].includes(v)),here),entries:here.map(value=>({value}))};},
      size:s=>{const x=s.catalog.read.types;return x&&{sizes:true,ranked:true,base:'e2-small',partial:x.partial,away:absent(s,'size',x),entries:x.list.map(([value,c,m,shared])=>
        ({value,c,m,rank:GCP_RANK.includes(value)?GCP_RANK.indexOf(value):undefined,note:shared?'shared core':''}))};}}},
    azure:{lookups:[
      {name:'subscriptions',before:'subscriptionId',pages:3,request:(s,link)=>request(s,'GET',link||AZ+'/subscriptions?api-version=2022-12-01'),next:azureNext,parse:(s,b,read)=>{
        if(!Array.isArray(b.value))return null;const was=read?read.list:[];
        return {list:was.concat(items(b.value).filter(x=>x.state==='Enabled'&&typeof x.subscriptionId==='string'&&GUID.test(x.subscriptionId)&&!was.some(y=>y[0]===x.subscriptionId))
          .map(x=>[x.subscriptionId,given(x.displayName)]))};
      }},
      // Physical regions only (no logical "unitedstates" or edge zone), Azure's recommended ones first, then US ones, then by name.
      // Its other regions often need an access request: listed, never suggested.
      {name:'regions',before:'region',request:s=>request(s,'GET',azureSub(s)+'/locations?api-version=2022-12-01'),parse:(s,b)=>{
        if(!Array.isArray(b.value))return null;
        const fit=items(b.value).filter(x=>safe(x.name)&&get(x,'metadata.regionType')==='Physical'&&[undefined,null,'Region'].includes(x.type)&&
          ['Recommended','Other'].includes(get(x,'metadata.regionCategory')));
        const key=x=>[get(x,'metadata.regionCategory')==='Recommended'?0:1,get(x,'metadata.geographyGroup')==='US'?0:1,String(x.displayName||x.name)];
        fit.sort((x,y)=>{const a=key(x),c=key(y);return a[0]-c[0]||a[1]-c[1]||(a[2]<c[2]?-1:a[2]>c[2]?1:0);});
        return regionsRead(s,b.value,'name',fit.map(x=>[x.name,place(x.displayName),get(x,'metadata.regionCategory')==='Recommended'?0:1]));
      }},
      // The checks' own VM-size list: every size the region offers this subscription.
      {name:'sizes',before:'size',request:s=>request(s,'GET',azureSub(s)+'/providers/Microsoft.Compute/locations/'+enc(s.inputs.region)+'/vmSizes?api-version=2024-07-01'),parse:(s,b)=>{
        if(!Array.isArray(b.value))return null;const all=items(b.value);
        const list=AZURE_SIZES.map((n,rank)=>[all.find(x=>x.name===n),rank]).filter(([x])=>x&&mb(x.memoryInMB)>=1024&&!!count(x.numberOfCores))
          .map(([x,rank])=>[x.name,count(x.numberOfCores),gigs(x.memoryInMB),rank]);
        return {list,found:askedFor(s,'size').filter(v=>all.some(x=>x.name===v))};
      }}],
    fields:{
      // Shown by name (two of the same name with their ID's start, as every account list).
      subscriptionId:s=>{const x=s.catalog.read.subscriptions;return x&&{account:true,entries:x.list.map(([value,name])=>({value,name}))};},
      // Azure's "Other" regions are listed, never suggested, and marked (briefly: the native list cuts long labels): some need an access request.
      region:s=>{const x=s.catalog.read.regions;return x&&{keep:true,base:'eastus',away:x.away,entries:x.list.map(([value,rest,other])=>({value,rest,hold:!!other,note:other?'may need approval':''}))};},
      size:s=>{const x=s.catalog.read.sizes;return x&&{sizes:true,ranked:true,base:'Standard_B1s',away:absent(s,'size',x),entries:x.list.map(([value,c,m,rank])=>({value,c,m,rank}))};}}},
    oci:{currency:'USD',approx:true,prices:' Prices are approximate, per month in USD for 1 OCPU and 2 GB RAM, from Oracle\'s price list; the boot volume is extra.',lookups:[
      // The availability domains of the region: those Oracle lists shapes for, noting where the usual E4 Flex (else E3 Flex) is.
      {name:'domains',before:'zone',pages:5,request:(s,page)=>ociGet(s,'/computeCapacityReservationInstanceShapes?limit=100&',page),next:ociNext,parse:(s,b,read)=>{
        if(!Array.isArray(b))return null;const at=read?read.at:[];
        for(const x of items(b)){
          if(!safe(x.availabilityDomain))continue;
          const rank=x.instanceShape==='VM.Standard.E4.Flex'?0:x.instanceShape==='VM.Standard.E3.Flex'?1:2,y=at.find(d=>d[0]===x.availabilityDomain);
          if(!y)at.push([x.availabilityDomain,rank]);else y[1]=Math.min(y[1],rank);
        }
        return {at};
      }},
      // The shapes in that availability domain the create can use; the checks list them for the image too.
      {name:'shapes',before:'size',pages:5,request:(s,page)=>ociGet(s,'/shapes?availabilityDomain='+enc(s.inputs.zone)+'&limit=100&',page),next:ociNext,parse:(s,b,read)=>{
        if(!Array.isArray(b))return null;const was=read?read.list:[];
        return {list:was.concat(items(b).filter(x=>ociShape(x)&&!was.some(y=>y[0]===x.shape)).map(x=>[x.shape,OCI_PRICES[x.shape]||null]))};
      }},
      // Canonical's Ubuntu 24.04 builds for that shape, newest first: the newest full (not Minimal) one is filled in.
      {name:'images',before:'imageId',request:s=>ociGet(s,'/images?operatingSystem=Canonical%20Ubuntu&operatingSystemVersion=24.04&shape='+enc(s.inputs.size)+
        '&lifecycleState=AVAILABLE&sortBy=TIMECREATED&sortOrder=DESC&limit=50&'),parse:(s,b)=>{
          if(!Array.isArray(b))return null;const arm=ociArm(s.inputs.size),made=x=>String(x.timeCreated||'');
          const fits=items(b).filter(x=>typeof x.id==='string'&&OCID.test(x.id)&&SETTING.test(x.id)&&x.lifecycleState==='AVAILABLE'&&/ubuntu/i.test(String(x.operatingSystem||''))&&
            /24\.04/.test(String(x.operatingSystemVersion||''))&&OCI_IMAGE.test(String(x.displayName))&&!!OCI_IMAGE.exec(x.displayName)[2]===arm)
            .sort((x,y)=>(!!OCI_IMAGE.exec(x.displayName)[1]-!!OCI_IMAGE.exec(y.displayName)[1])||(made(y)<made(x)?-1:made(y)>made(x)?1:0));
          return {list:fits.slice(0,1).map(x=>{const m=OCI_IMAGE.exec(x.displayName);return [x.id,'Ubuntu 24.04'+(m[1]?' Minimal':''),'build '+m[3]];})};
        }}],
    fields:{
      // The root compartment: the tenancy OCID the credential names (not a secret); another one by Other.
      compartmentId:s=>typeof s.tenancyId==='string'&&{keep:true,account:true,entries:[{value:s.tenancyId,name:'Root compartment'}]},
      region:()=>({base:'us-ashburn-1',entries:OCI_REGIONS.map(([value,rest])=>({value,rest}))}),
      zone:s=>{const x=s.catalog.read.domains;if(!x)return null;const sorted=x.at.slice().sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
        const best=sorted.reduce((a,d)=>!a||d[1]<a[1]?d:a,null);
        return {keep:true,base:best&&best[0],entries:sorted.map(([value])=>({value,name:value.split(':').pop()}))};},
      // Every shape gets 1 OCPU and 2 GB (the message says so): the labels name only the shape and price. The usual E4 Flex
      // first among equal prices; one without a known price is never suggested.
      size:s=>{const x=s.catalog.read.shapes;return x&&{sizes:true,base:'VM.Standard.E4.Flex',partial:x.partial,entries:x.list.map(([value,price])=>
        ({value,price,rank:value==='VM.Standard.E4.Flex'?0:undefined,hold:!(price>0)}))};},
      imageId:s=>s.catalog.read.images&&{keep:true,entries:s.catalog.read.images.list.map(([value,name,rest])=>({value,name,rest}))}},
    auto:['imageId']}
  };
  // A region question's entries: the regions read, where the sizes read (prices) say something can be ordered, if they were read.
  function regionList(s,name,prices,base,keep) {
    const read=s.catalog.read,x=read[name],at=prices&&get(read[prices],'at');
    if(!x||prices&&!Array.isArray(at))return null;
    const cost=id=>{const p=at&&at.find(y=>y[0]===id);return p?p[1]:null;};
    return {keep,base,away:(x.away||[]).concat(x.list.filter(([id])=>at&&cost(id)===null).map(r=>r[0])),
      entries:x.list.filter(([id])=>!at||cost(id)!==null).map(([value,rest])=>({value,rest,price:cost(value)}))};
  }
  function sizeList(s,name,base) {
    const x=s.catalog.read[name];
    return x&&{sizes:true,base,partial:x.partial,away:x.away,entries:x.list.map(([value,c,m,price])=>({value,c,m,price}))};
  }
  // A listed question from what was read: sizes cheapest first (then smaller), with the cheapest suggested, unless the read was
  // cut short (more pages than read), when the usual answer is suggested if listed; regions by name (Lightsail's by continent),
  // the cheapest suggested, the usual one at equal prices or with none.
  // An entry may also carry name (shown in place of an opaque id: an OVHcloud flavor's UUID), note (said last: "low stock") and
  // hold (listed, never suggested: low on stock, quota full, a project that cannot pay). With every entry held, the usual one
  // or the first is suggested. ranked: sizes ordered by rank stand for cheapest first though unpriced.
  function listing(s,key) {
    const from=LOOKUPS[s.provider],make=from.fields[key],x=make&&s.catalog&&s.catalog.read&&make(s);
    if(!x)return null;
    // Any value a setting may hold (rule E): Oracle Cloud's OCIDs are longer than the identifiers a reason repeats (safe).
    const seen=new Set(),entries=items(x.entries).filter(e=>typeof e.value==='string'&&SETTING.test(e.value)&&!seen.has(e.value)&&!!seen.add(e.value));
    if(!entries.length)return null;
    const shownName=e=>given(e.name)||e.value,cost=e=>typeof e.price==='number'&&e.price>0?e.price:Infinity,priced=entries.some(e=>cost(e)<Infinity);
    // rank: a static list-price order where the API gives no prices (Google Cloud, Azure), or a tie broken (Oracle Cloud's E4).
    const rank=e=>typeof e.rank==='number'?e.rank:Infinity;
    const name=(a,b)=>shownName(a)<shownName(b)?-1:shownName(a)>shownName(b)?1:a.value<b.value?-1:a.value>b.value?1:0;
    const base=entries.find(e=>e.value===x.base);
    let suggested;
    if(x.sizes){
      entries.sort((a,b)=>(cost(a)-cost(b)||0)||(rank(a)-rank(b)||0)||((a.m||0)-(b.m||0))||((a.c||0)-(b.c||0))||name(a,b));
      const open=entries.find(e=>!e.hold);
      suggested=x.partial&&base&&!base.hold?x.base:(open||base||entries[0]).value;
    } else {
      if(!x.keep)entries.sort(name);
      const open=entries.filter(e=>!e.hold),pool=open.length?open:entries,low=Math.min(...pool.map(cost)),least=pool.filter(e=>cost(e)===low);
      suggested=(least.find(e=>e.value===x.base)||(!open.length&&base)||least[0]).value;
    }
    const currency=typeof from.currency==='function'?from.currency(s):from.currency;
    // An account's list (projects, subscriptions) suggests only what the provider marks (Scaleway's default project): the
    // first by name is selected, not called suggested. Two of the same name are told apart by their ID's start.
    const mark=e=>e.value===suggested&&(!x.account||!!base&&base.value===suggested)?' (suggested)':'';
    const twin=e=>!!x.account&&!!given(e.name)&&entries.filter(y=>given(y.name)===given(e.name)).length>1;
    // What an entry's label says after its name: a size's price and specs, else its place or description (the review's too).
    const shows=e=>x.sizes?[cost(e)<Infinity&&currency?(from.approx?'~':'')+money(e.price,currency)+'/mo':'',
      [e.c&&e.c+' vCPU',e.m&&e.m+' GB RAM'].filter(Boolean).join(', ')]:[place(e.rest)||given(e.rest)];
    const full=entries.map(e=>({value:e.value,label:[shownName(e)+mark(e),(!x.sizes&&twin(e)?[e.value.slice(0,8)]:[]).concat(shows(e)).filter(Boolean).join(' · '),
      typeof e.note==='string'?e.note:''].filter(Boolean).join(' · ')}));
    const away=Array.isArray(x.away)?x.away:[];
    // A long list (Oracle Cloud's regions, a large account's projects) keeps the provider's main regions (MAIN), then the
    // first ones as listed; the others are reached by Other.
    let within;
    if(!x.sizes&&entries.length>LONG){
      const main=key==='region'&&MAIN[s.provider]||[];
      within=(kept=>v=>kept.has(v))(new Set(entries.filter(e=>main.includes(e.value)).concat(entries.filter(e=>!main.includes(e.value))).slice(0,LONG).map(e=>e.value)));
    }
    // Names known for values not listed (an OVHcloud flavor sold out there), from the read.
    const knownNames=Array.isArray(x.names)?x.names:[];
    const named=v=>{const e=entries.find(y=>y.value===v),k=knownNames.find(y=>Array.isArray(y)&&y[0]===v);
      const n=given(e?e.name:k&&k[1]),detail=key==='imageId'&&e?given(e.rest):'';return n&&n!==v?[n,detail].filter(Boolean).join(' · '):detail;};
    // The review's words for a value (1.0.7): its name where the value is an ID, and what its label says after the name.
    const about=v=>{const e=entries.find(y=>y.value===v),k=knownNames.find(y=>Array.isArray(y)&&y[0]===v),n=given(e?e.name:k&&k[1]);
      return {name:n&&n!==v?n:'',detail:e?shows(e).concat(typeof e.note==='string'?e.note:'').filter(Boolean).join(' · '):''};};
    return {full,suggested,sorted:!!x.sizes&&(priced||!!x.ranked)&&!x.partial,priced:!!x.sizes&&priced&&!!currency,cap:x.sizes?LISTED:Infinity,lead:!!x.sizes&&suggested!==entries[0].value,
      away:v=>away.includes(v)&&!full.some(o=>o.value===v),within,named,about};
  }
  // The lookup the question at optionIndex waits for, if any.
  function lookupDue(s) {
    const from=LOOKUPS[s.provider];
    if(!from||!s.catalog||typeof s.catalog!=='object')return null;
    if(!s.catalog.read||typeof s.catalog.read!=='object'||Array.isArray(s.catalog.read))s.catalog.read={};
    const keys=[...OPTIONS[s.provider],SSH_FIELD].map(f=>f.key),at=s.optionIndex||0;
    return from.lookups.find(l=>!Object.prototype.hasOwnProperty.call(s.catalog.read,l.name)&&keys.indexOf(l.before)<=at)||null;
  }
  // The question at optionIndex answered from its list without asking (auto), or null.
  function automatic(s) {
    const from=LOOKUPS[s.provider],f=OPTIONS[s.provider][s.optionIndex||0];
    if(!from||!f||!(from.auto||[]).includes(f.key)||s.typing===f.key)return null;
    const found=listing(s,f.key),custom=get(s,'custom.'+f.key);
    return found&&found.full.length===1&&(!custom||custom===found.full[0].value)?found.full[0].value:null;
  }
  // A lookup ends: what it kept, or null; then the questions go on.
  function looked(s,value) {
    const r=s.catalogRead;delete s.catalogRead;
    if(r&&s.catalog&&s.catalog.read&&typeof r.name==='string'&&LOOKUPS[s.provider].lookups.some(l=>l.name===r.name))s.catalog.read[r.name]=value||null;
    s.phase='options';return render(s);
  }
  // A lookup's answer. A busy or failing provider (429, 5xx) gets one more try after a short wait (its Retry-After, at most 10 s).
  function lookupResult(s,event,b,status) {
    const r=s.catalogRead,l=r&&LOOKUPS[s.provider].lookups.find(x=>x.name===r.name);
    if(!l||!s.catalog)return looked(s,null);
    if(r.wait){delete r.wait;r.attempt=1;return render(s);}
    if(status>=200&&status<300&&b&&typeof b==='object'){
      // Some lists page by a response header (OVHcloud's cursor, Scaleway's total count): parse and next see the response too.
      let kept,more;try{kept=l.parse(s,b,r.read,event.result)||null;more=kept&&l.next&&l.next(b,event.result,kept,r.page);}catch(_){kept=null;}
      if(!kept)return looked(s,null);
      // Further pages in order, up to the cap; past it, what was read is used without claiming the cheapest.
      if(more&&r.page<(l.pages||1)){r.page++;r.token=more;r.read=kept;r.attempt=0;return render(s);}
      if(more)kept.partial=true;
      return looked(s,kept);
    }
    // A refusal that says the answer before is unusable (a Lightsail opt-in region not enabled): that question again, with why.
    const why=status>=400&&status<500&&status!==429&&l.refused&&l.refused(s);
    if(why){
      delete s.catalogRead;delete s.inputs[l.ask];s.optionIndex=[...OPTIONS[s.provider],SSH_FIELD].findIndex(f=>f.key===l.ask);
      s.optionProblem=why;s.phase='options';return render(s);
    }
    if((status===429||status>=500)&&!r.attempt){
      const after=Number(get(event,'result.headers',{})['retry-after']);
      r.wait=Math.round(Math.min(Number.isFinite(after)&&after>0?after*1000:2000,10000));return render(s);
    }
    return looked(s,null);
  }
  // Whether the provider's lists were read this time (some of them, for LOOKUPS).
  const catalogued=s=>!!s.catalog&&(!LOOKUPS[s.provider]||Object.values(s.catalog.read||{}).some(Boolean));
  // The settings question at optionIndex, as asked: listed from the catalog when it lists answers for it (unless Other was
  // chosen there: typing), else typed with the earlier answer or the usual default. After Other, a type the catalog knows
  // cannot be ordered in this location is not filled in again (cx23 where it is sold out): the suggestion is.
  function optionField(s) {
    const f=[...OPTIONS[s.provider],SSH_FIELD][s.optionIndex||0],listed=s.catalog&&choices(s,f.key),typed=typedDefault(s,f);
    if(listed&&s.typing!==f.key)return Object.assign({},f,{type:'select',default:listed.default,options:listed.options});
    const asked=Object.assign({},f,typed?{default:listed&&listed.away(typed)?listed.suggested:typed}:{});
    // A fixed list (OVHcloud's API sites) also lists its selected answer first: a voice "yes" takes the first choice.
    if(Array.isArray(asked.options))asked.options=asked.options.filter(o=>o.value===asked.default).concat(asked.options.filter(o=>o.value!==asked.default));
    return asked;
  }
  // A typed question's prefilled answer: the earlier one, else the usual one, unless an answer before rules it out (1.0.6):
  // a zone of another region (us-east-1a after ap-south-1) becomes the region's first, and OVHcloud's region on another API
  // site (GRA11 on the CA site) that site's own.
  function typedDefault(s,f) {
    const earlier=s.inputs[f.key],r=s.inputs.region;
    if(f.key==='zone'&&['aws','gcp'].includes(s.provider)&&typeof r==='string'&&SETTING.test(r)){
      const head=s.provider==='aws'?r:r+'-';
      return typeof earlier==='string'&&earlier.startsWith(head)&&earlier.length>head.length?earlier:head+'a';
    }
    if(s.provider==='ovh'&&f.key==='region'){
      const site=OVH_REGION[s.inputs.endpoint]||f.default;
      return !earlier||Object.values(OVH_REGION).includes(earlier)&&earlier!==site?site:earlier;
    }
    return earlier||f.default;
  }
  // Where the settings questions start, every time they are asked: an automatic setup with a provider catalog reads it
  // again first, so what is sold out is current (also after Change server settings or other credentials). Other providers'
  // lookups (LOOKUPS) start afresh and run as their questions come.
  function ask(s) {
    s.optionIndex=0;for(const key of ['optionProblem','catalog','catalogRead','typing'])delete s[key];
    if(s.mode==='automatic'&&CATALOG[s.provider]&&s.credentialRef){s.catalogRead={at:0,page:1,types:[],places:[]};s.phase='catalog';}
    else {s.phase='options';if(s.mode==='automatic'&&LOOKUPS[s.provider]&&s.credentialRef)s.catalog={read:{}};}
  }
  // The catalog read ends: kept when it lists something to order, else (any refused, failed or odd answer) the questions
  // are typed as before, and the read-only checks still say what is wrong. It never stops the setup.
  function catalogDone(s,failed) {
    const r=s.catalogRead;delete s.catalogRead;delete s.catalog;
    if(!failed&&r&&Array.isArray(r.types)&&Array.isArray(r.places)){
      const listed=r.places.filter(p=>r.types.some(t=>t.at.some(a=>a[0]===p[0]))),ipv4=(r.ipv4||[]).filter(p=>listed.some(l=>l[0]===p[0]));
      if(listed.length)s.catalog=Object.assign({locations:listed,types:r.types},r.currency?{currency:r.currency}:{},r.currency&&ipv4.length?{ipv4}:{});
    }
    s.phase='options';s.optionIndex=0;return render(s);
  }
  // The name the review shows beside a listed answer's opaque ID (an OVHcloud flavor's UUID: d2-2), or none (typed).
  function nameOf(s,key,value) {
    const listed=value&&s.catalog&&choices(s,key),n=listed&&listed.named&&listed.named(value);
    if(n)s.names=Object.assign(s.names||{},{[key]:n});
    else if(s.names){delete s.names[key];if(!Object.keys(s.names).length)delete s.names;}
  }
  // What the review says of an answer the lists know (1.0.7), kept with the value it describes, since the lists go before the
  // checks: labels[key] = [value, name or '', detail, note]. Typed values the lists know get it too; others none. Shown only
  // while the setting still holds that value; dropped with names. It never changes how the questions go: anything odd, none.
  function labelOf(s,key,value) {
    let x={};try{const found=value&&s.catalog&&(LOOKUPS[s.provider]?listing(s,key):hetznerList(s,key));x=found&&found.about&&found.about(value)||{};}catch(_){x={};}
    if(x.name||x.detail||x.note)s.labels=Object.assign(s.labels||{},{[key]:[value,x.name||'',x.detail||'',x.note||'']});
    else if(s.labels){delete s.labels[key];if(!Object.keys(s.labels).length)delete s.labels;}
  }
  // The question's explanation, which the native review shows under its title: the question itself, what is listed or what
  // to type, prices, and how to give another answer.
  function optionMessage(s,current) {
    const asked=(QUESTIONS[s.provider]||{})[current.key],here=whereOf(s),other=LOOKUPS[s.provider];
    // Listed from what was read: a list ending in Other (OVHcloud's fixed API account regions have none).
    const listed=!!current.options&&!!s.catalog&&current.options.some(o=>o.value===OTHER);
    if(!asked)return '';
    if(!listed)return asked[0]+' '+fill(s,asked[2]);
    const how=current.key==='size'||other?choices(s,current.key)||{}:{},c=s.catalog,ip=!other&&how.priced&&(c.ipv4||[]).find(p=>p[0]===s.inputs.region);
    // Hetzner's server prices leave out the public IPv4 address; the others' plans include one.
    return asked[0]+' '+fill(s,asked[1].replace('{where}',here)).replace('{order}',how.sorted?(how.earlier?', your earlier answer first, then cheapest first':
      how.lead?', the suggested one first, then cheapest first':', cheapest first'):'')+
      (how.priced?other?other.prices||' Prices are per month.':' Prices are per month for the server alone; its public IPv4 address '+(ip?'adds '+money(ip[1],c.currency)+' a month.':'costs a little extra.'):'')+
      ' For another one, choose Other.';
  }

  // VPN Setup 1.0.7: a confirm step also carries `review`, the readable form the native review lays out (docs/workflows.md):
  // a heading, sections of label/value rows, notes and https links, in plain English; `summary` stays as it was, for apps
  // before it. Each value is what will be sent, or what the lists said of that very value. Text from a provider (a host, a
  // name) loses control and format characters, bidi marks among them, and every text is cut within the limits, which count
  // UTF-16 units (as Java and JavaScript strings do), never inside a character.
  const LIMIT={heading:120,title:60,label:40,value:300,note:160,text:300,link:60,url:300,sections:8,rows:12,notes:4,links:2};
  const own=(o,k)=>o&&typeof o==='object'&&Object.prototype.hasOwnProperty.call(o,k)?o[k]:undefined;
  // A no-break space stays one: it holds a number to its unit (glue).
  const words=(v,max)=>{if(typeof v!=='string'&&!(typeof v==='number'&&Number.isFinite(v)))return '';
    const t=String(v).replace(/\p{C}+/gu,' ').replace(/[^\S\u00a0]+/g,' ').trim();if(t.length<=max)return t;
    let cut='';for(const c of t){if(cut.length+c.length>max-3)break;cut+=c;}return cut.trimEnd()+'...';};
  // A row, or null without a value. tone: 'warning' or 'muted'.
  const row=(label,value,note,tone)=>{const v=words(value,LIMIT.value),n=words(note,LIMIT.note);
    return v?Object.assign({label:words(label,LIMIT.label)||'Item',value:v},n?{note:n}:{},tone?{tone}:{}):null;};
  // A section of the rows that have a value, or null; past twelve the last one says how many more the summary holds. The rows
  // in `last` (what this phone removes) come after them and are never among those counted.
  function section(title,rows,last) {
    const tail=(last||[]).filter(Boolean),all=rows.filter(Boolean),room=LIMIT.rows-tail.length,more=all.length-room+1;
    return all.length+tail.length?{title:words(title,LIMIT.title),rows:(more>1?all.slice(0,room-1).concat(row('More',more+' more, in the full summary')):all).concat(tail)}:null;
  }
  // notes: [tone, text], tone 'info', 'warning' or 'danger'; links: [label, https URL]. null without a section.
  function review(heading,sections,notes,links) {
    const r=Object.assign(words(heading,LIMIT.heading)?{heading:words(heading,LIMIT.heading)}:{},{sections:sections.filter(Boolean).slice(0,LIMIT.sections)});
    const n=notes.filter(x=>x&&words(x[1],LIMIT.text)).slice(0,LIMIT.notes).map(([tone,text])=>({text:words(text,LIMIT.text),tone}));
    const l=links.filter(x=>x&&typeof x[1]==='string'&&x[1].length<=LIMIT.url&&/^https:\/\/[A-Za-z0-9.-]+(\/[\x21-\x7e]*)?$/.test(x[1]))
      .slice(0,LIMIT.links).map(([label,url])=>({label:words(label,LIMIT.link),url}));
    if(n.length)r.notes=n;if(l.length)r.links=l;
    return r.sections.length?r:null;
  }
  // A confirm step's review, or none when anything about it fails: the summary still says it all.
  const reviewed=(s,make)=>{try{const r=make(s);return r?{review:r}:{};}catch(_){return {};}};
  const profileName=s=>'VPN '+s.name; // The VPN profile vpn.import saves on the phone.
  // A number held to its unit, so a narrow dialog never breaks "4 GB" or "3.80 EUR/mo" across lines; the list's own words otherwise.
  const glue=t=>t.replace(/\b(\d+(?:\.\d+)?) (?=[A-Za-z])/g,'$1\u00a0').replace(/\bGB RAM\b/g,'GB\u00a0RAM');
  const sentence=parts=>parts.length<2?parts.join(''):parts.slice(0,-1).join(', ')+' and '+parts[parts.length-1];
  // The name a create request gives its resource, as sent; '' when it sends none (a DigitalOcean reserved IP, a Scaleway rule).
  // Azure names each resource by its URL.
  function sentName(s,op) {
    const c=op&&op.create||{},b=c.body&&typeof c.body==='object'?c.body:{};
    const v=[b.name,b.label,b.displayName,b.keyPairName,get(b,'targetSpec.name'),Array.isArray(b.instanceNames)?b.instanceNames[0]:undefined,
      op.key==='address'?b.staticIpName:undefined,op.key==='firewall'?b.description:undefined].find(x=>typeof x==='string'&&x);
    if(v)return v;
    return s.provider==='azure'&&c.method==='PUT'&&typeof c.url==='string'?decodeURIComponent(c.url.split('?')[0].split('/').pop()):'';
  }
  // A setting's label: its field's, without a trailing ID kind ("Flavor ID": Flavor); images and accounts by what they are.
  const REVIEW_LABEL={projectId:'Project',subscriptionId:'Subscription',compartmentId:'Compartment',imageId:'Image'};
  // A place the worker itself knows for a value no list described (typed): Google Cloud's and Oracle Cloud's regions, Scaleway's zones.
  function knownPlace(s,key,v) {
    const at=table=>(table.find(x=>x[0]===v)||[])[1]||'';
    return key==='region'&&s.provider==='gcp'?own(GCP_PLACES,v)||'':key==='region'&&s.provider==='oci'?at(OCI_REGIONS):key==='zone'&&s.provider==='scaleway'?at(SCW_ZONES):'';
  }
  // A setting's rows: its value, or its name where it is an ID (the ID then in the note, or a row of its own when too long), and
  // what the list said of it (labels); a fixed list's own label (OVHcloud's API sites); an Oracle Cloud shape with the size the
  // create asks for (shapeConfig) and the price its list gives that size.
  function settingRows(s,f) {
    const v=s.inputs[f.key],l=get(s,'labels.'+f.key),said=Array.isArray(l)&&l[0]===v?l:[v,'','',''],label=REVIEW_LABEL[f.key]||f.label.replace(/ (ID|UUID|OCID)$/,'');
    if(typeof v!=='string'||!v)return [];
    const fixed=Array.isArray(f.options)&&(f.options.find(o=>o.value===v)||{}).label;
    if(fixed)return [row(label,fixed)];
    const name=words(said[1],LIMIT.label),parts=[name||v,glue(words(said[2],LIMIT.value)||knownPlace(s,f.key,v))];
    if(s.provider==='oci'&&f.key==='size')parts.push(said[2]||!own(OCI_PRICES,v)?'':glue('~'+money(own(OCI_PRICES,v),'USD')+'/mo'),glue('1 OCPU, 2 GB RAM'));
    const value=parts.filter(Boolean).join(' · '),about=glue(words(said[3],LIMIT.note)),note=[about,name?'ID '+v:''].filter(Boolean).join(' · ');
    return note.length>LIMIT.note?[row(label,value,about),row(label+' ID',v)]:[row(label,value,note)];
  }
  const IMAGE_NAMED=['digitalocean','hetzner','gcp','aws','azure','linode']; // Their create names Ubuntu 24.04 itself.
  // A new VPN (confirm): where, on what and at what price, as the lists showed it; access; the checks passed; billing.
  function createReview(s) {
    const [cloud,pricing]=PROVIDERS[s.provider],existing=s.provider==='existing',link=[[cloud+' prices',pricing]];
    const vpn=[row('VPN software','WireGuard (wg-easy '+RELEASE+')'),row('Profile on this phone',profileName(s))];
    if(s.mode!=='automatic')return review(existing?'Install the VPN on your server':'Install the VPN on your '+cloud+' server',
      [section('Server',[row('Address',s.host),row('SSH user',s.user),existing?null:row('Created in',cloud+' console')]),
        section('VPN',[row('VPN port','UDP 51820','The server\'s firewall must allow it.')].concat(vpn))],
      [existing?['info','Nothing is created in a cloud account: the VPN is installed on this server over SSH.']:
        ['warning','The server you created in the '+cloud+' console bills until you delete it there. Deleting this VPN removes only the VPN.']],existing?[]:link);
    const server=section('Server',[row('Cloud',cloud)].concat(...OPTIONS[s.provider].map(f=>settingRows(s,f)),
      IMAGE_NAMED.includes(s.provider)?row('System','Ubuntu 24.04 LTS'):null,row('Server name',s.name,'The resources made with it get this name too.')));
    const ssh=typeof s.inputs.sshCidr==='string'?s.inputs.sshCidr:'',prices=(LOOKUPS[s.provider]||{}).prices;
    return review('New VPN server on '+cloud,[server,
      section('Access',[row('SSH access',ssh==='0.0.0.0/0'?'Any address (0.0.0.0/0)':ssh&&'Only from '+ssh,'Logins need this setup\'s SSH key.'),
        row('VPN port','UDP 51820, open to any address')].concat(vpn)),
      section('Checked with '+cloud,list(s,'verified').filter(c=>typeof c==='string').map(c=>row(c,'Confirmed')))],
      [['warning',cloud+' bills for the server and what is made for it until they are deleted. Public IPv4 and bandwidth may be charged separately.'],
        prices&&server.rows.some(r=>/\/mo\b/.test(r.value))?['info',prices.trim()]:['gcp','azure'].includes(s.provider)?['info',cloud+'\'s API gives no prices: its pricing page has them.']:null],link);
  }
  // What each receipt is, as its provider calls it; others by their key.
  const KIND={key:'SSH key',server:'Server',address:'Public IPv4 address',firewall:'Firewall',sshRule:'Firewall rule for SSH',vpnRule:'Firewall rule for WireGuard',
    sshFirewall:'Firewall rule for SSH',vpnFirewall:'Firewall rule for WireGuard',network:'Network',group:'Resource group',nic:'Network interface',gateway:'Internet gateway',
    route:'Route table',subnet:'Subnet',vnic:'Network attachment',privateIp:'Private IP address',volume:'Disk'};
  const KINDS={hetzner:{address:'Primary IPv4 address'},digitalocean:{address:'Reserved IP address',firewall:'Cloud firewall'},
    aws:{key:'Key pair',address:'Static IP address',firewall:'Open ports'},azure:{firewall:'Network security group',network:'Virtual network'},
    gcp:{network:'VPC network',address:'Static IP address'},linode:{firewall:'Cloud Firewall'},vultr:{firewall:'Firewall group'},
    oci:{network:'Virtual cloud network',firewall:'Security list',address:'Reserved public IP address'},ovh:{firewall:'Security group'},
    scaleway:{firewall:'Security group',address:'Flexible IP address'}};
  const kindOf=(s,type)=>own(own(KINDS,s.provider),type)||own(KIND,type)||words(type,LIMIT.label)||'Resource';
  // A receipt by its name and address, else its id (an Azure or Google Cloud path by its last part).
  const which=x=>[...new Set([x.name,x.host].map(v=>words(v,120)).filter(Boolean))].join(' · ')||
    words(typeof x.id==='string'?x.id.split('/').filter(Boolean).pop():x.id,120)||'Unnamed';
  // A delete: each owned receipt by kind, the server's own VPN for a console setup, what this phone removes; what stays.
  // A Scaleway power-on and a Lightsail attachment are steps, not resources: they go with their server.
  function deleteReview(s) {
    const cloud=(own(PROVIDERS,s.provider)||[''])[0],existing=s.provider==='existing',manual=s.mode==='manual'&&!!s.host,host=s.host;
    const rank=x=>{const at=['server','address','firewall','key'].indexOf(x.type);return at<0?9:at;};
    const all=Object.entries(s.resources&&typeof s.resources==='object'?s.resources:{}).filter(([,x])=>x&&typeof x==='object'&&!['power','attachment'].includes(x.type))
      .sort((a,b)=>rank(a[1])-rank(b[1]));
    const rows=(note,tone)=>([key,x])=>row(kindOf(s,typeof x.type==='string'?x.type:key),which(x),key.includes('~')?'Another copy, found by a lookup':note,tone);
    const live=all.filter(([,x])=>x.owned===true&&x.status!=='deleted');let pending=false;try{pending=unsettled(s).length>0;}catch(_){}
    const cloudy=!manual&&!!cloud&&!existing&&(live.length>0||pending);
    // The VPN itself is said to go only while its server does (or a host with no server receipt): one already deleted took it.
    const vpn=live.some(([,x])=>x.type==='server')||!!host&&!all.some(([,x])=>x.type==='server');
    const goes=sentence([vpn?'the VPN, its clients':'',live.length?'the '+cloud+' resources listed':'',
      pending?(live.length?'any more the lookup finds':'what the lookup finds in '+cloud):''].filter(Boolean));
    return review(manual?'Remove the VPN from your '+(existing?'server':cloud+' server'):cloudy?(vpn?'Delete the VPN on ':'Delete this VPN setup on ')+cloud:'Delete this VPN setup',[
      section('Will be deleted',[manual?row('VPN on the server','WireGuard and its data on '+words(host,120)):null].concat(live.map(rows(''))),
        [row('On this phone',host?'Its VPN profiles and saved server':'Its saved setup')]),
      section('Kept',[manual?row('Server',host,existing?'Only the VPN is removed from it.':'Delete the VM, disks and public IP in the '+cloud+' console to stop their charges.',existing?'':'warning'):null]
        .concat(all.filter(([,x])=>x.owned!==true).map(rows('It was in the account before; it stays.')))),
      section('Already deleted',all.filter(([,x])=>x.owned===true&&x.status==='deleted').map(rows('','muted')))],
      [cloudy||manual?['danger',manual?'The VPN and its clients will be removed from the server. This cannot be undone.':
        goes.charAt(0).toUpperCase()+goes.slice(1)+' will be deleted. This cannot be undone.']:null,
        (s.mode==='automatic'||!cloud)&&!cloudy?['info','Nothing is left to delete in the cloud.']:null,
        pending?['info','A request of this VPN got no answer: the cloud is checked first for what it may have made, which is deleted too.']:null,
        host?['info','If this phone is connected through this VPN, it is disconnected first.']:null],[]);
  }
  // A create sent again after its lookup found nothing.
  function recreateReview(s) {
    const [cloud,pricing]=PROVIDERS[s.provider],op=graph(s)[s.index],key=op.key;
    return review('New creation attempt on '+cloud,[section('Will be created',[row('Resource',kindOf(s,key)),row('Cloud',cloud),
      row('Name in the cloud',sentName(s,op))].concat(...(key==='server'?OPTIONS[s.provider].map(f=>settingRows(s,f)):[])))],
      [['warning','Nothing matching was found. Check the '+cloud+' console for a resource created late before approving: a new one can add charges.']],[[cloud+' prices',pricing]]);
  }
  function clientReview(s) {
    if(s.operation==='createClient')return review('Add a VPN client',[section('New client',[row('Server',s.host),row('Profile on this phone',profileName(s))])],
      [['info','The server registers a new WireGuard client, and its profile is added to this phone. Existing clients keep working.']],[]);
    const id=s.targetClientId,client=(Array.isArray(s.clients)?s.clients:[]).find(x=>x&&x.clientId===id);
    return review(words(id,20)?'Revoke VPN client '+words(id,20):'Revoke a VPN client',[section('Will be revoked',[row('Client',id),row('Server',s.host),
      client?row('Its profile on this phone','Removed with it'):null])],
      [['danger','Devices using this client can no longer connect through this VPN. This cannot be undone; a new client can be added later.'],
        client&&client.profileId===s.profileId?['warning','This phone\'s VPN uses this client\'s profile, which is removed.']:null],[]);
  }
  function updateReview(s) {
    const v=get(s,'health.version'),was=typeof v==='string'&&/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(v)?'wg-easy '+v:'';
    return review('Update WireGuard to '+RELEASE,[section('Update',[row('Server',s.host),row('New version','wg-easy '+RELEASE),row('Version at the last check',was)])],
      // The app's own text above it says the restart, the disconnect and the reconnect (label_workflow_update_review).
      [['info','Existing clients keep working. If the new version does not start, the previous one is restored.']],[]);
  }

  function output(s, step) { s.pending = step ? step.id : null; return {state:s,step:step || {kind:'complete',id:s.deploymentId+'-done',result:{deploymentId:s.deploymentId,status:s.phase}}}; }
  function input(s, form, title, fields, more, readable) {
    return output(s,Object.assign({kind:'input',id:s.deploymentId+'-'+s.phase,form,title,fields:fields||[]},more||{},readable||{}));
  }
  function http(s, req, stage) {
    s.httpStage=stage;
    // The page reads creationSent: a stopped setup may hold what this created. cloudRef: the account it went to.
    if(stage==='create'){s.creationSent=true;s.cloudRef=s.cloudRef||s.credentialRef;}
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
      const envelope=typeof op.envelope==='string'?op.envelope:{droplets:'droplet',ssh_keys:'ssh_key',firewalls:'firewall',servers:'server',reserved_ips:'reserved_ip',
        firewall_groups:'firewall_group',instances:'instance',security_groups:'security_group',ips:'ip',primary_ips:'primary_ip',rules:'rule',firewall_rules:'firewall_rule'}[m.path];
      return envelope?{[envelope]:found[0]}:found[0];
    }
    return get(values,m.field)===m.value?b:null;
  }
  // DigitalOcean names no reserved IP: one an interrupted request made is assigned to the Droplet that request named, unless
  // that Droplet is gone (deleted in the console, or by an older delete), which leaves it unassigned like any other. Such an
  // unassigned one in its region counts against absence unless that Droplet was just read (seen: its id). One still locked
  // counts even then: DigitalOcean assigns a new IP in the background, and it lists unassigned and locked until it is done.
  const strayIp=(s,op,values,locked)=>s.provider==='digitalocean'&&op.key==='address'&&
    values.some(x=>!get(x,'droplet.id')&&[undefined,s.inputs.region].includes(get(x,'region.slug'))&&(!locked||x.locked===true));
  function confirmedAbsent(s,op,b,seen) {
    const m=get(op,'create.reconcile.match');
    if(!m)return false;
    const values=get(b,m.path);
    if(!Array.isArray(values)||values.some(x=>get(x,m.field)===m.value))return false;
    return !strayIp(s,op,values)||(seen!==undefined&&seen===String(get(s.resources,'server.id'))&&!strayIp(s,op,values,true));
  }
  // Whether that Droplet is read first, before an unassigned reserved IP stops the lookup: it is held, not known deleted. Not for
  // the read the phone sends in place of a create's lost answer, maybe while DigitalOcean still assigns what it made: that one
  // pauses, and the user's later check reads the Droplet.
  function checkDroplet(s,op,b,seen) {
    const m=get(op,'create.reconcile.match'),server=s.resources.server;
    if(seen!==undefined||!m||!server||server.owned!==true||server.id===undefined||server.status==='deleted')return false;
    const values=get(b,m.path);
    return Array.isArray(values)&&!values.some(x=>get(x,m.field)===m.value)&&strayIp(s,op,values);
  }
  // Where a create went, as a pause names it: host and path, with no query.
  const shownUrl=u=>String(u||'').replace(/^https:\/\//,'').replace(/[?#].*$/,'').replace(/\/+$/,'');
  // Why a lookup's answer settles nothing yet: nothing it lists is certainly this VPN's, nor certainly not.
  function unmatched(s,op) {
    return s.provider==='digitalocean'&&op.key==='address'
      ?'DigitalOcean names no reserved IP, and one in '+s.inputs.region+' is unassigned: an interrupted request of this VPN may have made it. Check Networking > Reserved IPs in the DigitalOcean console and delete it there if it is this VPN\'s, then check again.'
      :'Interrupted creation could not be matched uniquely. Review cloud resources before retrying.';
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
  // 'provider': Hetzner's own code says so (bridge 1.5.0 passes it). 'opaque': an older
  // host passed only {code:'CLOUD_HTTP_ERROR'}, as it does for refusals that never clear
  // (delete protection, a firewall applied elsewhere), so those get a short wait only.
  const OPAQUE_RETRIES=8; // About 3 minutes of waits; the provider's own code gets the full polling limit.
  function busyDelete(s,op,status,b) {
    if(s.provider!=='hetzner'||s.httpStage!=='delete'||op.key==='address')return '';
    const own=get(b,'error.code'),code=typeof own==='string'?own:get(b,'code');
    if((status===422&&code==='resource_in_use')||((status===409||status===423)&&['locked','conflict'].includes(code)))return 'provider';
    return [409,422,423].includes(status)&&code==='CLOUD_HTTP_ERROR'?'opaque':'';
  }
  // A resource its provider is removing already: its deletion is not sent again while it goes.
  const leaving=b=>[get(b,'lifecycleState'),get(b,'status'),get(b,'resourceStatus'),get(b,'properties.provisioningState'),get(b,'server.status'),
    get(b,'server.state'),get(b,'droplet.status'),get(b,'instance.status'),get(b,'instance.state.name')]
    .some(value=>typeof value==='string'&&/^(deleting|terminating|shutting-down|stopping|deprovisioning)$/i.test(value));
  // A create sent with no 2xx answer may have made something no receipt shows. unanswered maps its step id to its resource
  // until a read of the cloud settles it: what it found gets a receipt, or nothing matched. reconciled then maps the create's
  // step id to that read's, which the phone's host (bridge 1.5.0) checks before it removes the deployment from its list.
  const mutates=req=>!!req&&!['GET','HEAD'].includes(req.method)&&!req.readOnly;
  function sent(s,id,key){(s.unanswered=s.unanswered||{})[id]=key;if(s.reconciled)delete s.reconciled[id];}
  // Creates sent where this graph's URLs no longer point (moved) are settled one by one, by a lookup sent there.
  function settled(s,key){
    for(const [id,at] of Object.entries(s.unanswered||{}))if(at===key&&!(s.moved||{})[id]){(s.reconciled=s.reconciled||{})[id]=s.pending;delete s.unanswered[id];}
  }
  // Graph positions of the resources creates nothing settled may have made.
  function unsettled(s){
    if(!Object.keys(s.unanswered||{}).length)return [];
    const ops=graph(s);return Object.values(s.unanswered).map(key=>ops.findIndex(op=>op.key===key)).filter(at=>at>=0);
  }
  // The host's list of the deployment's creates nothing settled, older VPN Setup versions' included: each is matched to the
  // resource whose create request it repeats, to be looked up with the others before a delete removes anything. This version's
  // own notes already name theirs. Resources made by the same request (two firewall rules, say) are told apart by the graph
  // position in the create's step id, which every version has written the same way.
  function adopt(s,unresolved){
    if(!unresolved.length||s.mode!=='automatic')return;
    let ops;try{ops=graph(s);}catch(_){return;}
    for(const item of unresolved){
      if(typeof item.id!=='string'||Object.prototype.hasOwnProperty.call(s.unanswered||{},item.id))continue;
      const request=ops.filter(x=>mutates(x.create)&&x.create.method===get(item,'method')&&get(x.create,'headers.X-Amz-Target','')===get(item,'target',''));
      const same=request.filter(x=>x.create.url===get(item,'url'));
      const at=Number((/-provision-(\d+)-create-/.exec(item.id)||[])[1]);let op=same.find(x=>ops.indexOf(x)===at)||same[0];
      // Sent by VPN Setup 1.0.0-1.0.3 before Change server settings changed a setting its URL holds (an AWS or Oracle Cloud
      // region, a Google Cloud project or zone, an Azure subscription, a Scaleway zone, an OVHcloud project or endpoint): the
      // resource at its graph position is looked up where that create went.
      if(!op&&typeof item.url==='string'){op=request.find(x=>ops.indexOf(x)===at);if(op&&lookupAt(op,item.url))(s.moved=s.moved||{})[item.id]=item.url;else op=null;}
      if(op)(s.unanswered=s.unanswered||{})[item.id]=op.key;
    }
  }
  // op's lookup (its create's reconciliation read, else its read) as for a create sent to url in place of op's own URL: the
  // part of op's URL that differs from url is replaced likewise in the lookup's, with a Lightsail region signed for there too.
  // null when the lookup's URL does not hold that part.
  function lookupAt(op,url) {
    const a=op.create.url,b=String(url),read=op.create.reconcile||op.read;
    if(!read||!/^https:\/\/[^/?#]+/.test(b))return null;
    let p=0;while(p<a.length&&p<b.length&&a[p]===b[p])p++;
    let q=0;while(q<a.length-p&&q<b.length-p&&a[a.length-1-q]===b[b.length-1-q])q++;
    const from=a.slice(0,a.length-q),to=b.slice(0,b.length-q);
    if(!read.url.startsWith(from))return null;
    const there=Object.assign(clone(read),{url:to+read.url.slice(from.length)});
    if(get(there,'auth.scheme')==='aws'){
      const region=/^https:\/\/lightsail\.([a-z0-9-]+)\.amazonaws\.com\//.exec(there.url);
      if(!region)return null;there.auth.region=region[1];
    }
    return there;
  }
  // Changes a lookup finds as made only once they took effect, not merely their resource existing. A power-on took effect
  // once its server is anything but stopped: one still starting is powered off before its deletion, as a running one is.
  const APPLIED={aws:['attachment','firewall'],scaleway:['power']};
  const applied=(s,op,b)=>s.provider==='scaleway'&&op.key==='power'?!['stopped',undefined].includes(get(b,'server.state')):op.ready(b);
  // Other cloud credentials, chosen in a recovery, may reach another account than the one this VPN's resources went to
  // (cloudRef), where finding nothing proves nothing. Until a request with them finds one of its resources, an answer that
  // something is not there is checked first by reading another resource this VPN holds; with none, or none found, it pauses.
  // There the user may say they are for the same account (a new or renewed token, say), which they then count as.
  const elsewhere=s=>!!s.cloudRef&&s.credentialRef!==s.cloudRef;
  function reached(s){if(elsewhere(s))s.cloudRef=s.credentialRef;}
  const SAME_ACCOUNT='These credentials are for the same account';
  const OTHER_ACCOUNT='These cloud credentials are not the ones this VPN\'s resources were created with. If they reach another account, finding nothing there proves nothing, so nothing is counted as gone yet. Choose the original credentials under Update cloud account credentials, or check the cloud console. If they are for the same account (a new or renewed token, say), choose '+SAME_ACCOUNT+'.';
  // A create refused for its credentials (401, 403) made nothing: with nothing else this VPN may hold, nothing ties it to their account yet.
  function refused(s,status) {
    if((status===401||status===403)&&!Object.values(s.resources).some(x=>x&&x.owned&&x.status!=='deleted')&&
      Object.keys(s.unanswered||{}).every(id=>id===s.pending))delete s.cloudRef;
  }
  // stage: what to send again once a held resource was read with them; after: the graph position of one that was not found.
  function unproven(s,stage,after) {
    const held=graph(s).findIndex((op,at)=>at>(after===undefined?-1:after)&&at!==s.index&&op.read&&get(s.resources,op.key+'.id')!==undefined&&
      !['deleted',undefined].includes(get(s.resources,op.key+'.status')));
    if(held<0)return pause(s,OTHER_ACCOUNT);
    s.verifyKey=graph(s)[held].key;s.verifyStage=stage;return render(s);
  }
  // A receipt for what op made, from its create's answer or a read that found it.
  // A lookup that finds another one than the receipt held for it (a duplicate deleted in the cloud console, say) leaves that
  // receipt as a spare: the phone's ledger still holds it, so it is deleted after the rest, where a 404 shows it gone. So does
  // the read after a create whose answer gave another id (a Google Cloud Operation naming no targetId, say).
  function record(s,op,value,lookup) {
    const found=op.extract(value),held=s.resources[op.key];
    if((lookup||s.httpStage==='read')&&held&&held.owned===true&&held.status!=='deleted'&&held.id!==undefined&&found.id!==undefined&&String(found.id)!==String(held.id)){
      s.resources[op.key+'~'+String(held.id).replace(/[^A-Za-z0-9_-]/g,'_')]=held;delete s.resources[op.key];
    }
    s.resources[op.key]=Object.assign(s.resources[op.key]||{},{provider:s.provider,type:op.key,owned:true,status:'created'},Object.fromEntries(Object.entries(found).filter(([,v])=>v!==undefined)));
    if(s.provider==='scaleway'&&op.key==='server')for(const volume of Object.values(found.volumes||{}))if(volume.id)s.resources['volume_'+volume.id]={provider:s.provider,type:'volume',id:volume.id,owned:true,status:'created',metadata:{parentId:found.id}};
  }
  // Where a delete starts once every create it may hold is accounted for: the last owned receipt not yet deleted, else local cleanup.
  // With nothing owned, local cleanup at once, unless a create an older version sent elsewhere (moved) is still to be looked up:
  // a server of the user's own, or a setup stopped before it chose a provider, has no cloud graph to go through.
  function removal(s) {
    const ownsCloud=Object.values(s.resources).some(x=>x.owned&&x.status!=='deleted');
    const lookups=Object.keys(s.moved||{}).some(id=>Object.prototype.hasOwnProperty.call(s.unanswered||{},id));
    s.phase=ownsCloud||lookups?'cleanup':'cleanupLocal';s.index=ownsCloud?graph(s).length-1:-1;s.httpStage='delete';s.attempt=0;
    // Disks of a Scaleway server an earlier delete removed are deleted first, as right after their server.
    const disks=s.phase==='cleanup'&&s.provider==='scaleway'&&get(s.resources,'server.status')==='deleted'?
      Object.values(s.resources).filter(x=>x&&x.type==='volume'&&x.owned&&x.status!=='deleted'&&x.id):[];
    if(disks.length){s.extraCleanup=disks.map(x=>({id:x.id,type:'volume',url:'https://api.scaleway.com/instance/v1/zones/'+enc(s.inputs.zone)+'/volumes/'+enc(x.id)}));s.phase='cleanupExtra';}
    return render(s);
  }
  // Spare receipts (record) not yet deleted, each with the DELETE its resource's own receipt would get. Others (a Lightsail
  // action, which names its resource by the deployment's name and so never leaves a spare) count as deleted with the rest.
  function spares(s) {
    const ops=graph(s);
    return Object.entries(s.resources).filter(([key,x])=>x&&x.owned===true&&x.status!=='deleted'&&x.id!==undefined&&key.startsWith(x.type+'~')&&ops.some(op=>op.key===x.type))
      .map(([key,x])=>{const op=graph(Object.assign({},s,{resources:Object.assign({},s.resources,{[x.type]:x})})).find(o=>o.key===x.type);
        return op.remove&&op.remove.method==='DELETE'?{id:x.id,type:x.type,key,url:op.remove.url}:null;}).filter(Boolean);
  }
  // Only a setup creates, and only until it began removing what it made: a delete, or a setup's own cleanup, never sends
  // a create again (its recovery offered new settings, which provisioned a new VPN inside a delete job).
  const REMOVAL=['cleanupFind','cleanup','cleanupWait','cleanupExtra','extraWait','deleteServer','cleanupLocal'];
  const creates=s=>s.operation==='setup'&&!REMOVAL.includes(s.interruptedPhase);
  // A setup stopped by its read-only checks before anything was created.
  function unchecked(s) {
    return s.operation==='setup'&&s.interruptedPhase==='preflight'&&!Object.values(s.resources||{}).some(x=>x&&x.owned&&x.status!=='deleted');
  }
  function absentCreation(s) {
    if(s.allowRecreate){delete s.allowRecreate;delete s.creationAbsent;s.httpStage='create';return render(s);}
    s.creationAbsent=true;
    return pause(s,'No matching cloud resource was found. Review the cloud console before approving a new creation attempt.');
  }
  const ipv4Cidr=value=>{const parts=value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);return !!parts&&!parts.slice(1,5).some(x=>Number(x)>255)&&Number(parts[5])<=32;};
  // Why an answered setting cannot be used, or '': cleanInputs' rules, worded for the person (or voice) answering again.
  function settingProblem(f,value) {
    if(!value)return f.required?'This setting is required.':'';
    if(f.key==='sshCidr')return ipv4Cidr(value)?'':'Enter an IPv4 range in CIDR form, such as 203.0.113.0/24.';
    return /^[a-zA-Z0-9_.:-]{1,256}$/.test(value)?'':'Use only letters, digits, dots, underscores, colons and hyphens, with no spaces.';
  }
  function cleanInputs(provider,value) {
    const result={};
    for(const f of OPTIONS[provider]||[]) { const v=value[f.key]===undefined?f.default:value[f.key]; if(f.required&&!v)throw new Error(f.label+' is required');result[f.key]=String(v||'').trim(); }
    const cidr=String(value.sshCidr||'').trim();
    if(!ipv4Cidr(cidr))throw new Error('SSH source must be an IPv4 CIDR');
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
    // The catalog's reads, one page at a time, each under its own step id (a refresh sends them again under the same ids).
    // A lookup (LOOKUPS), or the wait before its one retry.
    if(s.phase==='catalog'&&LOOKUPS[s.provider]){
      const r=s.catalogRead,l=r&&LOOKUPS[s.provider].lookups.find(x=>x.name===r.name);
      if(!l||!s.catalog||!Number.isSafeInteger(r.page)||r.page<1)return looked(s,null);
      const id=s.deploymentId+'-catalog-'+l.name+'-'+r.page;
      if(Number.isSafeInteger(r.wait)&&r.wait>=0&&r.wait<=10000)return output(s,{kind:'delay',id:id+'-wait',milliseconds:r.wait,delayMs:r.wait});
      const req=l.request?l.request(s,r.token):(url=>url?request(s,'GET',url):null)(l.url(s));
      if(!req)return looked(s,null);
      return output(s,Object.assign({kind:'http',id:id+(r.attempt?'-again':'')},req));
    }
    if(s.phase==='catalog'){
      const r=s.catalogRead,from=CATALOG[s.provider],what=r&&from&&from.reads[r.at];
      if(!from||!r||!Number.isSafeInteger(r.at)||!Number.isSafeInteger(r.page)||!Array.isArray(r.types)||!Array.isArray(r.places))return catalogDone(s,true);
      if(!what)return catalogDone(s);
      return output(s,Object.assign({kind:'http',id:s.deploymentId+'-catalog-'+what+'-'+r.page},request(s,'GET',from.url(what,r.page))));
    }
    if(s.phase==='options'){
      // First what the question waits for: a lookup, or its answer when the list leaves no choice.
      const due=lookupDue(s);
      if(due){s.catalogRead={name:due.name,page:1,attempt:0};s.phase='catalog';return render(s);}
      const auto=automatic(s);
      if(auto!==null){const k=OPTIONS[s.provider][s.optionIndex||0].key;s.inputs[k]=auto;nameOf(s,k,auto);labelOf(s,k,auto);s.optionIndex=(s.optionIndex||0)+1;return render(s);}
      const current=optionField(s),asked=(QUESTIONS[s.provider]||{})[current.key],message=optionMessage(s,current);
      // Asked again after an answer it could not use: why, as the native review's message and the page's problem.
      const refused=s.optionProblem?{message:s.optionProblem,error:{code:'invalid_setting',message:s.optionProblem}}:{};
      return input(s,'instance',asked?fill(s,(s.typing===current.key&&asked[3])||asked[0]):current.label,[current],Object.assign({id:s.deploymentId+'-options-'+(s.optionIndex||0),guide:'guides/'+s.provider+'.md',pricingUrl:PROVIDERS[s.provider][1]},message?{message}:{},refused));
    }
    if(s.phase==='manual')return input(s,'instance','Create Ubuntu 24.04 using the console guide',[
      field('host','Public IPv4 address')],{guide:'guides/'+s.provider+'.md',publicKey:s.publicKey});
    if(s.phase==='manualUser')return input(s,'instance','Which SSH user should connect?',[
      field('user','SSH user',PROVIDERS[s.provider][2])],{guide:'guides/'+s.provider+'.md'});
    if(s.phase==='confirm')return input(s,'confirm','Review VPN setup',[],{summary:Object.assign({provider:PROVIDERS[s.provider][0],name:s.name,
      settings:s.inputs},s.names&&s.mode==='automatic'?{names:s.names}:{},{host:s.host,verified:s.verified||[],pricingUrl:PROVIDERS[s.provider][1],billing:'Cloud billing continues until its resources are deleted. Public IPv4 and bandwidth may be charged separately.'})},
      reviewed(s,createReview));
    if(s.phase==='preflight') {
      const check=preflight(s)[s.preflightIndex||0];
      if(!check){s.phase='confirm';return render(s);}
      return output(s,{kind:'http',id:s.deploymentId+'-preflight-'+(s.preflightIndex||0)+(s.preflightPage>1?'-'+s.preflightPage:''),...check.request});
    }
    // A recovery question carries its reason as message too, which the native review shows in place of the title.
    const reason=Object.assign({error:s.error},get(s,'error.message')?{message:s.error.message}:{});
    // An update job only updates or checks its server: the native host refuses any other step in it.
    if(s.phase==='recovery'&&s.operation==='update')return input(s,'recovery','Update needs attention',[field('action','Next step','health',{type:'select',options:[
      {value:'health',label:'Check server (changes nothing)'},{value:'retry',label:'Retry the update'},{value:'keep',label:'Stop here'}]})],reason);
    // Nothing exists in the cloud yet, so there is nothing to reconcile or clean up: change the settings or check again.
    // A refused token needs new credentials and a busy provider another try; a setting it answered but did not confirm, a change.
    if(s.phase==='recovery'&&unchecked(s))return input(s,'recovery','Check the server settings',[field('action','Next step',
      s.mode==='automatic'&&CREDENTIALS[s.provider]&&[401,403].includes(s.checkStatus)?'account':s.checkStatus===429||s.checkStatus>=500?'retry':'edit',{type:'select',options:[
      {value:'edit',label:'Change server settings'},{value:'retry',label:'Check again'},
      ...(s.mode==='automatic'&&CREDENTIALS[s.provider]?[{value:'account',label:'Update cloud account credentials'}]:[]),
      {value:'keep',label:'Stop setup'}]})],reason);
    // A deletion refused or cut off: the default reads the cloud first and sends again only what is still there, since a
    // removal the provider took may not be sent twice (a Lightsail detach, a Scaleway power-off). Retry sends it at once.
    // Asked again before other credentials count as the VPN's own account (sameAccount).
    if(s.phase==='recovery'&&s.sameAccountAsked)return input(s,'recovery','Count these credentials as this VPN\'s account?',[field('action','Next step','back',{type:'select',options:[
      {value:'back',label:'No, go back'},{value:'sameAccountConfirmed',label:'Yes, they are for the same account'}]})],
      {error:s.error,message:'Only if they are for the same cloud account as this VPN\'s resources. What they do not find then counts as gone: with another account\'s credentials, a delete could finish while its resources there keep running and billing.'});
    const removing=['cleanup','cleanupExtra','cleanupWait','extraWait'].includes(s.interruptedPhase);
    if(s.phase==='recovery')return input(s,'recovery',s.operation==='delete'?'Delete needs attention':'Setup needs attention',[field('action','Next step','reconcile',{type:'select',options:[
      {value:'reconcile',label:removing?'Check the cloud, then delete what remains':'Check current cloud state'},{value:'retry',label:removing?'Retry the deletion':'Retry reconciliation'},
      ...(creates(s)&&s.creationAbsent?[{value:'recreate',label:'Review a new creation attempt'}]:[]),
      ...(creates(s)?[{value:'edit',label:'Change server settings'}]:[]),...(s.mode==='automatic'&&CREDENTIALS[s.provider]?[{value:'account',label:'Update cloud account credentials'}]:[]),
      ...(elsewhere(s)&&get(s,'error.message')===OTHER_ACCOUNT?[{value:'sameAccount',label:SAME_ACCOUNT}]:[]),
      {value:'cleanup',label:'Review removal of created resources'},{value:'keep',label:'Keep resources and stop'}]})],Object.assign(reason,{resources:s.resources}));
    if(s.phase==='recreateConfirm')return input(s,'confirm','Approve a new creation attempt?',[],{summary:{provider:s.provider,name:s.name,
      resource:graph(s)[s.index].key,warning:'No matching resource was found. Check the cloud console for delayed creation before approving; a new resource can add charges.'}},reviewed(s,recreateReview));
    if(s.phase==='deleteConfirm')return input(s,'confirm','Delete this deployment?',[],{destructive:true,summary:{deploymentId:s.deploymentId,
      provider:s.provider,host:s.host,resources:s.resources,warning:s.mode==='manual'
        ?'The VPN container, its data and local client profiles will be removed. Delete the VM, disks and public IP separately in your cloud console to stop their charges.'
        :'The VPN, clients and owned cloud resources will be removed. This cannot be undone.'}},reviewed(s,deleteReview));
    if(s.phase==='clientConfirm')return input(s,'confirm',s.operation==='createClient'?'Register a new VPN client?':'Revoke this VPN client?',[],{
      destructive:s.operation==='revokeClient',summary:{deploymentId:s.deploymentId,host:s.host,clientId:s.targetClientId,operation:s.operation}},reviewed(s,clientReview));
    if(s.phase==='updateConfirm')return input(s,'confirm','Update WireGuard to '+RELEASE+'?',[],{summary:{deploymentId:s.deploymentId,host:s.host,operation:'update',version:RELEASE,
      warning:'Installs wg-easy '+RELEASE+' and restarts WireGuard on the server. Existing clients and VPN profiles stay. If this phone is connected through this server, its VPN is turned off first: reconnect when the update finishes. If the new version does not start, the previous one is restored.'}},reviewed(s,updateReview));
    // A read of another resource this VPN holds, sent only to learn whether the credentials reach its account (unproven).
    const verify=s.verifyKey&&['provision','cleanupFind','cleanup','cleanupExtra'].includes(s.phase)&&graph(s).find(op=>op.key===s.verifyKey);
    if(verify)return http(s,verify.read,'verify');
    if(s.phase==='provision') {
      const op=graph(s)[s.index];
      if(!op){s.host=s.host||get(s.resources,'address.host')||get(s.resources,'server.host');if(!s.host)return pause(s,'Cloud did not return a public IPv4 address');s.phase='bootstrap';return render(s);}
      if(op.key==='key'&&!s.keyChecked&&keyLookup(s))return http(s,request(s,'GET',keyLookup(s)[0]),'keyLookup');
      if(s.httpStage==='reconcile')return http(s,op.create.reconcile||op.read,'reconcile');
      const sending=http(s,s.httpStage==='read'?op.read:op.create,s.httpStage==='read'?'read':'create');
      if(s.httpStage==='create'&&mutates(op.create))sent(s,sending.step.id,op.key);
      return sending;
    }
    if(s.phase==='wait'||s.phase==='cleanupWait'||s.phase==='extraWait')return output(s,{kind:'delay',id:s.deploymentId+'-'+s.phase+'-'+s.index+'-'+s.attempt,milliseconds:Math.min(30000,2000*Math.pow(2,Math.min(4,s.attempt))),delayMs:Math.min(30000,2000*Math.pow(2,Math.min(4,s.attempt)))});
    if(['bootstrap','health','createClient','revokeClient','update'].includes(s.phase))return ssh(s,s.phase);
    if(s.phase==='import')return output(s,{kind:'vpn.import',id:s.deploymentId+'-import-'+s.clientSequence,configRef:s.configRef,name:profileName(s),
      deploymentId:s.deploymentId,clientId:s.lastClientId});
    if(s.phase==='deleteServer')return ssh(s,'delete');
    if(s.phase==='cleanup') {
      const ops=graph(s);while(s.index>=0&&(!ops[s.index].remove||!s.resources[ops[s.index].key]||!s.resources[ops[s.index].key].owned||s.resources[ops[s.index].key].status==='deleted'))s.index--;
      if(s.index<0){
        const spare=spares(s);
        if(spare.length){s.extraCleanup=spare;s.phase='cleanupExtra';s.httpStage='delete';s.attempt=0;return render(s);}
        for(const value of Object.values(s.resources))if(value.owned)value.status='deleted';
        // Creates an older version sent where this VPN's settings no longer point (moved) are looked up last, once the rest is
        // deleted: one that cannot be looked up there (a project these credentials cannot read, say) never keeps it billing.
        if(!s.findMoved&&Object.keys(s.moved||{}).some(id=>Object.prototype.hasOwnProperty.call(s.unanswered||{},id))){s.findMoved=true;s.phase='cleanupFind';return render(s);}
        delete s.findMoved;s.phase='cleanupLocal';return render(s);
      }
      // Its own check reads the assignment first, also after a recovery.
      if(s.provider==='hetzner'&&ops[s.index].key==='address'&&['delete','deleteCheck','deleteRecheck'].includes(s.httpStage))
        return http(s,ops[s.index].read,'deleteCheck');
      const reading=['deleteRead','deleteRecheck'].includes(s.httpStage);
      return http(s,reading?ops[s.index].read:ops[s.index].remove,reading?s.httpStage:'delete');
    }
    // Before a delete removes anything, each create nothing settled is looked up by the deployment's name, as a setup's own
    // reconciliation does: what it made is then deleted with the rest, or it made nothing.
    if(s.phase==='cleanupFind') {
      const ops=graph(s),next=Object.entries(s.unanswered||{}).map(([id,key])=>[id,ops.findIndex(op=>op.key===key)])
        .find(([id,at])=>at>=0&&!!(s.moved||{})[id]===!!s.findMoved);
      if(!next){if(!s.findMoved)return removal(s);s.phase='cleanup';s.index=-1;s.httpStage='delete';return render(s);}
      s.index=next[1];s.finding=next[0];const op=ops[s.index],moved=(s.moved||{})[s.finding];
      const lookup=moved?lookupAt(op,moved):op.create.reconcile||op.read;
      if(!lookup)return pause(s,'An earlier attempt of this VPN sent its '+op.key+' creation to '+shownUrl(moved)+', where it cannot be looked up. Check there in the cloud console.');
      return http(s,lookup,'find');
    }
    if(s.phase==='cleanupLocal')return output(s,{kind:'vpn.cleanup',id:s.deploymentId+'-cleanup-local',deploymentId:s.deploymentId});
    if(s.phase==='cleanupExtra') {
      const item=s.extraCleanup[0];
      if(!item){s.phase='cleanup';s.httpStage='delete';return render(s);}
      const reading=['deleteRead','deleteRecheck'].includes(s.httpStage),req=request(s,reading?'GET':'DELETE',item.url);
      if(req.method==='DELETE')req.reconcile=request(s,'GET',item.url);
      return http(s,req,reading?s.httpStage:'delete');
    }
    return output(s);
  }
  function next(snapshot,event) {
    let s=clone(snapshot||{});event=event||{type:'start'};
    if(!s.phase){
      const prior=get(s,'inputs.deployment');
      const operation=s.operation||'setup';
      if(prior){
        s=Object.assign(clone(prior),{operation,targetClientId:get(snapshot,'inputs.clientId'),pending:null,error:null});
        // The snapshot is the deployment's latest job, which may have stopped part-way, such as a delete stopped after
        // its server went: its receipts carry over, its progress does not (a stale creationAbsent offered recreation).
        for(const key of ['interruptedPhase','suspendedPhase','httpStage','extraCleanup','creationAbsent','creationSent','allowRecreate','checkStatus','optionProblem','accountResumePhase','verifyKey','verifyStage','dropletCheck','dropletSeen','finding','findMoved','sameAccountAsked','catalog','catalogRead','typing','custom','preflightPage','tenancyId','names','labels'])delete s[key];
      }
      s.version=1;s.operation=operation;s.deploymentId=s.deploymentId||get(snapshot,'inputs.deploymentId');
      if(!/^[a-zA-Z0-9_-]{1,64}$/.test(s.deploymentId||''))throw new Error('Native runner must supply a stable deploymentId');
      s.name=s.name||'mssh-'+s.deploymentId.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,20);
      s.resources=s.resources||{};s.inputs=s.inputs||{};s.index=0;s.attempt=0;s.clientSequence=s.clientSequence||0;
      if(operation==='setup')s.phase='provider';
      else if(operation==='delete'){s.phase='deleteConfirm';adopt(s,list(snapshot,'inputs.unresolved'));}
      else if(!s.host||!s.sshCredentialRef)throw new Error('Lifecycle operations require an owned deployment snapshot');
      else if(['health','createClient','revokeClient','update'].includes(operation)){s.phase=operation==='health'?'health':operation==='update'?'updateConfirm':'clientConfirm';if(operation==='createClient')s.clientSequence++;}
      else throw new Error('Unknown workflow operation');
      return render(s);
    }
    if(event.requestId&&event.requestId!==s.pending)throw new Error('Stale workflow response');
    if(event.type==='cancel'){s.suspendedPhase=s.phase;s.phase='cancelled';return output(s);}
    // A catalog read that could not finish leaves the questions typed, as a refused one does.
    // Other credentials entered for it are not: that pause says so at once, and its Update cloud account credentials reads
    // the catalog again with them.
    if(event.type==='error'&&s.phase==='catalog'&&event.code!=='CREDENTIAL_CHANGED')return LOOKUPS[s.provider]?looked(s,null):catalogDone(s,true);
    if(event.type==='error'){
      const failure=s.phase==='update'&&UPDATE_FAILURES[event.code];
      if(event.code==='UPDATE_RESTORE_FAILED'&&failure)delete s.health; // Its version line would describe a VPN that is down.
      // Bridge 1.5.0: credentials entered again for a request whose own were gone were not those, so it was not sent with them.
      if(event.code==='CREDENTIAL_CHANGED')return pause(s,'Other cloud credentials were entered than the ones this step was prepared with, so it was not sent with them. To use them, choose Update cloud account credentials and enter them there. Checking the cloud state asks for the original ones again.');
      return pause(s,failure||'The operation was interrupted. Check current state before retrying.');
    }
    if(event.type==='resume'){if(s.phase==='cancelled'&&s.suspendedPhase)s.phase=s.suspendedPhase;return render(s);}
    try {
      if(event.type==='input') {
        const v=event.value||{};
        if(s.phase==='provider'){if(!PROVIDERS[v.provider])throw new Error('Choose a supported provider');s.provider=v.provider;s.user=PROVIDERS[s.provider][2];s.phase=s.provider==='existing'?'sshKey':'mode';if(s.provider==='existing')s.mode='manual';}
        else if(s.phase==='mode'){s.mode=v.mode==='manual'?'manual':'automatic';s.phase=s.mode==='manual'?'sshKey':'credential';}
        else if(s.phase==='credential'){if(typeof v.credentialRef!=='string')throw new Error('A native credential reference is required');s.credentialRef=v.credentialRef;
          // Oracle Cloud's tenancy OCID is a public credential field the answer carries: its root compartment is offered (1.0.6).
          if(s.provider==='oci'){const t=[v.tenancyId,get(v,'public.tenancyId')].find(x=>typeof x==='string'&&/^ocid1\.tenancy\.oc1\.\.[a-z0-9]{1,100}$/.test(x));if(t)s.tenancyId=t;else delete s.tenancyId;}
s.phase=s.accountResumePhase||(s.sshCredentialRef?'options':'sshKey');if(s.accountResumePhase==='provision')s.httpStage='reconcile';delete s.accountResumePhase;s.optionIndex=0;if(['options','catalog'].includes(s.phase))ask(s);}
        else if(s.phase==='sshKey'){if(typeof v.credentialRef!=='string'||!/^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/.test(v.publicKey||'')||(s.provider==='aws'&&!v.publicKey.startsWith('ssh-rsa ')))throw new Error('Select a valid SSH key (RSA for Lightsail)');s.sshCredentialRef=v.credentialRef;s.publicKey=v.publicKey.split(/\s+/).slice(0,2).join(' ');if(s.mode==='manual')s.phase='manual';else ask(s);}
        else if(s.phase==='options'){
          const f=optionField(s),value=String((v[f.key]===undefined?f.default:v[f.key])||'').trim();
          // Other asks the same setting again, typed: any value the checks then judge, as before the lists.
          if(f.options&&value===OTHER&&s.catalog){s.typing=f.key;delete s.optionProblem;return render(s);}
          // A setting the last answer's cleanInputs would refuse is asked again now: "nbg 1" heard by voice used to
          // stop the setup on "Invalid region", whose recovery asked only the last setting and failed the same way.
          // A listed question takes only what it lists (the native review and the voice offer nothing else).
          const problem=settingProblem(f,value)||(f.options&&!f.options.some(o=>o.value===value)?'Choose one of the listed answers.':'');
          if(problem){s.optionProblem=problem;return render(s);}
          delete s.optionProblem;s.inputs[f.key]=value;nameOf(s,f.key,f.options&&value);labelOf(s,f.key,value);
          // A value typed while the catalog lists (after Other, or other than the default for a location it lists nothing in) is
          // offered again, as entered before, when the settings are asked again; another answer forgets it. Typed with no catalog,
          // or the default left as it was, it is only the earlier answer (an untouched cx23 is no choice to offer back).
          // After Other the question was listed, though nothing was read yet (Oracle Cloud's compartment, a fixed list of zones).
          if(!f.options&&(LOOKUPS[s.provider]?Object.keys(LOOKUPS[s.provider].fields):LISTS).includes(f.key)&&(s.typing===f.key&&!!s.catalog||catalogued(s)&&value!==f.default))
            s.custom=Object.assign(s.custom||{},{[f.key]:value});
          else if(s.custom&&s.custom[f.key]!==value){delete s.custom[f.key];if(!Object.keys(s.custom).length)delete s.custom;}
          delete s.typing;
          if((s.optionIndex||0)+1===OPTIONS[s.provider].length+1){s.inputs=cleanInputs(s.provider,s.inputs);delete s.catalog;delete s.preflightPage;s.preflightIndex=0;s.verified=[];s.phase='preflight';}
          else s.optionIndex=(s.optionIndex||0)+1;
        }
        else if(s.phase==='manual'){if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(v.host||''))throw new Error('Enter public IPv4');s.host=v.host;s.phase='manualUser';}
        else if(s.phase==='manualUser'){if(!/^[a-z_][a-z0-9_-]{0,31}$/.test(v.user||''))throw new Error('Enter an SSH login name');s.user=v.user;s.phase='confirm';}
        else if(s.phase==='confirm'){if(v.confirmed!==true&&v.approved!==true){s.phase='cancelled';return output(s);}delete s.names;delete s.labels;s.phase=s.mode==='manual'?'bootstrap':'provision';s.httpStage='create';}
        else if(s.phase==='deleteConfirm'){
          if(v.confirmed!==true&&v.approved!==true){s.phase='cancelled';return output(s);}
          s.attempt=0;
          if(s.mode==='manual'&&s.host){s.phase='deleteServer';s.index=-1;s.httpStage='delete';}
          else if(unsettled(s).length)s.phase='cleanupFind';
          else return removal(s);
        }
        else if(s.phase==='clientConfirm'){if(v.confirmed!==true&&v.approved!==true){s.phase='cancelled';return output(s);}s.phase=s.operation;}
        else if(s.phase==='updateConfirm'){if(v.confirmed!==true&&v.approved!==true){s.phase='cancelled';return output(s);}s.phase='update';}
        else if(s.phase==='recreateConfirm'){
          if(v.confirmed!==true&&v.approved!==true){s.phase='recovery';return render(s);}
          delete s.labels;s.allowRecreate=true;s.phase='provision';s.httpStage='reconcile';return render(s);
        }
        else if(s.phase==='recovery'){
          delete s.verifyKey;delete s.verifyStage;delete s.dropletCheck;delete s.dropletSeen;
          const asked=s.sameAccountAsked;delete s.sameAccountAsked;
          if(asked&&v.action!=='sameAccountConfirmed')return render(s);
          if(v.action==='keep'){s.phase='cancelled';return output(s);}
          if(s.operation==='update'){s.phase=v.action==='retry'?'update':'health';return render(s);}
          if(unchecked(s)){
            // Change re-asks every setting with its current value filled in; checking again repeats the failed check.
            if(v.action==='edit')ask(s);
            else if(v.action==='retry')s.phase='preflight';
            // Other credentials may reach another account or project: every check runs again with them.
            else if(v.action==='account'&&s.mode==='automatic'&&CREDENTIALS[s.provider]){s.accountResumePhase='preflight';s.preflightIndex=0;delete s.preflightPage;s.verified=[];s.phase='credential';}
            return render(s);
          }
          if(v.action==='cleanup'){s.phase='deleteConfirm';return render(s);}
          if(['recreate','edit'].includes(v.action)&&!creates(s))throw new Error(s.operation==='setup'?'This setup began deleting what it created: finish or stop that, then set up a new VPN':
            'Only a setup creates cloud resources: finish or stop this '+(s.operation==='delete'?'delete':'operation')+', then set up a new VPN');
          if(v.action==='recreate'){if(!s.creationAbsent)throw new Error('Reconcile the missing resource first');s.phase='recreateConfirm';return render(s);}
          if(v.action==='edit'){
            if(Object.values(s.resources).some(x=>x.status!=='deleted'))throw new Error('Clean up created resources before changing their cloud settings');
            // Its create would go out again under the same step id, and nothing would ever look up what the first one made.
            if(unsettled(s).length)throw new Error('Check current cloud state first: a creation that got no answer may have made a resource');
            // New settings: a create found absent is no longer the one to send again. Kept, a recovery from the questions
            // offered it, and it went out with half-changed settings, unchecked and unreviewed (1.0.7 review).
            delete s.creationAbsent;delete s.allowRecreate;
            s.optionIndex=0;s.phase=s.mode==='manual'?'manual':OPTIONS[s.provider]?'options':'provider';if(s.phase==='options')ask(s);return render(s);
          }
          if(v.action==='account'){s.accountResumePhase=s.interruptedPhase||'options';s.phase='credential';return render(s);}
          // The user says these credentials reach the account its resources went to, and confirms it when asked again: what they
          // find then counts, checked as by reconcile. Any other answer to that second question goes back to the first.
          if(v.action==='sameAccount'){if(!elsewhere(s))throw new Error('These are the credentials this VPN\'s resources were created with');s.sameAccountAsked=true;return render(s);}
          if(v.action==='sameAccountConfirmed'){if(!asked||!elsewhere(s))throw new Error('Choose '+SAME_ACCOUNT+' first');s.cloudRef=s.credentialRef;}
          s.phase=s.interruptedPhase||'provision';
          s.httpStage=['cleanup','cleanupExtra','cleanupWait','extraWait'].includes(s.phase)?(v.action==='retry'?'delete':'deleteRecheck'):'reconcile';
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
      if(s.phase==='catalog'&&LOOKUPS[s.provider])return lookupResult(s,event,b,status);
      if(s.phase==='catalog') {
        const r=s.catalogRead,from=CATALOG[s.provider],what=r&&from&&from.reads[r.at],path=what&&from.list(what),values=path?get(b,path):[];
        // A list refused, or not a list, leaves the questions typed. Prices may be missing: the lists then show none.
        if(!what||(path&&(status<200||status>=300||!Array.isArray(values))))return catalogDone(s,true);
        if(status>=200&&status<300&&b&&typeof b==='object')try{from.page(r,what,values,b);}catch(_){return catalogDone(s,true);}
        // Further pages only in order and up to the cap; what the first pages list is enough to choose from.
        const following=path&&from.next(b);
        if(following===r.page+1&&r.page<CATALOG_PAGES)r.page=following;else{r.at++;r.page=1;}
        return render(s);
      }
      if(s.phase==='preflight') {
        const check=preflight(s)[s.preflightIndex||0];
        if(status<200||status>=300){s.checkStatus=status;delete s.preflightPage;return pause(s,check.label+' could not be verified ('+providerError(status,b)+'). Check account permissions, region, plan and Ubuntu 24.04 image.');}
        const problem=check.problem(b&&typeof b==='object'?b:{},event.result);
        if(problem===NEXT_PAGE){s.preflightPage=(s.preflightPage||1)+1;return render(s);}
        delete s.preflightPage;
        if(problem){delete s.checkStatus;return pause(s,problem);}
        s.verified=(s.verified||[]).concat(check.label);s.preflightIndex=(s.preflightIndex||0)+1;return render(s);
      }
      if(s.httpStage==='verify'&&s.verifyKey){
        const stage=s.verifyStage,at=graph(s).findIndex(op=>op.key===s.verifyKey),droplet=s.dropletCheck;
        delete s.verifyKey;delete s.verifyStage;delete s.dropletCheck;s.httpStage=stage;
        // The Droplet an interrupted reserved-IP create named (checkDroplet): there, the IP that request made would be assigned
        // to it, so the lookup is sent again counting unassigned ones as not this VPN's. Gone, or unreadable: one may be.
        if(droplet){
          if(status<200||status>=300||leaving(b))return pause(s,unmatched(s,graph(s).find(op=>op.key==='address')));
          reached(s);s.dropletSeen=String(get(s.resources,'server.id'));s.attempt=0;return render(s);
        }
        if(status<200||status>=300)return unproven(s,stage,at);
        reached(s);s.attempt=0;return render(s);
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
        const recoveryMatch=get(op,'create.reconcile.match'),seen=s.dropletSeen;delete s.dropletSeen;
        if(recovered&&recoveryMatch&&incompleteList(s,b,event.result,get(b,recoveryMatch.path),get(op,'create.reconcile.url'))){
          delete s.creationAbsent;delete s.allowRecreate;
          return pause(s,'Cloud reconciliation returned an incomplete list. Check all pages in the cloud console; another resource cannot be created safely.');
        }
        if(recovered&&notFound(s,status,b)){if(elsewhere(s))return unproven(s,'reconcile');settled(s,op.key);return absentCreation(s);}
        if(status<200||status>=300){
          if((status===404||status===429||status===503)&&s.httpStage==='read'&&s.attempt<60){s.attempt++;s.phase='wait';return render(s);}
          if(s.httpStage==='create'&&!recovered)refused(s,status);
          return pause(s,'Cloud '+op.key+' request failed ('+providerError(status,b)+'). Review credentials, quota, image and region.');
        }
        const value=recovered?recoveryBody(op,b):b;
        if(!value&&confirmedAbsent(s,op,b,seen)){if(elsewhere(s))return unproven(s,'reconcile');settled(s,op.key);return absentCreation(s);}
        if(!value&&recovered&&get(event,'result.recovered')!==true&&checkDroplet(s,op,b,seen)){s.verifyKey='server';s.verifyStage='reconcile';s.dropletCheck=true;return render(s);}
        if(!value)return pause(s,unmatched(s,op));
        delete s.creationAbsent;delete s.allowRecreate;
        if(recovered||s.httpStage==='read')reached(s); // Found by a read: these credentials reach its account.
        record(s,op,value,recovered);
        // A 2xx answer settles its own create; a read that found the resource settles the creates it may have come from.
        if(recovered)settled(s,op.key);else if(s.httpStage==='create'&&s.unanswered)delete s.unanswered[s.pending];
        if(s.httpStage==='create'&&!recovered){s.httpStage='read';s.attempt=0;return render(s);}
        if(!op.ready(value)){if(s.attempt++>=60)return pause(s,'Cloud resource did not become ready within the polling limit');s.phase='wait';return render(s);}
        s.index++;s.httpStage='create';s.attempt=0;return render(s);
      }
      if(s.phase==='cleanupFind') {
        const op=graph(s)[s.index],m=get(op,'create.reconcile.match'),seen=s.dropletSeen,id=s.finding,moved=id&&(s.moved||{})[id];delete s.dropletSeen;
        const yet=s.findMoved?' The rest of this VPN is deleted.':' Nothing was deleted yet.';
        if(notFound(s,status,b)){if(elsewhere(s))return unproven(s,'find');}
        else {
          if(status<200||status>=300)return pause(s,'Could not check whether an interrupted '+op.key+' creation made one ('+providerError(status,b)+').'+yet);
          if(m&&incompleteList(s,b,event.result,get(b,m.path),get(op,'create.reconcile.url')))
            return pause(s,'Cloud reconciliation returned an incomplete list. Check all pages in the cloud console;'+yet.replace(/^ ./,c=>c.toLowerCase()));
          const value=m?recoveryBody(op,b):(APPLIED[s.provider]||[]).includes(op.key)&&!applied(s,op,b)?null:b;
          if(value||!m)reached(s);
          // Made where this VPN's settings no longer point: its deletion here would go to the wrong place.
          if(value&&moved)return pause(s,'An earlier attempt of this VPN made its '+op.key+' at '+shownUrl(moved)+', which its settings no longer use, so it is not deleted here. Delete it there in the cloud console, then check again.'+yet);
          if(value)record(s,op,value,true);
          else if(m&&!confirmedAbsent(s,op,b,seen)){
            if(checkDroplet(s,op,b,seen)){s.verifyKey='server';s.verifyStage='find';s.dropletCheck=true;return render(s);}
            return pause(s,unmatched(s,op));
          }
          else if(m&&elsewhere(s))return unproven(s,'find');
        }
        if(moved){(s.reconciled=s.reconciled||{})[id]=s.pending;delete s.unanswered[id];delete s.moved[id];}
        else settled(s,op.key);
        delete s.finding;s.attempt=0;return render(s);
      }
      if(s.phase==='cleanup') {
        const op=graph(s)[s.index],busy=busyDelete(s,op,status,b);
        if(busy){
          if(s.attempt++>=(busy==='provider'?60:OPAQUE_RETRIES))return pause(s,busy==='provider'
            ?'Cloud '+op.key+' stayed in use past the polling limit ('+providerError(status,b)+'). Remaining resources are retained for retry.'
            :'Hetzner Cloud kept refusing to delete the '+op.key+' ('+providerError(status,b)+'). It may still be attached to something else, or have delete protection on: check it in the Hetzner Cloud Console, then retry. Remaining resources are retained for retry.');
          s.httpStage='deleteRetry';s.phase='cleanupWait';return render(s);
        }
        if((status<200||status>=300)&&!notFound(s,status,b))return pause(s,'Cloud '+op.key+' deletion failed ('+providerError(status,b)+').'+
          (get(b,'error.code')==='protected'?' Its delete protection is on: turn it off in the cloud console, then retry.':'')+' Remaining resources are retained for retry.');
        if(status>=200&&status<300)reached(s);else if(elsewhere(s))return unproven(s,s.httpStage); // Not there, under other credentials.
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
        if(!gone){
          // Read first after a recovery: still there and not on its way out, so its deletion is sent again.
          if(s.httpStage==='deleteRecheck'){if(!leaving(b)){s.httpStage='delete';s.attempt=0;return render(s);}s.httpStage='deleteRead';}
          if(s.attempt++>=60)return pause(s,'Cloud deletion did not finish within the polling limit');s.phase='cleanupWait';return render(s);
        }
        s.resources[op.key].status='deleted';
        // Later receipts with no deletion of their own went with it: firewall rules, a server's ports or network interface,
        // an Azure group's resources. Left as they were, a delete stopped later would count them as remaining.
        const ops=graph(s);for(let at=s.index+1;at<ops.length;at++)if(!ops[at].remove&&get(s.resources,ops[at].key+'.owned')===true)s.resources[ops[at].key].status='deleted';
        s.index--;s.attempt=0;s.httpStage='delete';
        if(op.key==='server'&&s.provider==='scaleway') {
          s.extraCleanup=Object.values(s.resources.server.volumes||{}).filter(v=>v.id).map(v=>({id:v.id,type:'volume',url:'https://api.scaleway.com/instance/v1/zones/'+enc(s.inputs.zone)+'/volumes/'+enc(v.id)}));
          s.phase='cleanupExtra';
        }
        return render(s);
      }
      if(s.phase==='cleanupExtra') {
        if((status<200||status>=300)&&status!==404)return pause(s,'Additional cloud resource deletion failed ('+providerError(status,b)+'); its receipt is retained.');
        if(status===404&&elsewhere(s))return unproven(s,s.httpStage);
        if(status===404){const removed=s.extraCleanup.shift(),key=removed.key||'volume_'+removed.id;if(s.resources[key])s.resources[key].status='deleted';s.httpStage='delete';s.attempt=0;return render(s);}
        reached(s);
        if(s.httpStage==='deleteRecheck'){s.httpStage='delete';s.attempt=0;return render(s);} // Still there after a recovery: deleted again.
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
    } catch(error) {return pause(s,error.message);} // A refused recovery answer keeps the phase it is recovering.
  }
  root.MobileSSHWorkflow={next,providers:PROVIDERS,graph,credentialFields:CREDENTIALS,optionFields:OPTIONS,image:IMAGE,release:RELEASE};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.MobileSSHWorkflow;
})(typeof globalThis!=='undefined'?globalThis:this);
