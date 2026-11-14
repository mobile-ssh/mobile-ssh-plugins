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
  function names(values) {
    const all=[...new Set(values.map(safe).filter(Boolean))];
    return all.slice(0,8).join(', ')+(all.length>8?' and '+(all.length-8)+' more':'');
  }
  const items=v=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'):[];
  function preflight(s) {
    const p=s.inputs,req=(url)=>request(s,'GET',url), checks=[];
    const size=shown(p.size),region=shown(p.region),zone=shown(p.zone);
    // problem(body, response) is '' once the setting is verified, otherwise one short self-contained reason.
    const check=(label,request,problem)=>checks.push({label,request,problem:problem||(()=>'')});
    if(s.provider==='gcp') {
      const b='https://compute.googleapis.com/compute/v1/projects/'+enc(p.projectId);
      check('Machine type',req(b+'/zones/'+enc(p.zone)+'/machineTypes/'+enc(p.size)),b=>b.name===p.size?'':'Google Cloud did not confirm machine type '+size+' in zone '+zone+'.');
      check('Ubuntu image',req('https://compute.googleapis.com/compute/v1/projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64'),
        b=>b.status==='READY'?'':'Google Cloud\'s Ubuntu 24.04 image is not ready'+(safe(b.status)?' (status '+safe(b.status)+')':'')+'.');
    } else if(s.provider==='aws') {
      const aws=(action,body)=>request(s,'POST','https://lightsail.'+p.region+'.amazonaws.com/',body,{readOnly:true,
        headers:{'Content-Type':'application/x-amz-json-1.1','X-Amz-Target':'Lightsail_20161128.'+action},
        auth:{scheme:'aws',credentialRef:s.credentialRef,service:'lightsail',region:p.region}});
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
        return sizes.some(x=>x.name===p.size)?'':sizes.length?'VM size '+size+' isn\'t offered in '+region+'.':'Azure listed no VM sizes in '+region+'. Check the region name.';
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
        return regions.includes(p.region)?'':'Vultr plan '+size+' isn\'t offered in '+region+'.'+(names(regions)?' Regions with it: '+names(regions)+'.':'');
      });
    } else if(s.provider==='oci') {
      check('Ubuntu image',req('https://iaas.'+p.region+'.oraclecloud.com/20160918/images/'+enc(p.imageId)),
        b=>/ubuntu/i.test(b.operatingSystem||'')&&/24\.04/.test(b.operatingSystemVersion||'')?'':'The selected Oracle Cloud image is not Ubuntu 24.04.');
      check('Instance shape',req('https://iaas.'+p.region+'.oraclecloud.com/20160918/shapes?compartmentId='+enc(p.compartmentId)+'&availabilityDomain='+enc(p.zone)+'&imageId='+enc(p.imageId)),b=>{
        const shapes=items(b).map(x=>x.shape);
        return shapes.includes(p.size)?'':'Shape '+size+' isn\'t offered with this image in availability domain '+zone+'.'+(names(shapes)?' Shapes there: '+names(shapes)+'.':'');
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
      check('Instance type',req(b+'/products/servers'),x=>{
        const servers=get(x,'servers',{});
        return typeof servers==='object'&&Object.prototype.hasOwnProperty.call(servers,p.size)&&servers[p.size]?'':'Scaleway has no instance type '+size+' in '+zone+'.';
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
    ovh:[field('projectId','Public Cloud project ID'),field('endpoint','API account region','eu',{type:'select',options:['eu','ca','us'].map(value=>({value,label:value.toUpperCase()}))}),field('region','Cloud region','GRA11'),field('size','Flavor ID'),field('imageId','Ubuntu 24.04 image ID')],
    scaleway:[field('projectId','Project UUID'),field('zone','Zone','fr-par-1'),field('size','Commercial type','DEV1-S'),field('imageId','Ubuntu 24.04 image UUID')]
  };

  function output(s, step) { s.pending = step ? step.id : null; return {state:s,step:step || {kind:'complete',id:s.deploymentId+'-done',result:{deploymentId:s.deploymentId,status:s.phase}}}; }
  function input(s, form, title, fields, more) {
    return output(s,Object.assign({kind:'input',id:s.deploymentId+'-'+s.phase,form,title,fields:fields||[]},more||{}));
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
    if(s.phase==='options'){
      const fields=[...OPTIONS[s.provider],field('sshCidr','Allow SSH from IPv4 CIDR','0.0.0.0/0')],current=fields[s.optionIndex||0];
      // Asked again after an answer it could not use: why, as the native review's message and the page's problem.
      const refused=s.optionProblem?{message:s.optionProblem,error:{code:'invalid_setting',message:s.optionProblem}}:{};
      return input(s,'instance',current.label,[Object.assign({},current,s.inputs[current.key]?{default:s.inputs[current.key]}:{})],Object.assign({id:s.deploymentId+'-options-'+(s.optionIndex||0),guide:'guides/'+s.provider+'.md',pricingUrl:PROVIDERS[s.provider][1]},refused));
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
      resource:graph(s)[s.index].key,warning:'No matching resource was found. Check the cloud console for delayed creation before approving; a new resource can add charges.'}});
    if(s.phase==='deleteConfirm')return input(s,'confirm','Delete this deployment?',[],{destructive:true,summary:{deploymentId:s.deploymentId,
      provider:s.provider,host:s.host,resources:s.resources,warning:s.mode==='manual'
        ?'The VPN container, its data and local client profiles will be removed. Delete the VM, disks and public IP separately in your cloud console to stop their charges.'
        :'The VPN, clients and owned cloud resources will be removed. This cannot be undone.'}});
    if(s.phase==='clientConfirm')return input(s,'confirm',s.operation==='createClient'?'Register a new VPN client?':'Revoke this VPN client?',[],{
      destructive:s.operation==='revokeClient',summary:{deploymentId:s.deploymentId,host:s.host,clientId:s.targetClientId,operation:s.operation}});
    if(s.phase==='updateConfirm')return input(s,'confirm','Update WireGuard to '+RELEASE+'?',[],{summary:{deploymentId:s.deploymentId,host:s.host,operation:'update',version:RELEASE,
      warning:'Installs wg-easy '+RELEASE+' and restarts WireGuard on the server. Existing clients and VPN profiles stay. If this phone is connected through this server, its VPN is turned off first: reconnect when the update finishes. If the new version does not start, the previous one is restored.'}});
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
    if(s.phase==='import')return output(s,{kind:'vpn.import',id:s.deploymentId+'-import-'+s.clientSequence,configRef:s.configRef,name:'VPN '+s.name,
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
        for(const key of ['interruptedPhase','suspendedPhase','httpStage','extraCleanup','creationAbsent','creationSent','allowRecreate','checkStatus','optionProblem','accountResumePhase','verifyKey','verifyStage','dropletCheck','dropletSeen','finding','findMoved','sameAccountAsked'])delete s[key];
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
        else if(s.phase==='credential'){if(typeof v.credentialRef!=='string')throw new Error('A native credential reference is required');s.credentialRef=v.credentialRef;s.phase=s.accountResumePhase||(s.sshCredentialRef?'options':'sshKey');if(s.accountResumePhase==='provision')s.httpStage='reconcile';delete s.accountResumePhase;s.optionIndex=0;}
        else if(s.phase==='sshKey'){if(typeof v.credentialRef!=='string'||!/^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/.test(v.publicKey||'')||(s.provider==='aws'&&!v.publicKey.startsWith('ssh-rsa ')))throw new Error('Select a valid SSH key (RSA for Lightsail)');s.sshCredentialRef=v.credentialRef;s.publicKey=v.publicKey.split(/\s+/).slice(0,2).join(' ');s.phase=s.mode==='manual'?'manual':'options';}
        else if(s.phase==='options'){
          const fields=[...OPTIONS[s.provider],field('sshCidr','Allow SSH from IPv4 CIDR','0.0.0.0/0')],f=fields[s.optionIndex||0];
          const value=String((v[f.key]===undefined?s.inputs[f.key]||f.default:v[f.key])||'').trim();
          // A setting the last answer's cleanInputs would refuse is asked again now: "nbg 1" heard by voice used to
          // stop the setup on "Invalid region", whose recovery asked only the last setting and failed the same way.
          const problem=settingProblem(f,value);
          if(problem){s.optionProblem=problem;return render(s);}
          delete s.optionProblem;s.inputs[f.key]=value;
          if((s.optionIndex||0)+1===fields.length){s.inputs=cleanInputs(s.provider,s.inputs);s.preflightIndex=0;s.verified=[];s.phase='preflight';}
          else s.optionIndex=(s.optionIndex||0)+1;
        }
        else if(s.phase==='manual'){if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(v.host||''))throw new Error('Enter public IPv4');s.host=v.host;s.phase='manualUser';}
        else if(s.phase==='manualUser'){if(!/^[a-z_][a-z0-9_-]{0,31}$/.test(v.user||''))throw new Error('Enter an SSH login name');s.user=v.user;s.phase='confirm';}
        else if(s.phase==='confirm'){if(v.confirmed!==true&&v.approved!==true){s.phase='cancelled';return output(s);}s.phase=s.mode==='manual'?'bootstrap':'provision';s.httpStage='create';}
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
          s.allowRecreate=true;s.phase='provision';s.httpStage='reconcile';return render(s);
        }
        else if(s.phase==='recovery'){
          delete s.verifyKey;delete s.verifyStage;delete s.dropletCheck;delete s.dropletSeen;
          const asked=s.sameAccountAsked;delete s.sameAccountAsked;
          if(asked&&v.action!=='sameAccountConfirmed')return render(s);
          if(v.action==='keep'){s.phase='cancelled';return output(s);}
          if(s.operation==='update'){s.phase=v.action==='retry'?'update':'health';return render(s);}
          if(unchecked(s)){
            // Change re-asks every setting with its current value filled in; checking again repeats the failed check.
            if(v.action==='edit'){s.optionIndex=0;s.phase='options';}
            else if(v.action==='retry')s.phase='preflight';
            // Other credentials may reach another account or project: every check runs again with them.
            else if(v.action==='account'&&s.mode==='automatic'&&CREDENTIALS[s.provider]){s.accountResumePhase='preflight';s.preflightIndex=0;s.verified=[];s.phase='credential';}
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
            s.optionIndex=0;s.phase=s.mode==='manual'?'manual':OPTIONS[s.provider]?'options':'provider';return render(s);
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
      if(s.phase==='preflight') {
        const check=preflight(s)[s.preflightIndex||0];
        if(status<200||status>=300){s.checkStatus=status;return pause(s,check.label+' could not be verified ('+providerError(status,b)+'). Check account permissions, region, plan and Ubuntu 24.04 image.');}
        const problem=check.problem(b&&typeof b==='object'?b:{},event.result);
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
