const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8'), context);
const worker = context.MobileSSHWorkflow;
const plain = value => JSON.parse(JSON.stringify(value));
const key = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQExample test';
function state(provider) {
  const inputs = Object.fromEntries(worker.optionFields[provider].map(f=>[f.key,f.default||'example']));
  if(provider==='vultr')inputs.imageId='1743';
  inputs.sshCidr='198.51.100.0/24';
  return {version:1,operation:'setup',deploymentId:'test-deployment-123',name:'mssh-testdeployment123',
    phase:'provision',mode:'automatic',provider,inputs,credentialRef:'cloud-ref',sshCredentialRef:'ssh-ref',
    publicKey:key,resources:{},keyChecked:true,index:0,attempt:0,httpStage:'create',user:worker.providers[provider][2],clientSequence:0};
}
function fixture(provider, resource, s) {
  const name=s.name,id=resource+'-id',ip='8.8.4.4';
  if(provider==='digitalocean')return ({key:{ssh_key:{id:11,name}},server:{droplet:{id:22,name,status:'active',networks:{v4:[{type:'public',ip_address:ip}]}}},
    address:{reserved_ip:{ip}},firewall:{firewall:{id:'fw-id',name}}})[resource];
  if(provider==='hetzner')return ({key:{ssh_key:{id:11,name}},firewall:{firewall:{id:22,name}},address:{primary_ip:{id:44,name,ip}},server:{server:{id:33,name,status:'running',public_net:{ipv4:{id:44,ip}}}}})[resource];
  if(provider==='gcp')return {id,name:resource==='sshFirewall'?name+'-ssh':resource==='vpnFirewall'?name+'-vpn':name,status:'RUNNING',address:ip};
  if(provider==='aws')return ({key:{keyPair:{name}},address:{staticIp:{ipAddress:ip}},server:{instance:{name,state:{name:'running'}}},
    firewall:{portStates:[{fromPort:51820,protocol:'udp',state:'open'}]},attachment:{staticIp:{ipAddress:ip,attachedTo:name,isAttached:true}}})[resource];
  if(provider==='azure')return {id:'/subscriptions/test/'+resource,name,properties:{provisioningState:'Succeeded',ipAddress:resource==='address'?ip:undefined}};
  if(provider==='linode')return resource==='server'?{id:11,label:name,status:'running',ipv4:[ip]}:{id:22,label:name};
  if(provider==='vultr')return ({key:{ssh_key:{id,name}},firewall:{firewall_group:{id,description:name}},sshRule:{firewall_rule:{id:1}},vpnRule:{firewall_rule:{id:2}},
    server:{instance:{id,label:name,status:'active',server_status:'ok',main_ip:ip}}})[resource];
  if(provider==='oci')return resource==='vnic'?[{vnicId:'vnic-id'}]:resource==='privateIp'?[{id:'private-id'}]:{id,displayName:name,lifecycleState:resource==='server'?'RUNNING':'AVAILABLE',ipAddress:resource==='address'?ip:undefined};
  if(provider==='ovh')return resource==='key'?{id,name}:{id,resourceStatus:'READY',currentState:{name,powerState:'ACTIVE',networks:[{addresses:[{version:4,ip,type:'public'}]}]}};
  if(provider==='scaleway')return ({key:{id,name},firewall:{security_group:{id,name}},sshRule:{rule:{id:'ssh-rule'}},vpnRule:{rule:{id:'vpn-rule'}},address:{ip:{id,address:ip}},
    server:{server:{id,name,state:'running',public_ip:{address:ip},volumes:{'0':{id:'boot-volume'}}}},power:{server:{id,name,state:'running'}}})[resource];
  throw Error(provider+'/'+resource);
}
function result(transition,body,status=200,extra={}) {
  return plain(worker.next(transition.state,{type:'result',requestId:transition.step.id,result:{status,body,...extra}}));
}
for(const provider of Object.keys(worker.providers).filter(p=>p!=='existing'))test(provider+' provisions through confirmed resource reads and native import',()=>{
  let current=plain(worker.next(state(provider),{type:'resume'}));
  for(let i=0;i<80&&current.step.kind!=='ssh';i++){
    assert.equal(current.step.kind,'http');
    assert.equal(current.step.auth.credentialRef,'cloud-ref');
    assert.match(current.step.url,/^https:\/\//);
    assert.ok(!current.step.url.includes('undefined'),current.step.url);
    if(!['GET','HEAD'].includes(current.step.method)&&!current.step.readOnly)assert.ok(current.step.reconcile,'mutation must declare reconciliation');
    const resource=worker.graph(current.state)[current.state.index].key;
    current=result(current,fixture(provider,resource,current.state));
  }
  assert.equal(current.step.operation,'bootstrap');
  assert.equal(current.step.host,'8.8.4.4');
  assert.match(current.step.args.image,/@sha256:[a-f0-9]{64}$/);
  current=result(current,{clientId:'7',configRef:'vault-config-ref'});
  assert.equal(current.step.kind,'vpn.import');
  assert.equal(current.step.configRef,'vault-config-ref');
  current=result(current,{profileId:'native-profile'});
  assert.equal(current.step.kind,'complete');
  assert.equal(current.state.phase,'ready');
  assert.equal(current.state.clients[0].profileId,'native-profile');
  assert.ok(!JSON.stringify(current.state).includes('vault-config-ref'));
  assert.ok(Object.values(current.state.resources).every(r=>r.owned&&r.provider===provider&&r.status==='created'));
});

test('provider and settings questions are single-field and credentials stay opaque',()=>{
  let current=plain(worker.next({deploymentId:'question-test',operation:'setup',inputs:{}},{type:'start'}));
  assert.equal(current.step.fields.length,1);
  current=plain(worker.next(current.state,{type:'input',value:{provider:'digitalocean'}}));
  assert.equal(current.step.fields[0].key,'mode');
  current=plain(worker.next(current.state,{type:'input',value:{mode:'automatic'}}));
  assert.equal(current.step.form,'credential');
  current=plain(worker.next(current.state,{type:'input',value:{credentialRef:'native-only',token:'never-persist-this'}}));
  assert.ok(!JSON.stringify(current.state).includes('never-persist-this'));
  current=plain(worker.next(current.state,{type:'input',value:{credentialRef:'ssh-ref',publicKey:key}}));
  assert.equal(current.step.fields.length,1);
  for(const value of [{region:'nyc3'},{size:'s-1vcpu-1gb'},{sshCidr:'198.51.100.0/24'}])current=plain(worker.next(current.state,{type:'input',value}));
  assert.equal(current.state.phase,'preflight');
  current=result(current,{sizes:[{slug:'s-1vcpu-1gb',available:true,regions:['nyc3']}]});
  current=result(current,{image:{id:42}});
  assert.equal(current.step.form,'confirm');
  assert.deepEqual(current.state.verified,['Droplet region and size','Ubuntu image']);
});

test('unknown creation matches one stable name and never silently duplicates',()=>{
  let current=plain(worker.next(state('digitalocean'),{type:'resume'}));
  current=result(current,{ssh_keys:[]},200,{recovered:true});
  assert.equal(current.step.form,'recovery');
  assert.equal(current.state.resources.key,undefined);
  let recovered=plain(worker.next(state('digitalocean'),{type:'resume'}));
  recovered=result(recovered,{ssh_keys:[{id:11,name:recovered.state.name}]},200,{recovered:true});
  assert.equal(recovered.state.resources.key.id,11);
  assert.equal(recovered.state.index,1);
  assert.equal(recovered.step.body.name,recovered.state.name);
});

test('stale events fail without changing the previous snapshot',()=>{
  const initial=state('gcp'),copy=plain(initial),current=worker.next(initial,{type:'resume'});
  assert.deepEqual(initial,copy);
  assert.throws(()=>worker.next(current.state,{type:'result',requestId:'another-step',result:{status:200,body:{}}}),/Stale/);
});

test('provider failure stops, preserves receipts and exposes actionable recovery',()=>{
  const initial=state('digitalocean');initial.resources.key={id:11,owned:true,status:'created'};initial.index=1;
  const current=result(plain(worker.next(initial,{type:'resume'})),{message:'provider could echo a secret'},403);
  assert.equal(current.step.form,'recovery');assert.equal(current.state.resources.key.id,11);
  assert.ok(!JSON.stringify(current.state).includes('echo a secret'));
});

test('cloud cleanup does not need SSH and retains deletion receipts until confirmed',()=>{
  const prior=state('gcp');prior.phase='ready';prior.host='8.8.4.4';prior.resources={server:{id:prior.name,owned:true,status:'created'}};
  let current=plain(worker.next({deploymentId:prior.deploymentId,operation:'delete',inputs:{deployment:prior}},{type:'start'}));
  assert.equal(current.step.form,'confirm');
  current=plain(worker.next(current.state,{type:'input',value:{approved:true}}));
  assert.equal(current.step.kind,'http');assert.equal(current.step.method,'DELETE');
  current=result(current,{name:'operation-delete'},202);
  assert.equal(current.step.kind,'delay');assert.equal(current.state.resources.server.status,'created');
  current=result(current,{});assert.equal(current.step.method,'GET');
  current=result(current,{},404);
  assert.equal(current.step.kind,'vpn.cleanup');assert.equal(current.state.resources.server.status,'deleted');
  current=result(current,{});assert.equal(current.state.phase,'deleted');
});

function hetznerAddressCleanup(){
  const prior=state('hetzner');prior.phase='cleanup';prior.index=2;prior.httpStage='delete';
  prior.resources={server:{id:33,owned:true,status:'deleted'},address:{id:44,owned:true,status:'created'}};
  return plain(worker.next(prior,{type:'resume'}));
}

test('Hetzner IPv4 cleanup waits for explicit detachment before submitting DELETE',()=>{
  let current=hetznerAddressCleanup();
  assert.equal(current.step.method,'GET');assert.match(current.step.url,/primary_ips\/44$/);
  assert.equal(current.state.httpStage,'deleteCheck');
  for(let count=0;count<2;count++){
    current=result(current,{primary_ip:{id:44,assignee_id:33}});
    assert.equal(current.step.kind,'delay');assert.equal(current.state.httpStage,'deleteCheck');
    assert.equal(current.state.resources.address.status,'created');
    current=result(current,{});
    assert.equal(current.step.method,'GET');assert.equal(current.state.httpStage,'deleteCheck');
  }
  current=result(current,{primary_ip:{id:44,assignee_id:null}});
  assert.equal(current.step.method,'DELETE');assert.equal(current.state.httpStage,'delete');
  assert.equal(current.state.attempt,0);assert.equal(current.step.reconcile.method,'GET');
  current=result(current,{},204);
  assert.equal(current.step.kind,'delay');
  current=result(current,{});
  assert.equal(current.step.method,'GET');assert.equal(current.state.httpStage,'deleteRead');
  current=result(current,{},404);
  assert.equal(current.step.kind,'vpn.cleanup');assert.equal(current.state.resources.address.status,'deleted');
});

test('Hetzner IPv4 cleanup refuses foreign assignments and unverified owned servers',()=>{
  for(const change of [
    {assignee:99},{assignee:'33'},{assignee:33,server:{id:33,owned:false,status:'deleted'}},
    {assignee:33,server:{id:33,owned:true,status:'created'}},{assignee:33,server:null}
  ]){
    let current=hetznerAddressCleanup();
    if(Object.hasOwn(change,'server'))current.state.resources.server=change.server;
    current=result(current,{primary_ip:{id:44,assignee_id:change.assignee}});
    assert.equal(current.step.form,'recovery');assert.match(current.state.error.message,/unverified server/);
    assert.equal(current.state.resources.address.status,'created');
    current=plain(worker.next(current.state,{type:'input',value:{action:'reconcile'}}));
    assert.equal(current.step.method,'GET');assert.equal(current.state.httpStage,'deleteCheck');
  }
});

test('Hetzner IPv4 cleanup refuses missing assignment metadata and mismatched IDs',()=>{
  for(const body of [{},{primary_ip:{}},{primary_ip:{id:44}},{primary_ip:{id:99,assignee_id:null}},
    {primary_ip:{id:'44',assignee_id:null}},{primary_ip:{id:44,assignee_id:false}}]){
    const current=result(hetznerAddressCleanup(),body);
    assert.equal(current.step.form,'recovery');assert.equal(current.state.resources.address.status,'created');
  }
});

test('Hetzner IPv4 pre-delete 404 confirms absence without a DELETE',()=>{
  const current=result(hetznerAddressCleanup(),{},404);
  assert.equal(current.step.kind,'vpn.cleanup');assert.equal(current.state.resources.address.status,'deleted');
});

test('Hetzner IPv4 detachment polling is bounded and preserves its receipt',()=>{
  let current=hetznerAddressCleanup(),checks=0;
  while(current.step.kind!=='input'){
    assert.equal(current.step.method,'GET');
    current=result(current,{primary_ip:{id:44,assignee_id:33}});checks++;
    assert.ok(checks<=61,'detachment polling must terminate');
    if(current.step.kind==='delay')current=result(current,{});
  }
  assert.equal(checks,61);assert.equal(current.step.form,'recovery');
  assert.match(current.state.error.message,/polling limit/);assert.equal(current.state.resources.address.status,'created');
});

test('Hetzner IPv4 422 after a verified detach still requires review without blind retries',()=>{
  let current=result(hetznerAddressCleanup(),{primary_ip:{id:44,assignee_id:null}});
  assert.equal(current.step.method,'DELETE');
  current=result(current,{error:{code:'invalid_input'}},422);
  assert.equal(current.step.form,'recovery');assert.equal(current.state.resources.address.status,'created');
  current=plain(worker.next(current.state,{type:'input',value:{action:'retry'}}));
  assert.equal(current.step.method,'GET');assert.equal(current.state.httpStage,'deleteCheck');
});

function hetznerFirewallCleanup(){
  const prior=state('hetzner');prior.phase='cleanup';prior.index=1;prior.httpStage='delete';
  prior.resources={key:{id:11,owned:true,status:'created'},firewall:{id:22,owned:true,status:'created'},
    address:{id:44,owned:true,status:'deleted'},server:{id:33,owned:true,status:'deleted'}};
  return plain(worker.next(prior,{type:'resume'}));
}

test('Hetzner firewall still in use after its server is gone is deleted again after a wait',()=>{
  let current=hetznerFirewallCleanup();
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/firewalls\/22$/);
  for(let count=1;count<=3;count++){
    current=result(current,{error:{code:'resource_in_use',message:'firewall with ID 22 is still in use'}},422);
    assert.equal(current.step.kind,'delay');assert.equal(current.state.attempt,count);
    assert.equal(current.state.resources.firewall.status,'created');
    current=result(current,{});
    assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/firewalls\/22$/);
  }
  current=result(current,{},204);
  assert.equal(current.step.kind,'delay');
  current=result(current,{});
  assert.equal(current.step.method,'GET');assert.equal(current.state.httpStage,'deleteRead');
  current=result(current,{},404);
  assert.equal(current.state.resources.firewall.status,'deleted');
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/ssh_keys\/11$/);
});

test('Hetzner locked or conflicting deletions retry, other providers and the primary IPv4 still pause',()=>{
  for(const [status,code] of [[409,'conflict'],[423,'locked'],[409,'locked']]){
    let current=result(hetznerFirewallCleanup(),{error:{code,message:'action in progress'}},status);
    assert.equal(current.step.kind,'delay',code);
    current=result(current,{});
    assert.equal(current.step.method,'DELETE',code);
  }
  const other=result(hetznerFirewallCleanup(),{error:{code:'invalid_input',message:'invalid input'}},422);
  assert.equal(other.step.form,'recovery');
  const prior=state('digitalocean');prior.phase='cleanup';prior.index=3;prior.httpStage='delete';
  prior.resources.firewall={id:'fw-id',owned:true,status:'created'};
  const digitalocean=result(plain(worker.next(prior,{type:'resume'})),{id:'unprocessable_entity',message:'resource in use'},422);
  assert.equal(digitalocean.step.form,'recovery');
  const address=result(result(hetznerAddressCleanup(),{primary_ip:{id:44,assignee_id:null}}),{error:{code:'resource_in_use'}},422);
  assert.equal(address.step.form,'recovery');assert.equal(address.state.resources.address.status,'created');
});

test('Hetzner in-use deletion retries are bounded by the polling limit and keep the receipt',()=>{
  let current=hetznerFirewallCleanup(),deletes=0;
  while(current.step.kind!=='input'){
    assert.equal(current.step.method,'DELETE');
    current=result(current,{error:{code:'resource_in_use',message:'firewall with ID 22 is still in use'}},422);deletes++;
    assert.ok(deletes<=61,'in-use retries must terminate');
    if(current.step.kind==='delay')current=result(current,{});
  }
  assert.equal(deletes,61);assert.equal(current.step.form,'recovery');
  assert.match(current.state.error.message,/polling limit \(HTTP 422, resource_in_use: firewall with ID 22 is still in use\)/);
  assert.equal(current.state.resources.firewall.status,'created');
  current=plain(worker.next(current.state,{type:'input',value:{action:'retry'}}));
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/firewalls\/22$/);
});

test('a provider pause names the error code and a short message without headers or tokens',()=>{
  const token='hcloudSecretTokenValue0123456789abcdefABCDEF';
  const current=result(hetznerFirewallCleanup(),{error:{code:'forbidden',
    message:'token '+token+' lacks write access to this project and '+'more detail '.repeat(20)}},403,{headers:{authorization:'Bearer header-secret'}});
  assert.equal(current.step.form,'recovery');
  const text=current.state.error.message;
  assert.match(text,/^Cloud firewall deletion failed \(HTTP 403, forbidden: token \[redacted\] lacks write access/);
  assert.match(text,/\.\.\.\)\. Remaining resources are retained for retry\.$/);
  assert.ok(text.length<220,text);
  assert.ok(!JSON.stringify(current.state).includes(token));
  assert.ok(!JSON.stringify(current.state).includes('header-secret'));
  const unsafe=result(hetznerFirewallCleanup(),{error:{code:'not a code <b>',message:'denied'}},403);
  assert.match(unsafe.state.error.message,/\(HTTP 403: denied\)/);
});

test('client mutations require a fresh confirmation but health does not',()=>{
  const prior=state('azure');prior.phase='ready';prior.host='8.8.4.4';
  for(const operation of ['createClient','revokeClient']){
    const current=worker.next({deploymentId:prior.deploymentId,operation,inputs:{deployment:prior,clientId:'7'}},{type:'start'});
    assert.equal(current.step.form,'confirm');
  }
  assert.equal(worker.next({deploymentId:prior.deploymentId,operation:'health',inputs:{deployment:prior}},{type:'start'}).step.operation,'health');
});

test('every new install and update uses the same digest-pinned wg-easy release',()=>{
  assert.match(worker.image,/^ghcr\.io\/wg-easy\/wg-easy:15\.5\.0@sha256:[a-f0-9]{64}$/);
  assert.equal(worker.release,'15.5.0');
  const installer=fs.readFileSync(path.join(__dirname,'..','server','vpn.py'),'utf8');
  assert.ok(installer.includes('IMAGE = "'+worker.image+'"'),'worker and installer pin one image');
});

function lifecycle(operation,prior,extra){
  return plain(worker.next({deploymentId:prior.deploymentId,operation,inputs:{deployment:prior,...extra}},{type:'start'}));
}
function deployed(){
  const prior=state('hetzner');prior.phase='ready';prior.host='203.0.113.7';prior.clientSequence=3;
  prior.clients=[{clientId:'1',profileId:'first-profile'}];prior.profileId='first-profile';prior.lastClientId='1';
  prior.health={healthy:true,clients:[{id:'1',enabled:true}],target:'15.5.0',version:'15.4.0',current:false};
  return prior;
}

test('update asks for a native confirmation naming the release, then runs the pinned installer update',()=>{
  const prior=deployed();
  let current=lifecycle('update',prior);
  assert.equal(current.step.kind,'input');assert.equal(current.step.form,'confirm');
  assert.equal(current.step.title,'Update WireGuard to 15.5.0?');
  assert.equal(current.step.destructive,undefined);
  assert.equal(current.step.summary.version,'15.5.0');assert.equal(current.step.summary.operation,'update');
  assert.match(current.step.summary.warning,/clients and VPN profiles stay/);
  // The host stops this phone's tunnel to the server first and never restarts it: the text must not promise a short drop.
  assert.match(current.step.summary.warning,/its VPN is turned off first: reconnect when the update finishes/);
  assert.doesNotMatch(current.step.summary.warning,/few seconds/);
  current=plain(worker.next(current.state,{type:'input',value:{approved:true}}));
  assert.equal(current.step.kind,'ssh');assert.equal(current.step.operation,'update');
  assert.equal(current.step.id,prior.deploymentId+'-update-3');
  assert.equal(current.step.args.image,worker.image);assert.equal(current.step.host,'203.0.113.7');
  assert.equal(current.step.credentialRef,'ssh-ref');
  current=result(current,{healthy:true,updated:true,version:'15.5.0',current:true});
  assert.equal(current.step.kind,'complete');assert.equal(current.state.phase,'ready');
  assert.deepEqual(current.state.health,{healthy:true,clients:[{id:'1',enabled:true}],target:'15.5.0',version:'15.5.0',current:true,updated:true});
  // Clients, profiles and the client numbering are untouched.
  assert.deepEqual(current.state.clients,prior.clients);assert.equal(current.state.profileId,'first-profile');
  assert.equal(current.state.clientSequence,3);
  // A later update of the same deployment is a new job with the same stable step id.
  const again=plain(worker.next(lifecycle('update',current.state).state,{type:'input',value:{approved:true}}));
  assert.equal(again.step.id,prior.deploymentId+'-update-3');
});

test('declining the update changes nothing on the server',()=>{
  for(const value of [{approved:false},{},{confirmed:'yes'}]){
    const current=plain(worker.next(lifecycle('update',deployed()).state,{type:'input',value}));
    assert.equal(current.step.kind,'complete');assert.equal(current.state.phase,'cancelled');
    assert.equal(current.state.health.version,'15.4.0');
  }
});

function failedUpdate(code){
  const started=plain(worker.next(lifecycle('update',deployed()).state,{type:'input',value:{approved:true}}));
  return {id:started.step.id,current:plain(worker.next(started.state,{type:'error',stepId:started.step.id,code}))};
}
test('an interrupted update pauses for review and retries the same idempotent installer step only when asked',()=>{
  let {id,current}=failedUpdate('operation_interrupted');
  assert.equal(current.step.form,'recovery');assert.equal(current.state.interruptedPhase,'update');
  assert.equal(current.state.error.message,'The operation was interrupted. Check current state before retrying.');
  // Only a read-only check, an explicit retry or stopping: no cloud reconciliation, cleanup or recreation inside an update job.
  assert.deepEqual(current.step.fields.map(f=>[f.key,f.default,f.options.map(o=>o.value)]),[['action','health',['health','retry','keep']]]);
  current=plain(worker.next(current.state,{type:'input',value:{action:'retry'}}));
  assert.equal(current.step.kind,'ssh');assert.equal(current.step.operation,'update');assert.equal(current.step.id,id);
  current=result(current,{healthy:true,updated:false,version:'15.5.0',current:true});
  assert.equal(current.state.phase,'ready');assert.equal(current.state.health.updated,false);
});

test('checking the server after a failed update runs the read-only health step, never the update again',()=>{
  for(const action of ['health','reconcile','cleanup','edit']){
    let {current}=failedUpdate('UPDATE_ROLLED_BACK');
    current=plain(worker.next(current.state,{type:'input',value:{action}}));
    assert.equal(current.step.kind,'ssh',action);assert.equal(current.step.operation,'health',action);
    assert.equal(current.step.args.image,worker.image);
    const rolledBack=result(current,{healthy:true,clients:[{id:'1',enabled:true}],version:'15.4.0',current:false});
    assert.equal(rolledBack.step.kind,'complete');assert.equal(rolledBack.state.phase,'cancelled','the update did not happen: stopped, not done');
    assert.deepEqual(rolledBack.state.health,{healthy:true,clients:[{id:'1',enabled:true}],target:'15.5.0',version:'15.4.0',current:false});
    // The result of an update whose answer was lost on the way back: the check finds the pin running.
    assert.equal(result(current,{healthy:true,clients:[],version:'15.5.0',current:true}).state.phase,'ready');
  }
  const {current}=failedUpdate('UPDATE_ROLLED_BACK');
  assert.equal(plain(worker.next(current.state,{type:'input',value:{action:'keep'}})).state.phase,'cancelled');
});

test('each fixed update outcome says what state the server is in',()=>{
  for(const [code,text,health] of [
    ['UPDATE_NOT_DOWNLOADED',/could not download WireGuard 15\.5\.0\. WireGuard on the server was not changed\. If this phone's VPN was turned off/,true],
    ['UPDATE_ROLLED_BACK',/did not start correctly, so the server went back to the previous version with its clients\. If this phone's VPN/,true],
    ['UPDATE_RESTORE_FAILED',/previous version did not restart either: the VPN on this server is down\. Retry the update/,false]]){
    const {current}=failedUpdate(code);
    assert.equal(current.step.form,'recovery',code);assert.match(current.state.error.message,text);
    assert.equal(current.step.error.message,current.state.error.message);
    assert.equal('health' in current.state,health,code+': a version line for a server that is down would be stale');
  }
  // The codes only describe an update step; elsewhere they are a plain interruption.
  const prior=deployed();const checking=lifecycle('health',prior);
  const other=plain(worker.next(checking.state,{type:'error',stepId:checking.step.id,code:'UPDATE_ROLLED_BACK'}));
  assert.equal(other.state.error.message,'The operation was interrupted. Check current state before retrying.');
  assert.equal(failedUpdate('INSTALLER_FAILED').current.state.error.message,'The operation was interrupted. Check current state before retrying.');
});

test('health keeps the running version and pin status, dropping anything malformed',()=>{
  const prior=deployed();delete prior.health;
  let current=lifecycle('health',prior);
  assert.equal(current.step.operation,'health');assert.equal(current.step.id,prior.deploymentId+'-health-3');
  const checked=result(current,{healthy:true,clients:[{id:'1',enabled:true}],version:'15.4.0',current:false});
  assert.deepEqual(checked.state.health,{healthy:true,clients:[{id:'1',enabled:true}],target:'15.5.0',version:'15.4.0',current:false});
  for(const [version,currentFlag] of [['15.4.0-beta.1','false'],[' 15.4.0',1],['1234.5.6',null],[15,undefined]]){
    const odd=result(lifecycle('health',prior),{healthy:true,version,current:currentFlag,updated:'yes'});
    assert.deepEqual(odd.state.health,{healthy:true,clients:[],target:'15.5.0'});
  }
  // A host older than bridge 1.4.0 reports neither field; the result stays as before.
  const legacy=result(lifecycle('health',prior),{healthy:true,clients:[]});
  assert.deepEqual(Object.keys(legacy.state.health).sort(),['clients','healthy','target']);
});

test('update is a known lifecycle operation that still needs an owned deployment',()=>{
  assert.throws(()=>worker.next({deploymentId:'no-snapshot',operation:'update',inputs:{}},{type:'start'}),/owned deployment snapshot/);
  assert.throws(()=>worker.next({deploymentId:'x',operation:'upgrade',inputs:{deployment:deployed()}},{type:'start'}),/Unknown workflow operation/);
});

test('revocation keeps Open VPN pointed at a surviving profile and clears the last removed profile',()=>{
  function revoke(prior,clientId){
    let current=plain(worker.next({deploymentId:prior.deploymentId,operation:'revokeClient',inputs:{deployment:prior,clientId}},{type:'start'}));
    current=plain(worker.next(current.state,{type:'input',value:{approved:true}}));
    assert.equal(current.step.operation,'revokeClient');
    return result(current,{revoked:true,clientId}).state;
  }
  const prior=state('hetzner');prior.phase='ready';prior.host='8.8.4.4';
  prior.clients=[{clientId:'1',profileId:'first-profile'},{clientId:'2',profileId:'newest-profile'}];
  prior.profileId='newest-profile';prior.lastClientId='2';
  assert.equal(revoke(prior,'1').profileId,'newest-profile');
  const remaining=revoke(prior,'2');
  assert.equal(remaining.profileId,'first-profile');assert.equal(remaining.lastClientId,'1');
  const empty=revoke(remaining,'1');
  assert.deepEqual(empty.clients,[]);assert.equal(empty.profileId,undefined);assert.equal(empty.lastClientId,undefined);
});

test('Scaleway and OVH use explicit networking and firewalls',()=>{
  const sc=state('scaleway');sc.resources={address:{id:'ip'},firewall:{id:'fw'}};
  const server=worker.graph(sc).find(x=>x.key==='server').create.body;
  assert.deepEqual(plain(server.public_ips),['ip']);assert.equal(server.security_group,'fw');assert.equal(server.dynamic_ip_required,false);
  const ovh=state('ovh');ovh.resources={firewall:{id:'fw'}};
  const ops=worker.graph(ovh),instance=ops.find(x=>x.key==='server').create;
  assert.match(instance.url,/\/v2\/publicCloud\/project\/.+\/compute\/instance$/);
  assert.deepEqual(plain(instance.body.targetSpec.securityGroups),[{id:'fw'}]);
  assert.deepEqual(plain(instance.body.targetSpec.networks),[{autoAssignPublicIp:true}]);
});

test('Linode password generation is a native binding, never a JS password',()=>{
  const req=worker.graph(state('linode'))[0].create;
  assert.deepEqual(plain(req.secretBody),{root_pass:'generatedPassword'});
  assert.equal(req.body.root_pass,undefined);
});

test('a 503 on creation must reconcile and needs a second approval before recreating',()=>{
  let current=plain(worker.next(state('digitalocean'),{type:'resume'}));
  current=result(current,{code:'service_unavailable'},503);
  current=plain(worker.next(current.state,{type:'input',value:{action:'retry'}}));
  assert.equal(current.step.method,'GET');assert.match(current.step.url,/\/account\/keys$/);
  current=result(current,{ssh_keys:[]});
  assert.equal(current.state.creationAbsent,true);
  current=plain(worker.next(current.state,{type:'input',value:{action:'recreate'}}));
  assert.equal(current.step.form,'confirm');
  current=plain(worker.next(current.state,{type:'input',value:{approved:true}}));
  assert.equal(current.step.method,'GET');
  current=result(current,{ssh_keys:[]});
  assert.equal(current.step.method,'POST');
});

test('multiple matches cannot authorize another resource creation',()=>{
  let current=plain(worker.next(state('digitalocean'),{type:'resume'}));
  current=result(current,{ssh_keys:[{id:1,name:current.state.name},{id:2,name:current.state.name}]},200,{recovered:true});
  assert.equal(current.step.form,'recovery');assert.equal(current.state.creationAbsent,undefined);
  assert.ok(!current.step.fields[0].options.some(x=>x.value==='recreate'));
});

test('AWS NotFoundException HTTP400 is confirmed absence during teardown',()=>{
  const prior=state('aws');prior.phase='cleanup';prior.index=2;prior.httpStage='deleteRead';
  prior.resources.server={id:prior.name,owned:true,status:'created'};
  let current=plain(worker.next(prior,{type:'resume'}));
  current=result(current,{__type:'NotFoundException'},400);
  assert.equal(current.step.kind,'vpn.cleanup');assert.equal(current.state.resources.server.status,'deleted');
});

test('retained Scaleway volume deletion survives interruption and keeps receipt',()=>{
  const prior=state('scaleway');prior.phase='cleanupExtra';prior.index=3;prior.httpStage='delete';
  prior.extraCleanup=[{id:'volume-id',type:'volume',url:'https://api.scaleway.com/instance/v1/zones/fr-par-1/volumes/volume-id'}];
  prior.resources['volume_volume-id']={id:'volume-id',provider:'scaleway',type:'volume',owned:true,status:'created'};
  let current=plain(worker.next(prior,{type:'resume'}));
  assert.equal(current.step.method,'DELETE');assert.equal(current.step.reconcile.method,'GET');
  current=result(current,{volume:{id:'volume-id'}},200,{recovered:true});
  assert.equal(current.step.kind,'delay');assert.equal(current.state.resources['volume_volume-id'].status,'created');
  current=result(current,{});assert.equal(current.step.method,'GET');
  current=result(current,{},404);
  assert.equal(current.state.resources['volume_volume-id'].status,'deleted');
  assert.equal(current.step.kind,'vpn.cleanup');
});

test('existing public server skips cloud credentials and can use voice-sized fields',()=>{
  let current=plain(worker.next({deploymentId:'existing-test',operation:'setup',inputs:{}},{type:'start'}));
  current=plain(worker.next(current.state,{type:'input',value:{provider:'existing'}}));
  assert.equal(current.step.form,'sshKey');
  current=plain(worker.next(current.state,{type:'input',value:{credentialRef:'native-key',publicKey:key}}));
  assert.equal(current.step.fields.length,1);assert.equal(current.step.fields[0].key,'host');
  current=plain(worker.next(current.state,{type:'input',value:{host:'8.8.4.4'}}));
  assert.equal(current.step.fields[0].key,'user');
  current=plain(worker.next(current.state,{type:'input',value:{user:'ubuntu'}}));
  assert.equal(current.step.form,'confirm');
  current=plain(worker.next(current.state,{type:'input',value:{approved:true}}));
  assert.equal(current.step.kind,'ssh');assert.equal(current.state.credentialRef,undefined);
});

test('existing account SSH keys are reused and never removed by deployment cleanup',()=>{
  const prior=state('digitalocean');prior.keyChecked=false;prior.publicKey=key.split(' ').slice(0,2).join(' ');
  let current=plain(worker.next(prior,{type:'resume'}));
  assert.equal(current.step.method,'GET');assert.match(current.step.url,/account\/keys\?per_page/);
  current=result(current,{ssh_keys:[{id:12,name:'shared-key',public_key:key}]});
  assert.equal(current.state.resources.key.owned,false);
  assert.equal(current.step.body.ssh_keys[0],12);
  current.state.phase='cleanup';current.state.index=0;current.state.httpStage='delete';
  current=plain(worker.next(current.state,{type:'resume'}));
  assert.equal(current.step.kind,'vpn.cleanup');
  assert.equal(current.state.resources.key.status,'existing');
  const ovh=state('ovh');ovh.resources.key={id:'existing-id',name:'shared-key',owned:false};
  assert.equal(worker.graph(ovh).find(x=>x.key==='server').create.body.targetSpec.sshKeyName,'shared-key');
});

test('redirects and malformed HTTP status cannot produce resource receipts',()=>{
  for(const status of [0,199,301,307]){
    const current=result(plain(worker.next(state('digitalocean'),{type:'resume'})),{},status);
    assert.equal(current.step.form,'recovery');assert.equal(current.state.resources.key,undefined);
  }
});

test('re-entering credentials after uncertain creation still reconciles before mutation',()=>{
  let current=plain(worker.next(state('digitalocean'),{type:'resume'}));
  current=result(current,{},503);
  current=plain(worker.next(current.state,{type:'input',value:{action:'account'}}));
  assert.equal(current.step.form,'credential');
  current=plain(worker.next(current.state,{type:'input',value:{credentialRef:'updated-ref'}}));
  assert.equal(current.step.method,'GET');assert.equal(current.state.httpStage,'reconcile');
  assert.equal(current.step.auth.credentialRef,'updated-ref');
});

test('invalid final settings can be corrected without losing the pending field',()=>{
  const prior=state('digitalocean');prior.phase='options';prior.optionIndex=2;
  let current=plain(worker.next(prior,{type:'input',value:{sshCidr:'invalid'}}));
  assert.equal(current.step.form,'recovery');
  current=plain(worker.next(current.state,{type:'input',value:{action:'retry'}}));
  assert.equal(current.step.fields[0].key,'sshCidr');
  current=plain(worker.next(current.state,{type:'input',value:{sshCidr:'198.51.100.0/24'}}));
  assert.equal(current.state.phase,'preflight');
});

test('partial reconciliation pages cannot prove absence or authorize recreation',()=>{
  const cases=[
    {provider:'digitalocean',body:{ssh_keys:[],links:{pages:{next:'https://api.digitalocean.com/v2/account/keys?page=2'}}}},
    {provider:'hetzner',body:{ssh_keys:[],meta:{pagination:{next_page:2}}}},
    {provider:'linode',body:{data:[],page:1,pages:2,results:101}},
    {provider:'scaleway',body:{ssh_keys:[],total_count:1}},
    {provider:'oci',body:[],headers:{'opc-next-page':'page-two'}},
    {provider:'ovh',body:[],headers:{'x-pagination-cursor-next':'page-two'}},
    {provider:'digitalocean',body:{ssh_keys:[]},headers:{link:'<https://api.digitalocean.com/v2/account/keys?page=2>; rel="next"'}},
    {provider:'digitalocean',body:{ssh_keys:[]},headers:{'x-total-count':'1'}}
  ];
  for(const sample of cases){
    const prior=state(sample.provider);prior.httpStage='reconcile';prior.allowRecreate=true;prior.creationAbsent=true;
    const current=result(plain(worker.next(prior,{type:'resume'})),sample.body,200,{headers:sample.headers||{}});
    assert.equal(current.step.form,'recovery',sample.provider);
    assert.equal(current.state.creationAbsent,undefined,sample.provider);
    assert.equal(current.state.allowRecreate,undefined,sample.provider);
    assert.ok(!current.step.fields[0].options.some(x=>x.value==='recreate'),sample.provider);
    assert.equal(Object.keys(current.state.resources).length,0,sample.provider);
  }
});

test('one match on an incomplete page is not considered a unique recovered resource',()=>{
  const prior=state('vultr');prior.index=4;prior.httpStage='reconcile';
  const current=result(plain(worker.next(prior,{type:'resume'})),{
    instances:[{id:'first-match',label:prior.name,status:'active',server_status:'ok',main_ip:'8.8.4.4'}],
    meta:{links:{next:'cursor-page-two'}}
  });
  assert.equal(current.step.form,'recovery');assert.equal(current.state.resources.server,undefined);
});

test('a full page without metadata also fails closed, while an explicit empty total permits review',()=>{
  const prior=state('digitalocean');prior.httpStage='reconcile';
  const full=result(plain(worker.next(prior,{type:'resume'})),{
    ssh_keys:Array.from({length:20},(_,i)=>({id:i,name:'other-key-'+i}))
  });
  assert.equal(full.step.form,'recovery');assert.equal(full.state.creationAbsent,undefined);
  const empty=result(plain(worker.next(prior,{type:'resume'})),{ssh_keys:[],meta:{total:0}});
  assert.equal(empty.step.form,'recovery');assert.equal(empty.state.creationAbsent,true);
});

test('missing key on a partial account page never submits another key POST',()=>{
  const prior=state('digitalocean');prior.keyChecked=false;
  let current=plain(worker.next(prior,{type:'resume'}));
  current=result(current,{ssh_keys:[],meta:{total:201}});
  assert.equal(current.step.form,'recovery');assert.equal(current.state.keyChecked,false);
  current=plain(worker.next(current.state,{type:'input',value:{action:'retry'}}));
  assert.equal(current.step.method,'GET');assert.match(current.step.url,/account\/keys\?/);
});

test('Hetzner preflight rejects unavailable or unadvertised capacity before any mutation',()=>{
  const locations=[
    [{id:1,name:'fsn1',available:false},{id:2,name:'nbg1',available:true}],
    [{id:2,name:'nbg1',available:true}],
    [{id:1,name:'fsn1',available:'true'}],
    [{id:1,name:'fsn1'}],
    [],null
  ];
  for(const value of locations){
    const prior=state('hetzner');prior.phase='preflight';prior.preflightIndex=0;
    let current=plain(worker.next(prior,{type:'resume'}));
    assert.equal(current.step.method,'GET');assert.match(current.step.url,/server_types\?name=cx23$/);
    current=result(current,{server_types:[{name:'cx23',architecture:'x86',locations:value}]});
    assert.equal(current.step.kind,'input');assert.equal(current.step.form,'recovery');
    assert.match(current.state.error.message,/selected location/);
    assert.deepEqual(current.state.resources,{});
    assert.ok(!current.state.verified||!current.state.verified.length);
  }
});

test('Hetzner advertised capacity still requires location validation and native approval',()=>{
  const prior=state('hetzner');prior.phase='preflight';prior.preflightIndex=0;
  let current=plain(worker.next(prior,{type:'resume'}));
  current=result(current,{server_types:[{name:'cx23',architecture:'x86',locations:[{id:1,name:'fsn1',available:true}]}]});
  assert.equal(current.step.method,'GET');assert.match(current.step.url,/locations\?name=fsn1$/);
  current=result(current,{locations:[{id:1,name:'fsn1'}]});
  assert.equal(current.step.form,'confirm');assert.deepEqual(current.state.resources,{});
});

test('Hetzner legacy type responses without locations retain architecture and separate location checks',()=>{
  const prior=state('hetzner');prior.phase='preflight';prior.preflightIndex=0;
  const initial=plain(worker.next(prior,{type:'resume'}));
  const compatible=result(initial,{server_types:[{name:'cx23',architecture:'x86'}]});
  assert.equal(compatible.step.method,'GET');assert.match(compatible.step.url,/locations\?/);
  const wrongArchitecture=result(initial,{server_types:[{name:'cx23',architecture:'arm'}]});
  assert.equal(wrongArchitecture.step.form,'recovery');assert.deepEqual(wrongArchitecture.state.resources,{});
});
