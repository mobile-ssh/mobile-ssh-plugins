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

test('an invalid final setting is asked again at once, saying why, and its correction goes on to the checks',()=>{
  const prior=state('digitalocean');prior.phase='options';prior.optionIndex=2;
  let current=plain(worker.next(prior,{type:'input',value:{sshCidr:'invalid'}}));
  assert.equal(current.step.form,'instance');assert.equal(current.step.fields[0].key,'sshCidr');
  assert.equal(current.step.id,'test-deployment-123-options-2');
  assert.equal(current.step.message,'Enter an IPv4 range in CIDR form, such as 203.0.113.0/24.');
  assert.deepEqual(current.step.error,{code:'invalid_setting',message:current.step.message});
  // The last usable value stays and is offered again; the refused one is kept nowhere.
  assert.equal(current.step.fields[0].default,'198.51.100.0/24');assert.equal(current.state.inputs.sshCidr,'198.51.100.0/24');
  current=plain(worker.next(current.state,{type:'input',value:{sshCidr:'198.51.100.0/24'}}));
  assert.equal(current.state.phase,'preflight');assert.equal(current.state.optionProblem,undefined);
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

test('a Scaleway key found by a lookup keeps its own id, as the create answer gives it',()=>{
  const prior=state('scaleway');prior.httpStage='reconcile';
  const found=result(plain(worker.next(prior,{type:'resume'})),{ssh_keys:[{id:'key-real',name:prior.name}],total_count:1});
  assert.equal(found.state.resources.key.id,'key-real');assert.equal(found.state.resources.key.name,prior.name);
  const created=result(plain(worker.next(state('scaleway'),{type:'resume'})),{id:'key-made',name:prior.name});
  assert.equal(created.state.resources.key.id,'key-made');
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

function preflighting(provider,inputs={},index=0,extra={}){
  const prior=Object.assign(state(provider),{phase:'preflight',preflightIndex:index},extra);Object.assign(prior.inputs,inputs);
  return plain(worker.next(prior,{type:'resume'}));
}
// A failed check pauses on the settings question, with its reason as the error and the native review's message.
function refused(current,reason){
  assert.equal(current.step.kind,'input');assert.equal(current.step.form,'recovery');
  assert.equal(current.step.title,'Check the server settings');
  if(reason instanceof RegExp)assert.match(current.state.error.message,reason);else assert.equal(current.state.error.message,reason);
  assert.equal(current.step.message,current.state.error.message);assert.equal(current.step.error.message,current.state.error.message);
  assert.deepEqual(current.state.resources,{});
  return current;
}

test('Hetzner preflight rejects unavailable or unadvertised capacity before any mutation, saying why',()=>{
  const none=' No location has it right now.';
  const cases=[
    [[{id:1,name:'fsn1',available:false,recommended:false,deprecation:null},{id:2,name:'nbg1',available:true,recommended:false,deprecation:null},
      {id:3,name:'hel1',available:true,recommended:true,deprecation:null}],'Server type cx23 is sold out in fsn1 right now. Locations with it: hel1, nbg1.'],
    [[{id:2,name:'nbg1',available:true}],'Server type cx23 isn\'t offered in fsn1. Locations with it: nbg1.'],
    [[{id:1,name:'fsn1',available:'true'}],'Hetzner did not confirm that server type cx23 can be ordered in fsn1.'+none],
    [[{id:1,name:'fsn1'}],'Hetzner did not confirm that server type cx23 can be ordered in fsn1.'+none],
    [[{id:1,name:'fsn1',available:false,deprecation:{announced:'2026-01-01T00:00:00Z',unavailable_after:'2026-06-01T00:00:00Z'}},{id:2,name:'nbg1',available:false}],
      'Server type cx23 is being retired in fsn1 and can\'t be ordered there.'+none],
    [[],'Server type cx23 isn\'t offered in fsn1.'+none],
    [null,'Hetzner did not list where server type cx23 can be ordered.']
  ];
  for(const [value,reason] of cases){
    let current=preflighting('hetzner');
    assert.equal(current.step.method,'GET');assert.match(current.step.url,/server_types\?name=cx23$/);
    current=refused(result(current,{server_types:[{name:'cx23',architecture:'x86',locations:value}]}),reason);
    assert.ok(!current.state.verified||!current.state.verified.length);
  }
  refused(result(preflighting('hetzner'),{server_types:[]}),'Hetzner Cloud has no server type cx23.');
  refused(result(preflighting('hetzner'),{server_types:[{name:'cx33',architecture:'x86'}]}),'Hetzner Cloud has no server type cx23.');
  refused(result(preflighting('hetzner'),{server_types:[{name:'cx23',architecture:'arm',locations:[]}]}),
    'Server type cx23 is not an x86 type (it is arm). Choose an x86 server type.');
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
  refused(result(compatible,{locations:[]}),'Hetzner Cloud has no location fsn1.');
  const wrongArchitecture=result(initial,{server_types:[{name:'cx23',architecture:'arm'}]});
  assert.equal(wrongArchitecture.step.form,'recovery');assert.deepEqual(wrongArchitecture.state.resources,{});
});

test('DigitalOcean preflight names the missing size, its availability or the regions that have it',()=>{
  const size=(extra)=>({sizes:[{slug:'s-2vcpu-2gb',available:true,regions:['nyc3']},{slug:'s-1vcpu-1gb',available:true,regions:['nyc3'],...extra}]});
  for(const [body,reason] of [
    [{sizes:[]},'DigitalOcean listed no Droplet sizes. The token may lack read access to sizes and regions.'],
    [{},'DigitalOcean listed no Droplet sizes. The token may lack read access to sizes and regions.'],
    [{sizes:[{slug:'s-2vcpu-2gb',available:true,regions:['nyc3']}],meta:{total:1}},'DigitalOcean has no Droplet size s-1vcpu-1gb.'],
    [{sizes:[{slug:'s-2vcpu-2gb',available:true,regions:['nyc3']}],links:{pages:{next:'https://api.digitalocean.com/v2/sizes?page=2&per_page=200'}}},
      'DigitalOcean listed only part of its Droplet sizes, without s-1vcpu-1gb. Check again later.'],
    [size({available:false}),'Droplet size s-1vcpu-1gb isn\'t available to this account for new Droplets.'],
    [size({regions:['ams3','fra1']}),'Droplet size s-1vcpu-1gb isn\'t offered in nyc3. Regions with it: ams3, fra1.'],
    [size({regions:[]}),'Droplet size s-1vcpu-1gb isn\'t offered in nyc3. No region has it right now.'],
    [size({regions:undefined}),'Droplet size s-1vcpu-1gb isn\'t offered in nyc3. No region has it right now.']
  ])refused(result(preflighting('digitalocean'),body),reason);
  const sized=result(preflighting('digitalocean'),size({}));
  assert.match(sized.step.url,/images\/ubuntu-24-04-x64$/);
  refused(result(sized,{image:{}}),'DigitalOcean did not return its Ubuntu 24.04 image. The token may lack read access to images.');
  assert.equal(result(sized,{image:{id:42}}).step.form,'confirm');
  // A refused request keeps its HTTP status. The native host replaces every refused body with one fixed code
  // (PluginCloudHttp.sanitized), so the provider's own code never reaches the worker.
  const denied=result(preflighting('digitalocean'),{code:'CLOUD_HTTP_ERROR'},403);
  assert.equal(denied.state.error.message,'Droplet region and size could not be verified (HTTP 403, CLOUD_HTTP_ERROR). Check account permissions, region, plan and Ubuntu 24.04 image.');
});

test('a refused check suggests new credentials for a refused token and another try for a busy provider',()=>{
  for(const [status,first] of [[401,'account'],[403,'account'],[429,'retry'],[500,'retry'],[503,'retry'],[404,'edit']]){
    const current=refused(result(preflighting('digitalocean'),{code:'CLOUD_HTTP_ERROR'},status),new RegExp('\\(HTTP '+status+', CLOUD_HTTP_ERROR\\)'));
    assert.equal(current.step.fields[0].default,first,String(status));
  }
  // A check that was answered but did not confirm the setting suggests changing it, even after a refused one.
  let current=refused(result(preflighting('digitalocean'),{code:'CLOUD_HTTP_ERROR'},503),/HTTP 503/);
  current=plain(worker.next(current.state,{type:'input',value:{action:'retry'}}));
  current=refused(result(current,{sizes:[{slug:'s-1vcpu-1gb',available:true,regions:['ams3']}]}),/isn't offered in nyc3/);
  assert.equal(current.step.fields[0].default,'edit');
});

test('a preflight reason only repeats identifier-like provider values, at most eight of them',()=>{
  const hostile=['<img src=x onerror=alert(1)>','a'.repeat(41),'sfo3',{name:'x'},'token with space','',null,7,'sfo3'];
  let current=refused(result(preflighting('digitalocean'),{sizes:[{slug:'s-1vcpu-1gb',available:true,regions:hostile,description:'free text must stay out'}]}),
    'Droplet size s-1vcpu-1gb isn\'t offered in nyc3. Regions with it: sfo3, 7.');
  assert.ok(!/[<>]|free text/.test(JSON.stringify(current.state)));
  const many=Array.from({length:12},(_,i)=>'r'+i);
  refused(result(preflighting('digitalocean'),{sizes:[{slug:'s-1vcpu-1gb',available:true,regions:many}]}),
    'Droplet size s-1vcpu-1gb isn\'t offered in nyc3. Regions with it: r0, r1, r2, r3, r4, r5, r6, r7 and 4 more.');
  current=refused(result(preflighting('hetzner'),{server_types:[{name:'cx23',architecture:'<b>arm</b>',locations:[]}]}),
    'Server type cx23 is not an x86 type. Choose an x86 server type.');
  // A long setting of the user's own is shortened, not dropped.
  refused(result(preflighting('hetzner',{size:'x'.repeat(60)}),{server_types:[]}),'Hetzner Cloud has no server type '+'x'.repeat(37)+'....');
  // Bodies that are not objects are an empty answer, never an exception text.
  refused(result(preflighting('hetzner'),'null'),'Hetzner Cloud has no server type cx23.');
});

const VALID={
  gcp:[{name:'e2-small'},{status:'READY'}],
  aws:[{bundles:[{bundleId:'micro_3_0',isActive:true}]},{blueprints:[{blueprintId:'ubuntu_24_04',isActive:true}]},
    {regions:[{name:'us-east-1',availabilityZones:[{zoneName:'us-east-1a'}]}]}],
  azure:[{state:'Enabled'},{value:[{name:'Standard_B1s'}]}],
  digitalocean:[{sizes:[{slug:'s-1vcpu-1gb',available:true,regions:['nyc3']}]},{image:{id:42}}],
  hetzner:[{server_types:[{name:'cx23',architecture:'x86',locations:[{id:1,name:'fsn1',available:true,recommended:true,deprecation:null}]}]},{locations:[{id:1,name:'fsn1'}]}],
  linode:[{id:'g6-nanode-1'},{id:'linode/ubuntu24.04'},{status:'ok'}],
  vultr:[{os:[{id:1743,name:'Ubuntu 24.04 LTS x64',arch:'x64'}]},{plans:[{id:'vc2-1c-1gb',locations:['ewr']}]}],
  oci:[{operatingSystem:'Canonical Ubuntu',operatingSystemVersion:'24.04'},[{shape:'VM.Standard.E4.Flex'}]],
  ovh:[[{id:'example',name:'Ubuntu 24.04'}],[{id:'example',name:'b3-8',available:true}]],
  scaleway:[{image:{arch:'x86_64',name:'Ubuntu 24.04 Noble Numbat'}},{servers:{'DEV1-S':{ncpus:2}}}]
};
test('every provider passes its read-only checks on valid answers and reaches native approval',()=>{
  for(const [provider,bodies] of Object.entries(VALID)){
    let current=preflighting(provider);
    for(const body of bodies){assert.equal(current.state.phase,'preflight',provider);current=result(current,body);}
    assert.equal(current.step.form,'confirm',provider);
    assert.equal(current.state.verified.length,bodies.length,provider);
  }
});

test('every provider names the setting its read-only check could not find',()=>{
  for(const [provider,index,body,reason] of [
    ['gcp',0,{name:'other'},'Google Cloud did not confirm machine type e2-small in zone us-central1-a.'],
    ['gcp',1,{status:'PENDING'},'Google Cloud\'s Ubuntu 24.04 image is not ready (status PENDING).'],
    ['aws',0,{bundles:[]},'Lightsail has no bundle micro_3_0 in us-east-1.'],
    ['aws',0,{bundles:[{bundleId:'micro_3_0',isActive:false}]},'Lightsail bundle micro_3_0 is no longer offered.'],
    ['aws',1,{blueprints:[{blueprintId:'ubuntu_22_04',isActive:true}]},'Lightsail does not offer the Ubuntu 24.04 blueprint in us-east-1.'],
    ['aws',2,{regions:[]},'Lightsail has no region us-east-1.'],
    ['aws',2,{regions:[{name:'us-east-1',availabilityZones:[{zoneName:'us-east-1b'},null,{zoneName:'us-east-1c'}]}]},
      'Availability zone us-east-1a is not in Lightsail region us-east-1. Zones there: us-east-1b, us-east-1c.'],
    ['azure',0,{state:'Disabled'},'The Azure subscription is Disabled, not Enabled.'],
    ['azure',0,{},'Azure did not confirm that the subscription is enabled.'],
    ['azure',1,{value:[{name:'Standard_B2s'}]},'VM size Standard_B1s isn\'t offered in eastus.'],
    ['azure',1,{value:[]},'Azure listed no VM sizes in eastus. Check the region name.'],
    ['linode',0,{id:'g6-standard-1'},'Linode has no plan g6-nanode-1.'],
    ['linode',1,{},'Linode did not return its Ubuntu 24.04 image.'],
    ['linode',2,{status:'outage'},'Linode region us-east is not available right now (status outage).'],
    ['vultr',0,{os:[{id:2284,name:'Ubuntu 24.04 LTS x64',arch:'x64'},{id:2136,name:'Debian 12 x64',arch:'x64'}]},'Vultr has no OS ID 1743. Ubuntu 24.04 x64 is OS ID 2284.'],
    ['vultr',0,{os:[{id:1743,name:'Debian 12 x64',arch:'x64'}]},'Vultr OS ID 1743 is not Ubuntu 24.04 x64.'],
    ['vultr',1,{plans:[]},'Vultr has no plan vc2-1c-1gb.'],
    ['vultr',1,{plans:[{id:'vc2-1c-1gb',locations:['ams','fra']}]},'Vultr plan vc2-1c-1gb isn\'t offered in ewr. Regions with it: ams, fra.'],
    ['oci',0,{operatingSystem:'Oracle Linux',operatingSystemVersion:'9'},'The selected Oracle Cloud image is not Ubuntu 24.04.'],
    ['oci',1,[{shape:'VM.Standard.E2.1.Micro'}],'Shape VM.Standard.E4.Flex isn\'t offered with this image in availability domain example. Shapes there: VM.Standard.E2.1.Micro.'],
    ['oci',1,{},'Shape VM.Standard.E4.Flex isn\'t offered with this image in availability domain example.'],
    ['ovh',0,[],'OVHcloud has no image with the selected ID in GRA11.'],
    ['ovh',0,[{id:'example',name:'Debian 12'}],'The selected OVHcloud image is not Ubuntu 24.04.'],
    ['ovh',1,[],'OVHcloud has no flavor with the selected ID in GRA11.'],
    ['ovh',1,[{id:'example',name:'d2-2',available:false}],'OVHcloud flavor d2-2 is sold out in GRA11 right now.'],
    ['ovh',1,[{id:'example',name:'d2 2 (sold)',available:false}],'The selected OVHcloud flavor is sold out in GRA11 right now.'],
    ['scaleway',0,{image:{arch:'arm64',name:'Ubuntu 24.04'}},'The selected Scaleway image is not for x86_64 (it is arm64).'],
    ['scaleway',0,{image:{arch:'x86_64',name:'Debian Bookworm'}},'The selected Scaleway image is not Ubuntu 24.04.'],
    ['scaleway',1,{servers:{'GP1-XS':{}}},'Scaleway has no instance type DEV1-S in fr-par-1.']
  ]){
    let current=preflighting(provider);
    for(const body of VALID[provider].slice(0,index))current=result(current,body);
    assert.equal(current.state.preflightIndex,index,provider);
    refused(result(current,body),reason);
  }
});

function soldOut(inputs){
  return refused(result(preflighting('hetzner',inputs),{server_types:[{name:'cx23',architecture:'x86',
    locations:[{id:1,name:'fsn1',available:false,recommended:false,deprecation:null},{id:2,name:'nbg1',available:true,recommended:true,deprecation:null}]}]}),
    /^Server type cx23 is sold out in fsn1 right now\. Locations with it: nbg1\.$/);
}

test('a preflight failure offers changing the settings first and nothing that acts on cloud resources',()=>{
  const current=soldOut();
  // One select field: the voice offers it as a choice.
  assert.deepEqual(current.step.fields.map(f=>[f.key,f.type,f.default]),[['action','select','edit']]);
  assert.deepEqual(current.step.fields[0].options.map(o=>[o.value,o.label]),[['edit','Change server settings'],['retry','Check again'],
    ['account','Update cloud account credentials'],['keep','Stop setup']]);
  assert.equal(current.state.interruptedPhase,'preflight');
  assert.equal(current.step.resources,undefined);
  // An answer it did not offer leaves the question as it was.
  for(const action of ['reconcile','cleanup','recreate','health']){
    const same=plain(worker.next(current.state,{type:'input',value:{action}}));
    assert.deepEqual(same.step,current.step,action);assert.equal(same.state.phase,'recovery');
  }
});

test('changing the settings re-asks each one with its current value and checks them all again',()=>{
  let current=preflighting('digitalocean',{region:'sfo3'});
  current=result(current,{sizes:[{slug:'s-1vcpu-1gb',available:true,regions:['sfo3']}]});
  assert.deepEqual(current.state.verified,['Droplet region and size']);
  current=refused(result(current,{image:{}}),/Ubuntu 24\.04 image/);
  current=plain(worker.next(current.state,{type:'input',value:{action:'edit'}}));
  assert.equal(current.state.phase,'options');
  const asked=[];
  for(;current.state.phase==='options';){
    assert.equal(current.step.fields.length,1);
    const f=current.step.fields[0];asked.push([f.key,f.default]);
    current=plain(worker.next(current.state,{type:'input',value:f.key==='region'?{region:'ams3'}:{}}));
  }
  assert.deepEqual(asked,[['region','sfo3'],['size','s-1vcpu-1gb'],['sshCidr','198.51.100.0/24']]);
  assert.equal(current.state.inputs.region,'ams3');assert.equal(current.state.inputs.sshCidr,'198.51.100.0/24');
  assert.equal(current.state.preflightIndex,0);assert.deepEqual(current.state.verified,[]);
  assert.match(current.step.url,/\/v2\/sizes\?/);
  current=result(current,{sizes:[{slug:'s-1vcpu-1gb',available:true,regions:['ams3']}]});
  current=result(current,{image:{id:42}});
  assert.equal(current.step.form,'confirm');
  assert.deepEqual(current.state.verified,['Droplet region and size','Ubuntu image']);
  assert.equal(current.step.summary.settings.region,'ams3');
});

test('checking again repeats only the failed check and new credentials resume it',()=>{
  let current=preflighting('hetzner');
  current=result(current,{server_types:[{name:'cx23',architecture:'x86',locations:[{id:1,name:'fsn1',available:true}]}]});
  current=refused(result(current,{locations:[]}),'Hetzner Cloud has no location fsn1.');
  const failed=current.state;
  current=plain(worker.next(failed,{type:'input',value:{action:'retry'}}));
  assert.equal(current.step.id,failed.deploymentId+'-preflight-1');assert.match(current.step.url,/locations\?name=fsn1$/);
  current=result(current,{locations:[{id:1,name:'fsn1'}]});
  assert.equal(current.step.form,'confirm');
  assert.deepEqual(current.state.verified,['Server type in selected location','Location']);
  // Other credentials may reach another account or project: every check runs again, none counts as verified.
  current=plain(worker.next(failed,{type:'input',value:{action:'account'}}));
  assert.equal(current.step.form,'credential');
  current=plain(worker.next(current.state,{type:'input',value:{credentialRef:'updated-ref'}}));
  assert.equal(current.step.id,failed.deploymentId+'-preflight-0');assert.equal(current.step.auth.credentialRef,'updated-ref');
  assert.deepEqual(current.state.verified,[]);
});

test('stopping after a preflight failure ends the setup as stopped, with nothing to clean up',()=>{
  const current=plain(worker.next(soldOut().state,{type:'input',value:{action:'keep'}}));
  assert.equal(current.step.kind,'complete');assert.equal(current.state.phase,'cancelled');
  assert.equal(current.step.result.status,'cancelled');assert.deepEqual(current.state.resources,{});
});

test('failures after resources exist, or outside the checks, keep the cloud recovery',()=>{
  const cloud=['reconcile','retry','edit','account','cleanup','keep'];
  const initial=state('digitalocean');initial.resources.key={id:11,owned:true,status:'created'};initial.index=1;
  const created=result(plain(worker.next(initial,{type:'resume'})),{id:'forbidden',message:'denied'},403);
  assert.equal(created.step.title,'Setup needs attention');assert.equal(created.step.fields[0].default,'reconcile');
  assert.deepEqual(created.step.fields[0].options.map(o=>o.value),cloud);
  assert.equal(created.step.message,created.state.error.message);assert.ok(created.step.resources.key);
  // A preflight snapshot that somehow holds an owned resource is not treated as untouched.
  const held=result(preflighting('hetzner',{},0,{resources:{server:{id:33,owned:true,status:'created'}}}),{server_types:[]});
  assert.equal(held.step.title,'Setup needs attention');assert.deepEqual(held.step.fields[0].options.map(o=>o.value),cloud);
});

test('a setting heard wrong is asked again and never brings back the cloud recovery',()=>{
  // The recorded run: cx23 sold out in fsn1, "Change server settings", and the location heard as "nbg 1".
  // Its catalog read was refused (it is asked from the list otherwise), so the location is typed, as in 1.0.4.
  let current=soldOut();
  current=plain(worker.next(current.state,{type:'input',value:{action:'edit'}}));
  assert.equal(current.state.phase,'catalog');
  current=result(current,{code:'CLOUD_HTTP_ERROR'},503);
  const where='Where should the VPN server run?';
  assert.equal(current.step.title,where);assert.equal(current.step.fields[0].label,'Location');assert.equal(current.step.fields[0].options,undefined);
  for(const [answer,reason] of [[{region:'nbg 1'},'Use only letters, digits, dots, underscores, colons and hyphens, with no spaces.'],
    [{region:'   '},'This setting is required.'],[{region:'nbg1;rm'},'Use only letters, digits, dots, underscores, colons and hyphens, with no spaces.']]){
    current=plain(worker.next(current.state,{type:'input',value:answer}));
    assert.equal(current.state.phase,'options');assert.equal(current.step.form,'instance');assert.equal(current.step.title,where);
    assert.equal(current.step.message,reason);assert.equal(current.step.error.message,reason);
    assert.equal(current.step.fields[0].default,'fsn1');assert.equal(current.state.inputs.region,'fsn1');
    assert.equal(current.state.interruptedPhase,'preflight');
  }
  current=plain(worker.next(current.state,{type:'input',value:{region:'nbg1'}}));
  assert.equal(current.step.title,'Which server type should it use?');assert.equal(current.step.error,undefined);
  assert.equal(current.step.message,'Which server type should it use? Enter an x86 Hetzner server type, such as cx23.');
  current=plain(worker.next(current.state,{type:'input',value:{}}));
  current=plain(worker.next(current.state,{type:'input',value:{sshCidr:'203.0.113.0/33'}}));
  assert.equal(current.step.fields[0].key,'sshCidr');assert.match(current.step.message,/IPv4 range/);
  current=plain(worker.next(current.state,{type:'input',value:{}}));
  assert.equal(current.state.phase,'preflight');assert.equal(current.state.inputs.region,'nbg1');
  assert.match(current.step.url,/server_types\?name=cx23$/);
});

test('a refused recovery answer keeps the phase being recovered',()=>{
  let current=result(plain(worker.next(state('digitalocean'),{type:'resume'})),{},503);
  assert.equal(current.state.interruptedPhase,'provision');
  current=plain(worker.next(current.state,{type:'input',value:{action:'recreate'}}));
  assert.equal(current.step.form,'recovery');assert.equal(current.state.error.message,'Reconcile the missing resource first');
  assert.equal(current.state.interruptedPhase,'provision');
  current=plain(worker.next(current.state,{type:'input',value:{action:'retry'}}));
  assert.equal(current.step.method,'GET');assert.equal(current.state.httpStage,'reconcile');
});

// As VPN Setup 1.0.0 left a delete that Hetzner refused (firewall still in use) and the user then stopped: its server and
// primary IPv4 are gone, its firewall and SSH key remain, and it still holds its recovery question.
function stoppedDelete(){
  const prior=state('hetzner');
  Object.assign(prior,{deploymentId:'vpn-demo',name:'mssh-vpndemo',operation:'delete',phase:'recovery',interruptedPhase:'cleanup',index:1,
    httpStage:'delete',attempt:0,host:'203.0.113.10',pending:'vpn-demo-recovery',clientSequence:2,profileId:'p2',lastClientId:'2',
    clients:[{clientId:'1',profileId:'p1'},{clientId:'2',profileId:'p2'}],creationAbsent:true,
    error:{code:'workflow_failed',message:'Cloud firewall deletion failed (HTTP 422, resource_in_use: firewall with ID 22 is still in use). Remaining resources are retained for retry.'},
    resources:{key:{provider:'hetzner',type:'key',id:11,name:'mssh-vpndemo',owned:true,status:'created'},
      firewall:{provider:'hetzner',type:'firewall',id:22,name:'mssh-vpndemo',owned:true,status:'created'},
      address:{provider:'hetzner',type:'address',id:44,name:'mssh-vpndemo',host:'203.0.113.10',owned:true,status:'deleted'},
      server:{provider:'hetzner',type:'server',id:33,name:'mssh-vpndemo',host:'203.0.113.10',primaryIpId:44,owned:true,status:'deleted'}}});
  return prior;
}
const inUse={error:{code:'resource_in_use',message:'firewall with ID 22 is still in use'}};

test('a new delete after a stopped one deletes only what remains, retries a firewall in use and ends deleted',()=>{
  let current=lifecycle('delete',stoppedDelete(),{deploymentId:'vpn-demo'});
  assert.equal(current.step.form,'confirm');assert.equal(current.step.destructive,true);
  assert.deepEqual(Object.fromEntries(Object.entries(current.step.summary.resources).map(([name,value])=>[name,value.status])),
    {key:'created',firewall:'created',address:'deleted',server:'deleted'});
  // Nothing of the stopped job's progress carries over: no stale error, phase or recreation offer.
  for(const name of ['interruptedPhase','httpStage','creationAbsent'])assert.equal(current.state[name],undefined,name);
  assert.equal(current.state.error,null);
  current=plain(worker.next(current.state,{type:'input',value:{approved:true}}));
  const urls=[];
  const send=(body,status)=>{urls.push(current.step.method+' '+current.step.url);current=result(current,body,status);};
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/\/firewalls\/22$/);
  for(let count=1;count<=2;count++){
    send(inUse,422);
    assert.equal(current.step.kind,'delay');assert.equal(current.state.resources.firewall.status,'created');
    current=result(current,{});
    assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/\/firewalls\/22$/);
  }
  send({},204);
  assert.equal(current.step.kind,'delay');current=result(current,{});
  assert.equal(current.step.method,'GET');assert.match(current.step.url,/\/firewalls\/22$/);
  send({error:{code:'not_found'}},404);
  assert.equal(current.state.resources.firewall.status,'deleted');
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/\/ssh_keys\/11$/);
  send({},204);current=result(current,{});
  assert.equal(current.step.method,'GET');assert.match(current.step.url,/\/ssh_keys\/11$/);
  send({},404);
  // Its VPN profiles and saved server go as in any delete.
  assert.equal(current.step.kind,'vpn.cleanup');assert.equal(current.step.deploymentId,'vpn-demo');
  current=result(current,{});
  assert.equal(current.step.kind,'complete');assert.equal(current.state.phase,'deleted');
  assert.ok(Object.values(current.state.resources).every(value=>value.status==='deleted'));
  assert.deepEqual(urls,['DELETE https://api.hetzner.cloud/v1/firewalls/22','DELETE https://api.hetzner.cloud/v1/firewalls/22',
    'DELETE https://api.hetzner.cloud/v1/firewalls/22','GET https://api.hetzner.cloud/v1/firewalls/22',
    'DELETE https://api.hetzner.cloud/v1/ssh_keys/11','GET https://api.hetzner.cloud/v1/ssh_keys/11'],'the server and its IPv4 are never asked for again');
});

test('a new delete whose snapshot still lists resources the cloud already removed treats 404 as gone',()=>{
  const prior=stoppedDelete();prior.resources.server.status='created';prior.resources.address.status='created';
  let current=plain(worker.next(lifecycle('delete',prior).state,{type:'input',value:{approved:true}}));
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/\/servers\/33$/);
  current=result(current,{error:{code:'not_found'}},404);
  assert.equal(current.state.resources.server.status,'deleted');
  // The primary IPv4 is read before any DELETE; a 404 there confirms it is gone without one.
  assert.equal(current.step.method,'GET');assert.match(current.step.url,/\/primary_ips\/44$/);
  current=result(current,{error:{code:'not_found'}},404);
  assert.equal(current.state.resources.address.status,'deleted');
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/\/firewalls\/22$/);
});

test('declining the new delete keeps every receipt, and a refused deletion in it never offers recreation',()=>{
  const declined=plain(worker.next(lifecycle('delete',stoppedDelete()).state,{type:'input',value:{approved:false}}));
  assert.equal(declined.step.kind,'complete');assert.equal(declined.state.phase,'cancelled');
  assert.equal(declined.state.resources.firewall.status,'created');assert.equal(declined.state.resources.server.status,'deleted');
  let current=plain(worker.next(lifecycle('delete',stoppedDelete()).state,{type:'input',value:{approved:true}}));
  current=result(current,{error:{code:'forbidden',message:'token lacks write access'}},403);
  assert.equal(current.step.form,'recovery');assert.equal(current.state.interruptedPhase,'cleanup');
  assert.ok(!current.step.fields[0].options.some(option=>option.value==='recreate'));
  current=plain(worker.next(current.state,{type:'input',value:{action:'retry'}}));
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/\/firewalls\/22$/);
});

test('a new Scaleway delete after its server went deletes the disks it left before the rest',()=>{
  const prior=state('scaleway');Object.assign(prior,{phase:'recovery',interruptedPhase:'cleanupExtra',host:'203.0.113.20',
    extraCleanup:[{id:'stale',type:'volume',url:'https://api.scaleway.com/instance/v1/zones/fr-par-1/volumes/stale'}],
    resources:{key:{provider:'scaleway',type:'key',id:'key-id',owned:true,status:'created'},
      server:{provider:'scaleway',type:'server',id:'server-id',owned:true,status:'deleted',volumes:{'0':{id:'boot'}}},
      'volume_boot':{provider:'scaleway',type:'volume',id:'boot',owned:true,status:'created'},
      'volume_gone':{provider:'scaleway',type:'volume',id:'gone',owned:true,status:'deleted'}}});
  let current=plain(worker.next(lifecycle('delete',prior).state,{type:'input',value:{approved:true}}));
  assert.equal(current.state.phase,'cleanupExtra');
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/\/volumes\/boot$/);
  current=result(current,{},404);
  assert.equal(current.state.resources.volume_boot.status,'deleted');
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/ssh-keys\/key-id$/);
});

// On a phone the native host replaces every refused body with {code:'CLOUD_HTTP_ERROR'}: Hetzner's own code never arrives.
const opaque={code:'CLOUD_HTTP_ERROR'};

test('Hetzner busy deletions still retry when the host passes only its opaque code',()=>{
  for(const status of [422,409,423]){
    let current=result(hetznerFirewallCleanup(),opaque,status);
    assert.equal(current.step.kind,'delay',String(status));assert.equal(current.state.resources.firewall.status,'created');
    current=result(current,{});
    assert.equal(current.step.method,'DELETE',String(status));assert.match(current.step.url,/firewalls\/22$/);
  }
  // Other refusals, the primary IPv4 and other providers pause as before.
  assert.equal(result(hetznerFirewallCleanup(),opaque,403).step.form,'recovery');
  assert.equal(result(result(hetznerAddressCleanup(),{primary_ip:{id:44,assignee_id:null}}),opaque,422).step.form,'recovery');
  const prior=state('digitalocean');prior.phase='cleanup';prior.index=3;prior.httpStage='delete';
  prior.resources.firewall={id:'fw-id',owned:true,status:'created'};
  assert.equal(result(plain(worker.next(prior,{type:'resume'})),opaque,422).step.form,'recovery');
  // The recording's delete, as the phone answers it: the firewall is deleted after its waits, then the key.
  let current=plain(worker.next(lifecycle('delete',stoppedDelete()).state,{type:'input',value:{approved:true}}));
  current=result(current,opaque,422);assert.equal(current.step.kind,'delay');
  current=result(result(current,{}),{},204);current=result(current,{});
  current=result(current,opaque,404);assert.equal(current.state.resources.firewall.status,'deleted');
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/ssh_keys\/11$/);
});

test('a refused deletion checks the cloud first by default, then sends it again only while the resource is there',()=>{
  let current=plain(worker.next(lifecycle('delete',stoppedDelete()).state,{type:'input',value:{approved:true}}));
  current=result(current,opaque,403);
  assert.equal(current.step.form,'recovery');assert.equal(current.step.title,'Delete needs attention');
  const action=current.step.fields[0];
  assert.equal(action.default,'reconcile');
  assert.equal(action.options.find(option=>option.value==='reconcile').label,'Check the cloud, then delete what remains');
  assert.equal(action.options.find(option=>option.value==='retry').label,'Retry the deletion');
  const paused=current.state;
  current=plain(worker.next(paused,{type:'input',value:{action:action.default}}));
  assert.equal(current.step.method,'GET');assert.match(current.step.url,/firewalls\/22$/);
  // Still there: its DELETE goes again (VPN Setup 1.0.4 before this only read it until the polling limit).
  current=result(current,{firewall:{id:22,name:'mssh-vpndemo'}});
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/firewalls\/22$/);
  // Gone meanwhile: nothing is sent again.
  current=result(plain(worker.next(paused,{type:'input',value:{action:'reconcile'}})),{error:{code:'not_found'}},404);
  assert.equal(current.state.resources.firewall.status,'deleted');assert.match(current.step.url,/ssh_keys\/11$/);
  // Retry sends it at once.
  current=plain(worker.next(paused,{type:'input',value:{action:'retry'}}));
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/firewalls\/22$/);
  // A setup cut off while creating still checks the cloud first.
  const setup=result(plain(worker.next(state('linode'),{type:'resume'})),opaque,503);
  assert.equal(setup.step.title,'Setup needs attention');assert.equal(setup.step.fields[0].default,'reconcile');
  assert.equal(setup.step.fields[0].options.find(option=>option.value==='retry').label,'Retry reconciliation');
});

test('a sent create is noted for the page, through any recovery, and a new operation starts without the note',()=>{
  let current=plain(worker.next(state('linode'),{type:'resume'}));
  assert.equal(current.step.method,'POST');assert.equal(current.state.creationSent,true);
  current=result(current,opaque,503);
  current=plain(worker.next(current.state,{type:'input',value:{action:'account'}}));
  assert.equal(current.state.phase,'credential');assert.equal(current.state.creationSent,true);
  const checks=plain(worker.next(Object.assign(state('hetzner'),{phase:'preflight',preflightIndex:0}),{type:'resume'}));
  assert.equal(checks.state.creationSent,undefined,'a read-only check creates nothing');
  const ready=Object.assign(deployed(),{creationSent:true});
  assert.equal(lifecycle('health',ready).state.creationSent,undefined);
});

// A VPN set up through every create, then deleted with every cloud answer a 404: each transition's receipt statuses.
function deleteAll(provider){
  let current=plain(worker.next(state(provider),{type:'resume'}));
  for(let i=0;i<80&&current.step.kind!=='ssh';i++)current=result(current,fixture(provider,worker.graph(current.state)[current.state.index].key,current.state));
  current=result(result(current,{clientId:'7',configRef:'vault-config-ref'}),{profileId:'native-profile'});
  assert.equal(current.state.phase,'ready',provider);
  current=plain(worker.next(lifecycle('delete',current.state).state,{type:'input',value:{approved:true}}));
  const seen=[];
  for(let i=0;i<80&&['http','delay'].includes(current.step.kind);i++){
    current=current.step.kind==='delay'?result(current,{}):result(current,{},404);
    seen.push(Object.fromEntries(Object.entries(current.state.resources).map(([name,value])=>[name,value.status])));
  }
  assert.equal(current.step.kind,'vpn.cleanup',provider);
  return seen;
}

test('receipts with no deletion of their own count as deleted as soon as what holds them is',()=>{
  for(const [provider,parent,children] of [['vultr','firewall',['sshRule','vpnRule']],['scaleway','firewall',['sshRule','vpnRule']],
    ['oci','server',['vnic','privateIp']],['aws','server',['firewall']],['azure','group',['firewall','network','address','nic','server']]]){
    const seen=deleteAll(provider),at=seen.findIndex(statuses=>statuses[parent]==='deleted');
    assert.ok(at>=0,provider);
    for(const child of children){
      assert.equal(seen[at][child],'deleted',provider+' '+child+' with its '+parent);
      if(at)assert.equal(seen[at-1][child],'created',provider+' '+child+' not before its '+parent);
    }
  }
  // Vultr's server going first leaves the rules of its firewall group, which still exists.
  const vultr=deleteAll('vultr'),server=vultr.findIndex(statuses=>statuses.server==='deleted');
  assert.equal(vultr[server].sshRule,'created');assert.equal(vultr[server].firewall,'created');
});

// Second review, F1: a DigitalOcean setup whose key was created (201) and whose droplet POST got a 503.
function cutOffDroplet(){
  let current=plain(worker.next(state('digitalocean'),{type:'resume'}));
  current=result(current,fixture('digitalocean','key',current.state),201);
  current=result(current,fixture('digitalocean','key',current.state));
  assert.equal(current.step.method,'POST');assert.match(current.step.url,/\/droplets$/);
  const droplet=current.step.id;
  return {current:result(current,opaque,503),droplet};
}
const droplets='https://api.digitalocean.com/v2/droplets?tag_name=mssh-testdeployment123';
const found={droplets:[{id:22,name:'mssh-testdeployment123',status:'active',networks:{v4:[{type:'public',ip_address:'192.0.2.22'}]}}],meta:{total:1}};

test('a create with no answer is noted until a read settles it, and a 2xx answer needs none',()=>{
  let {current,droplet}=cutOffDroplet();
  assert.deepEqual(plain(current.state.unanswered),{[droplet]:'server'},'the 201 key is not noted');
  assert.equal(current.state.reconciled,undefined);
  // The recovery's own lookup settles it: absent here, so it names that read and offers a reviewed new attempt.
  current=plain(worker.next(current.state,{type:'input',value:{action:'reconcile'}}));
  assert.equal(current.step.url,'https://api.digitalocean.com/v2/droplets?tag_name=mssh-testdeployment123');
  const lookup=current.step.id;
  current=result(current,{droplets:[],meta:{total:0}});
  assert.equal(current.state.creationAbsent,true);
  assert.deepEqual(plain(current.state.unanswered),{});assert.deepEqual(plain(current.state.reconciled),{[droplet]:lookup});
  // Sent again under the same id, it is noted again and its earlier lookup no longer stands for it.
  current=plain(worker.next(current.state,{type:'input',value:{action:'recreate'}}));
  current=plain(worker.next(current.state,{type:'input',value:{approved:true}}));
  current=result(current,{droplets:[],meta:{total:0}});
  assert.equal(current.step.method,'POST');
  assert.deepEqual(plain(current.state.unanswered),{[current.step.id]:'server'});
  assert.equal(current.state.reconciled[current.step.id],undefined);
  // A read the runner made in place of a cut-off POST names the POST's own step.
  let recovered=plain(worker.next(state('digitalocean'),{type:'resume'}));
  const key=recovered.step.id;
  recovered=result(recovered,{ssh_keys:[{id:11,name:recovered.state.name}]},200,{recovered:true});
  assert.deepEqual(plain(recovered.state.reconciled),{[key]:key});assert.equal(recovered.state.unanswered[key],undefined);
  // Ambiguous or partial lookups settle nothing.
  for(const body of [{droplets:[found.droplets[0],found.droplets[0]],meta:{total:2}},{droplets:[],meta:{total:5}}]){
    const again=result(plain(worker.next(cutOffDroplet().current.state,{type:'input',value:{action:'reconcile'}})),body);
    assert.equal(again.step.form,'recovery');assert.equal(Object.keys(again.state.unanswered).length,1);assert.equal(again.state.reconciled,undefined);
  }
  // Read-only "creates" (OCI's network interface lookups) are never noted.
  const oci=plain(worker.next(Object.assign(state('oci'),{index:6,resources:{server:{id:'server-id',owned:true,status:'created'}}}),{type:'resume'}));
  assert.equal(oci.step.method,'GET');assert.equal(oci.state.unanswered,undefined);
});

test('a delete looks up a create that got no answer before deleting anything, and names that read for it',()=>{
  let {current,droplet}=cutOffDroplet();
  current=plain(worker.next(current.state,{type:'input',value:{action:'cleanup'}}));
  assert.equal(current.step.form,'confirm');
  const confirm=current.state;
  current=plain(worker.next(confirm,{type:'input',value:{approved:true}}));
  assert.equal(current.state.phase,'cleanupFind');
  assert.equal(current.step.method,'GET');assert.equal(current.step.url,droplets);
  const lookup=current.step.id;
  current=result(current,{droplets:[],meta:{total:0}});
  assert.deepEqual(plain(current.state.reconciled),{[droplet]:lookup});assert.deepEqual(plain(current.state.unanswered),{});
  // None found: only then is the key deleted, and the setup ends deleted.
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/account\/keys\/11$/);
  current=result(result(result(current,{},204),{}),{},404);
  assert.equal(current.step.kind,'vpn.cleanup');
  current=result(current,{});
  assert.equal(current.state.phase,'deleted');assert.deepEqual(plain(current.state.reconciled),{[droplet]:lookup});
  // Found: it gets a receipt and is deleted first, then the key.
  current=result(plain(worker.next(confirm,{type:'input',value:{approved:true}})),found);
  assert.equal(current.state.resources.server.id,22);assert.equal(current.state.resources.server.owned,true);
  assert.deepEqual(plain(current.state.reconciled),{[droplet]:lookup});
  assert.equal(current.step.method,'DELETE');assert.match(current.step.url,/droplets\/22$/);
  current=result(result(result(current,{},204),{}),{},404);
  assert.equal(current.state.resources.server.status,'deleted');assert.match(current.step.url,/account\/keys\/11$/);
  // A lookup that fails deletes nothing yet; checking again looks it up again.
  current=result(plain(worker.next(confirm,{type:'input',value:{approved:true}})),opaque,403);
  assert.equal(current.step.form,'recovery');assert.equal(current.state.interruptedPhase,'cleanupFind');
  assert.match(current.state.error.message,/^Could not check whether an interrupted server creation made one \(HTTP 403, CLOUD_HTTP_ERROR\)\. Nothing was deleted yet\.$/);
  assert.equal(current.state.resources.key.status,'created');
  current=plain(worker.next(current.state,{type:'input',value:{action:current.step.fields[0].default}}));
  assert.equal(current.step.method,'GET');assert.equal(current.step.url,droplets);
});

test('a separate delete looks up what the stopped setup, or the host for an older one, lists as unsettled',()=>{
  let {current,droplet}=cutOffDroplet();
  const kept=plain(worker.next(current.state,{type:'input',value:{action:'keep'}})).state;
  current=lifecycle('delete',kept);
  assert.deepEqual(plain(current.state.unanswered),{[droplet]:'server'});
  current=plain(worker.next(current.state,{type:'input',value:{approved:true}}));
  assert.equal(current.step.url,droplets);
  // VPN Setup 1.0.3 noted nothing: bridge 1.5.0 lists the journal's creates nothing settled, matched here by their request.
  const older=Object.assign(plain(kept),{unanswered:undefined});
  const unresolved=[{id:'old-post',method:'POST',url:'https://api.digitalocean.com/v2/droplets'},
    {id:'other-url',method:'POST',url:'https://api.digitalocean.com/v2/volumes'},{id:'other-method',method:'PUT',url:'https://api.digitalocean.com/v2/droplets'},
    {id:'aws-target',method:'POST',url:'https://api.digitalocean.com/v2/droplets',target:'Lightsail_20161128.CreateInstances'},{id:7,method:'POST',url:'https://api.digitalocean.com/v2/droplets'}];
  current=lifecycle('delete',older,{unresolved});
  assert.deepEqual(plain(current.state.unanswered),{'old-post':'server'});
  current=plain(worker.next(current.state,{type:'input',value:{approved:true}}));
  assert.equal(current.step.url,droplets);const lookup=current.step.id;
  current=result(current,{droplets:[],meta:{total:0}});
  assert.deepEqual(plain(current.state.reconciled),{'old-post':lookup});
  // Lightsail requests share one URL: the action tells them apart.
  const aws=state('aws');aws.phase='ready';aws.resources={key:{provider:'aws',type:'key',id:aws.name,owned:true,status:'created'}};
  const instances=lifecycle('delete',aws,{unresolved:[{id:'create-vm',method:'POST',url:'https://lightsail.us-east-1.amazonaws.com/',target:'Lightsail_20161128.CreateInstances'},
    {id:'attach',method:'POST',url:'https://lightsail.us-east-1.amazonaws.com/',target:'Lightsail_20161128.AttachStaticIp'}]});
  assert.deepEqual(plain(instances.state.unanswered),{'create-vm':'server',attach:'attachment'});
  // A setup on the user's own server has nothing to look up, and other lifecycle operations ignore the list.
  const manual=Object.assign(deployed(),{provider:'existing',mode:'manual'});
  assert.equal(lifecycle('delete',manual,{unresolved}).state.unanswered,undefined);
  assert.equal(lifecycle('health',Object.assign(deployed(),{provider:'digitalocean'}),{unresolved}).state.unanswered,undefined);
});

test('a lookup counts a change on another resource as made only once it took effect',()=>{
  const aws=state('aws');aws.phase='ready';aws.host='192.0.2.30';
  aws.resources={key:{provider:'aws',type:'key',id:aws.name,owned:true,status:'created'},address:{provider:'aws',type:'address',id:aws.name,owned:true,status:'created'},
    server:{provider:'aws',type:'server',id:aws.name,owned:true,status:'created'},firewall:{provider:'aws',type:'firewall',id:aws.name,owned:true,status:'created'}};
  aws.unanswered={attach:'attachment'};
  const start=plain(worker.next(lifecycle('delete',aws).state,{type:'input',value:{approved:true}}));
  assert.equal(start.step.headers['X-Amz-Target'],'Lightsail_20161128.GetStaticIp');
  // Not attached: nothing to detach.
  let current=result(start,{staticIp:{name:aws.name,ipAddress:'192.0.2.30',isAttached:false}});
  assert.equal(current.state.resources.attachment,undefined);assert.equal(current.state.reconciled.attach,start.step.id);
  assert.equal(current.step.headers['X-Amz-Target'],'Lightsail_20161128.DeleteInstance');
  // Attached: its receipt makes the delete detach it first.
  current=result(start,{staticIp:{name:aws.name,ipAddress:'192.0.2.30',attachedTo:aws.name,isAttached:true}});
  assert.equal(current.state.resources.attachment.status,'created');
  assert.equal(current.step.headers['X-Amz-Target'],'Lightsail_20161128.DetachStaticIp');
});

const protectedServer=()=>{const prior=stoppedDelete();prior.resources.server.status='created';prior.resources.address.status='created';return prior;};

test('Hetzner opaque refusals wait only a few minutes and say what may hold them, while its own in-use code waits the polling limit',()=>{
  let current=hetznerFirewallCleanup(),deletes=0,waited=0;
  while(current.step.kind!=='input'){
    if(current.step.kind==='delay'){waited+=current.step.delayMs;current=result(current,{});continue;}
    assert.equal(current.step.method,'DELETE');current=result(current,opaque,422);deletes++;
    assert.ok(deletes<=61);
  }
  assert.equal(deletes,9);assert.ok(waited<=4*60000&&waited>=2*60000,String(waited));
  assert.equal(current.state.error.message,'Hetzner Cloud kept refusing to delete the firewall (HTTP 422, CLOUD_HTTP_ERROR). It may still be attached to something else, or have delete protection on: check it in the Hetzner Cloud Console, then retry. Remaining resources are retained for retry.');
  assert.doesNotMatch(current.state.error.message,/stayed in use/);
  assert.equal(current.state.resources.firewall.status,'created');
  // Bridge 1.5.0 passes Hetzner's own code: in use, locked or conflicting keeps the full polling limit.
  for(const [status,code] of [[422,'resource_in_use'],[423,'locked'],[409,'conflict']]){
    let busy=hetznerFirewallCleanup(),sent=0;
    while(busy.step.kind!=='input'){busy=busy.step.kind==='delay'?result(busy,{}):(sent++,result(busy,{code:'CLOUD_HTTP_ERROR',error:{code}},status));}
    assert.equal(sent,61,code);assert.match(busy.state.error.message,/^Cloud firewall stayed in use past the polling limit/);
  }
  // Its other codes pause at once: a protected server says how to go on, an invalid request is no wait.
  current=result(plain(worker.next(lifecycle('delete',protectedServer()).state,{type:'input',value:{approved:true}})),{code:'CLOUD_HTTP_ERROR',error:{code:'protected'}},423);
  assert.equal(current.step.form,'recovery');
  assert.equal(current.state.error.message,'Cloud server deletion failed (HTTP 423, protected). Its delete protection is on: turn it off in the cloud console, then retry. Remaining resources are retained for retry.');
  assert.equal(result(hetznerFirewallCleanup(),{code:'CLOUD_HTTP_ERROR',error:{code:'invalid_input'}},422).step.form,'recovery');
  // An opaque refusal on an older host still gets its short wait.
  assert.equal(result(plain(worker.next(lifecycle('delete',protectedServer()).state,{type:'input',value:{approved:true}})),opaque,423).step.kind,'delay');
});

// The removal went out and was taken; the read after it was cut off.
function takenThenCut(provider,resources,inputs){
  const prior=Object.assign(state(provider),{phase:'ready',host:'192.0.2.40',resources});
  Object.assign(prior.inputs,inputs||{});
  let current=plain(worker.next(lifecycle('delete',prior).state,{type:'input',value:{approved:true}}));
  const removal=current.step;
  current=result(current,{},200);
  assert.equal(current.step.kind,'delay');current=result(current,{});
  current=plain(worker.next(current.state,{type:'error',requestId:current.step.id,code:'operation_interrupted'}));
  assert.equal(current.step.form,'recovery');assert.equal(current.step.fields[0].default,'reconcile');
  return {current,removal};
}

test('after a taken removal the default checks the cloud first and sends a POST action again only while it is still needed',()=>{
  const n='mssh-testdeployment123';
  const aws={key:{provider:'aws',type:'key',id:n,owned:true,status:'created'},address:{provider:'aws',type:'address',id:n,owned:true,status:'created'},
    server:{provider:'aws',type:'server',id:n,owned:true,status:'created'},firewall:{provider:'aws',type:'firewall',id:n,owned:true,status:'created'},
    attachment:{provider:'aws',type:'attachment',id:n,owned:true,status:'created'}};
  let {current,removal}=takenThenCut('aws',aws);
  assert.equal(removal.headers['X-Amz-Target'],'Lightsail_20161128.DetachStaticIp');
  const paused=current.state;
  current=plain(worker.next(paused,{type:'input',value:{action:'reconcile'}}));
  assert.equal(current.step.headers['X-Amz-Target'],'Lightsail_20161128.GetStaticIp');
  // Detached: never sent again, the instance is next.
  let next=result(current,{staticIp:{name:n,isAttached:false}});
  assert.equal(next.state.resources.attachment.status,'deleted');assert.equal(next.step.headers['X-Amz-Target'],'Lightsail_20161128.DeleteInstance');
  // Still attached: the detach goes again.
  next=result(current,{staticIp:{name:n,isAttached:true,attachedTo:n}});
  assert.equal(next.step.headers['X-Amz-Target'],'Lightsail_20161128.DetachStaticIp');
  // Scaleway's power-off: on its way, it is waited for; stopped, done; still running, sent again.
  const scaleway={key:{provider:'scaleway',type:'key',id:'k',owned:true,status:'created'},server:{provider:'scaleway',type:'server',id:'s',owned:true,status:'created'},
    power:{provider:'scaleway',type:'power',id:'s',owned:true,status:'created'}};
  ({current,removal}=takenThenCut('scaleway',scaleway));
  assert.deepEqual(plain(removal.body),{action:'poweroff'});
  current=plain(worker.next(current.state,{type:'input',value:{action:'reconcile'}}));
  assert.equal(current.step.method,'GET');assert.match(current.step.url,/servers\/s$/);
  assert.equal(result(current,{server:{id:'s',state:'stopping'}}).step.kind,'delay');
  next=result(current,{server:{id:'s',state:'stopped'}});
  assert.equal(next.state.resources.power.status,'deleted');assert.equal(next.step.method,'DELETE');assert.match(next.step.url,/servers\/s$/);
  next=result(current,{server:{id:'s',state:'running'}});
  assert.equal(next.step.method,'POST');assert.deepEqual(plain(next.step.body),{action:'poweroff'});
  // A resource the provider is deleting already is waited for rather than deleted again.
  const deleting=plain(worker.next(paused,{type:'input',value:{action:'reconcile'}}));
  for(const body of [{lifecycleState:'TERMINATING'},{properties:{provisioningState:'Deleting'}},{server:{status:'deleting'}},{instance:{state:{name:'shutting-down'}}}])
    assert.equal(result(deleting,body).step.kind,'delay',JSON.stringify(body));
  // Scaleway disks left after their server are deleted again if still there.
  const disk=state('scaleway');Object.assign(disk,{phase:'recovery',interruptedPhase:'cleanupExtra',httpStage:'deleteRead',
    extraCleanup:[{id:'volume-id',type:'volume',url:'https://api.scaleway.com/instance/v1/zones/fr-par-1/volumes/volume-id'}]});
  disk.resources['volume_volume-id']={id:'volume-id',provider:'scaleway',type:'volume',owned:true,status:'created'};
  current=plain(worker.next(disk,{type:'input',value:{action:'reconcile'}}));
  assert.equal(current.step.method,'GET');
  assert.equal(result(current,{volume:{id:'volume-id'}}).step.method,'DELETE');
});

// The phone's host (bridge 1.5.0) accepts a read named in reconciled only if it is read-only, on the create's origin, with a path
// equal to, under or above the create's (PluginWorkflowStore.unresolved). Every lookup this worker names must pass.
const nativeReadOnly=req=>['GET','HEAD'].includes(req.method||'GET')||req.method==='POST'&&get(req,'auth.scheme')==='aws'&&/^Lightsail_20161128\.Get[A-Za-z0-9]+$/.test(get(req,'headers.X-Amz-Target')||'');
const get=(value,path)=>path.split('.').reduce((at,key)=>at==null?undefined:at[key],value);
function sameApi(create,read){
  const a=new URL(create.url),b=new URL(read.url),trim=p=>p.replace(/\/+$/,'');
  if(a.protocol!==b.protocol||a.hostname.toLowerCase()!==b.hostname.toLowerCase()||a.port!==b.port)return false;
  const x=trim(a.pathname),y=trim(b.pathname);
  return x===y||y.startsWith(x+'/')||x.startsWith(y+'/');
}
test('every lookup the worker names for a create is one the phone host accepts',()=>{
  for(const provider of Object.keys(worker.providers).filter(p=>p!=='existing')){
    const s=state(provider);
    for(const op of worker.graph(s))s.resources[op.key]={provider,type:op.key,id:op.key+'-id',name:s.name,host:'192.0.2.9',owned:true,status:'created'};
    for(const op of worker.graph(s)){
      const create=op.create;
      if(!create||['GET','HEAD'].includes(create.method)||create.readOnly)continue;
      const read=create.reconcile||op.read;
      assert.ok(read,provider+' '+op.key);
      assert.ok(nativeReadOnly(read),provider+' '+op.key+' lookup is not read-only');
      assert.ok(sameApi(create,read),provider+' '+op.key+': '+create.url+' vs '+read.url);
    }
  }
});

// Third review: a create that got no answer is never sent again under its step id before a lookup settles it.
test('new settings wait until a create that got no answer is looked up, and a delete never takes them',()=>{
  let current=result(plain(worker.next(state('linode'),{type:'resume'})),opaque,503);
  const post=Object.keys(current.state.unanswered)[0];
  assert.ok(current.step.fields[0].options.some(option=>option.value==='edit'));
  let refused=plain(worker.next(current.state,{type:'input',value:{action:'edit'}}));
  assert.equal(refused.step.form,'recovery');assert.equal(refused.state.interruptedPhase,'provision');
  assert.equal(refused.state.error.message,'Check current cloud state first: a creation that got no answer may have made a resource');
  assert.deepEqual(plain(refused.state.unanswered),{[post]:'server'});
  // Looked up and absent, the settings may change; the create then goes out again, noted again.
  current=plain(worker.next(current.state,{type:'input',value:{action:'reconcile'}}));
  current=result(current,{data:[],page:1,pages:1,results:0});
  assert.equal(current.state.creationAbsent,true);assert.deepEqual(plain(current.state.unanswered),{});
  current=plain(worker.next(current.state,{type:'input',value:{action:'edit'}}));
  assert.equal(current.state.phase,'options');
  // A delete stopped at its lookup offers neither new settings nor a recreation, and refuses both.
  const kept=plain(worker.next(result(plain(worker.next(state('linode'),{type:'resume'})),opaque,503).state,{type:'input',value:{action:'keep'}})).state;
  let deleting=plain(worker.next(lifecycle('delete',kept).state,{type:'input',value:{approved:true}}));
  assert.equal(deleting.state.phase,'cleanupFind');
  deleting=result(deleting,opaque,500);
  assert.deepEqual(deleting.step.fields[0].options.map(option=>option.value),['reconcile','retry','account','cleanup','keep']);
  for(const action of ['edit','recreate']){
    const answer=plain(worker.next(Object.assign(plain(deleting.state),{creationAbsent:true}),{type:'input',value:{action}}));
    assert.equal(answer.step.form,'recovery',action);assert.equal(answer.state.operation,'delete');
    assert.equal(answer.state.error.message,'Only a setup creates cloud resources: finish or stop this delete, then set up a new VPN',action);
  }
  // A setup whose own cleanup began finishes or stops it: it never provisions again over its deleted receipts.
  const cleaned=Object.assign(state('digitalocean'),{phase:'recovery',interruptedPhase:'cleanupLocal',index:-1,
    resources:{key:{provider:'digitalocean',type:'key',id:11,owned:true,status:'deleted'},server:{provider:'digitalocean',type:'server',id:22,host:'192.0.2.22',owned:true,status:'deleted'}}});
  const asked=plain(worker.next(cleaned,{type:'resume'}));
  assert.ok(!asked.step.fields[0].options.some(option=>['edit','recreate'].includes(option.value)));
  const edit=plain(worker.next(cleaned,{type:'input',value:{action:'edit'}}));
  assert.equal(edit.state.phase,'recovery');assert.match(edit.state.error.message,/^This setup began deleting what it created/);
});

// Another saved account chosen in a recovery: DigitalOcean's key (201) and droplet POST (503) went to the first one.
function otherAccount(){
  let {current,droplet}=cutOffDroplet();
  current=plain(worker.next(current.state,{type:'input',value:{action:'account'}}));
  current=plain(worker.next(current.state,{type:'input',value:{credentialRef:'other-ref'}}));
  assert.equal(current.state.cloudRef,'cloud-ref');assert.equal(current.step.auth.credentialRef,'other-ref');
  assert.equal(current.step.url,droplets);
  return {current,droplet};
}
test('nothing found with other credentials proves nothing until they find one of the VPN\'s resources',()=>{
  let {current,droplet}=otherAccount();
  // Not in that account: the key the first one holds is read with them, and is not there either.
  let check=result(current,{droplets:[],meta:{total:0}});
  assert.equal(check.step.method,'GET');assert.match(check.step.url,/account\/keys\/11$/);assert.equal(check.step.auth.credentialRef,'other-ref');
  let paused=result(check,opaque,404);
  assert.equal(paused.step.form,'recovery');assert.match(paused.state.error.message,/^These cloud credentials are not the ones this VPN's resources were created with/);
  assert.deepEqual(plain(paused.state.unanswered),{[droplet]:'server'});assert.equal(paused.state.reconciled,undefined);
  assert.equal(paused.state.creationAbsent,undefined);
  // Its cleanup with them deletes nothing: the lookup and the key's deletion both need the same check first.
  let cleanup=plain(worker.next(plain(worker.next(paused.state,{type:'input',value:{action:'cleanup'}})).state,{type:'input',value:{approved:true}}));
  assert.equal(cleanup.state.phase,'cleanupFind');
  cleanup=result(result(cleanup,{droplets:[],meta:{total:0}}),opaque,404);
  assert.equal(cleanup.step.form,'recovery');assert.equal(cleanup.state.resources.key.status,'created');
  assert.deepEqual(plain(cleanup.state.unanswered),{[droplet]:'server'});
  // The same account under a new token: the key is found, so finding no droplet now settles it, named for the read sent again.
  let same=result(check,{ssh_key:{id:11}});
  assert.equal(same.state.cloudRef,'other-ref');assert.equal(same.step.url,droplets);
  const lookup=same.step.id;same=result(same,{droplets:[],meta:{total:0}});
  assert.equal(same.state.creationAbsent,true);assert.deepEqual(plain(same.state.reconciled),{[droplet]:lookup});
  // Found by name with them: that proves the account too.
  const named=result(current,found);
  assert.equal(named.state.cloudRef,'other-ref');assert.equal(named.state.resources.server.id,22);
  // A deletion answered 404 with other credentials waits for the same proof; a 2xx answer is proof enough.
  const prior=Object.assign(state('hetzner'),{phase:'ready',host:'203.0.113.7',cloudRef:'cloud-ref',credentialRef:'other-ref',
    resources:{key:{provider:'hetzner',type:'key',id:11,owned:true,status:'created'},firewall:{provider:'hetzner',type:'firewall',id:22,owned:true,status:'created'}}});
  let removing=plain(worker.next(lifecycle('delete',prior).state,{type:'input',value:{approved:true}}));
  assert.match(removing.step.url,/firewalls\/22$/);
  removing=result(removing,opaque,404);
  assert.equal(removing.step.method,'GET');assert.match(removing.step.url,/ssh_keys\/11$/);
  assert.equal(removing.state.resources.firewall.status,'created');
  removing=result(removing,{ssh_key:{id:11}});
  assert.equal(removing.step.method,'DELETE');assert.match(removing.step.url,/firewalls\/22$/);
  removing=result(removing,opaque,404);
  assert.equal(removing.state.resources.firewall.status,'deleted');assert.match(removing.step.url,/ssh_keys\/11$/);
  // With nothing else to read, it pauses; credentials the resources were created with never need the check.
  const alone=Object.assign(plain(prior),{resources:{firewall:prior.resources.firewall}});
  assert.equal(result(plain(worker.next(lifecycle('delete',alone).state,{type:'input',value:{approved:true}})),opaque,404).step.form,'recovery');
  const own=Object.assign(plain(alone),{credentialRef:'cloud-ref'});
  const gone=result(plain(worker.next(lifecycle('delete',own).state,{type:'input',value:{approved:true}})),opaque,404);
  assert.equal(gone.state.resources.firewall.status,'deleted');
});

test('the host\'s list keeps this version\'s own notes and tells apart resources made by the same request',()=>{
  // GCP's two firewall rules share one request URL: the VPN rule's create (position 2) stays the VPN rule's.
  const gcp=Object.assign(state('gcp'),{phase:'cancelled',interruptedPhase:'provision',resources:{network:{provider:'gcp',type:'network',id:'n',owned:true,status:'created'},
    sshFirewall:{provider:'gcp',type:'sshFirewall',id:'s',owned:true,status:'created'}},unanswered:{'test-deployment-123-provision-2-create-0':'vpnFirewall'}});
  const url=worker.graph(gcp)[2].create.url,listed=[{id:'test-deployment-123-provision-2-create-0',method:'POST',url}];
  assert.deepEqual(plain(lifecycle('delete',gcp,{unresolved:listed}).state.unanswered),{'test-deployment-123-provision-2-create-0':'vpnFirewall'});
  // An older version's note-less create is matched by the position in its step id, then by the first of the same request.
  const older=Object.assign(plain(gcp),{unanswered:undefined});
  assert.deepEqual(plain(lifecycle('delete',older,{unresolved:listed}).state.unanswered),{'test-deployment-123-provision-2-create-0':'vpnFirewall'});
  assert.deepEqual(plain(lifecycle('delete',older,{unresolved:[{id:'test-deployment-123-provision-1-create-0#1',method:'POST',url}]}).state.unanswered),
    {'test-deployment-123-provision-1-create-0#1':'sshFirewall'});
  assert.deepEqual(plain(lifecycle('delete',older,{unresolved:[{id:'other',method:'POST',url}]}).state.unanswered),{other:'sshFirewall'});
  // The delete then looks the VPN rule up by its own name.
  const start=plain(worker.next(lifecycle('delete',gcp,{unresolved:listed}).state,{type:'input',value:{approved:true}}));
  assert.match(start.step.url,/firewalls\/mssh-testdeployment123-vpn$/);
  // Scaleway's two rules, likewise by position.
  const scw=Object.assign(state('scaleway'),{phase:'cancelled',resources:{firewall:{provider:'scaleway',type:'firewall',id:'sg',owned:true,status:'created'}}});
  const rules=worker.graph(scw)[3].create.url;
  assert.deepEqual(plain(lifecycle('delete',scw,{unresolved:[{id:'test-deployment-123-provision-3-create-0',method:'POST',url:rules}]}).state.unanswered),
    {'test-deployment-123-provision-3-create-0':'vpnRule'});
});

test('a Scaleway power-on that took is powered off before its server is deleted, even while the server starts',()=>{
  const prior=Object.assign(state('scaleway'),{phase:'cancelled',interruptedPhase:'provision',index:6,unanswered:{'test-deployment-123-provision-6-create-0':'power'},
    resources:{key:{provider:'scaleway',type:'key',id:'k',owned:true,status:'created'},server:{provider:'scaleway',type:'server',id:'s',owned:true,status:'created'}}});
  const start=plain(worker.next(lifecycle('delete',prior).state,{type:'input',value:{approved:true}}));
  assert.equal(start.step.method,'GET');assert.match(start.step.url,/servers\/s$/);
  for(const state of ['starting','running','stopping']){
    const next=result(start,{server:{id:'s',state}});
    assert.equal(next.state.resources.power.status,'created',state);
    assert.equal(next.step.method,'POST',state);assert.deepEqual(plain(next.step.body),{action:'poweroff'});
  }
  // Stopped: the power-on never took, so the server is deleted at once.
  const stopped=result(start,{server:{id:'s',state:'stopped'}});
  assert.equal(stopped.state.resources.power,undefined);assert.equal(stopped.step.method,'DELETE');assert.match(stopped.step.url,/servers\/s$/);
});

test('a DigitalOcean reserved IP whose Droplet is gone settles only while none in its region is unassigned',()=>{
  // An older delete removed the Droplet; the reserved IP's create got no answer and the host lists it.
  const prior=Object.assign(state('digitalocean'),{operation:'delete',phase:'deleted',
    resources:{key:{provider:'digitalocean',type:'key',id:11,owned:true,status:'deleted'},server:{provider:'digitalocean',type:'server',id:22,owned:true,status:'deleted'}}});
  const listed=[{id:'test-deployment-123-provision-2-create-0',method:'POST',url:'https://api.digitalocean.com/v2/reserved_ips'}];
  const start=plain(worker.next(lifecycle('delete',prior,{unresolved:listed}).state,{type:'input',value:{approved:true}}));
  assert.equal(start.step.url,'https://api.digitalocean.com/v2/reserved_ips');
  const loose={ip:'203.0.113.5',droplet:null,region:{slug:'nyc3'}};
  const paused=result(start,{reserved_ips:[loose],meta:{total:1}});
  assert.equal(paused.step.form,'recovery');assert.match(paused.state.error.message,/^DigitalOcean names no reserved IP, and one in nyc3 is unassigned/);
  assert.equal(paused.state.reconciled,undefined);assert.equal(paused.state.resources.address,undefined);
  // None unassigned there (one elsewhere, or one assigned to another Droplet): it made none.
  for(const ips of [[],[{...loose,region:{slug:'ams3'}}],[{...loose,droplet:{id:99}}]]){
    const settled=result(start,{reserved_ips:ips,meta:{total:ips.length}});
    assert.equal(settled.step.kind,'vpn.cleanup',JSON.stringify(ips));assert.ok(settled.state.reconciled[listed[0].id]);
  }
  // Assigned to this VPN's Droplet: found, and deleted.
  const live=Object.assign(state('digitalocean'),{phase:'cancelled',interruptedPhase:'provision',unanswered:{[listed[0].id]:'address'},
    resources:{key:{provider:'digitalocean',type:'key',id:11,owned:true,status:'created'},server:{provider:'digitalocean',type:'server',id:22,owned:true,status:'created'}}});
  const lookup=plain(worker.next(lifecycle('delete',live).state,{type:'input',value:{approved:true}}));
  const made=result(lookup,{reserved_ips:[{ip:'203.0.113.5',droplet:{id:22},region:{slug:'nyc3'}},loose],meta:{total:2}});
  assert.equal(made.state.resources.address.id,'203.0.113.5');assert.match(made.step.url,/reserved_ips\/203\.0\.113\.5$/);
});

// Fourth review. Answers a job's HTTP and delay steps with respond(step) until it asks, pauses or reaches the server.
function drive(current,respond){
  for(let i=0;i<200&&['http','delay'].includes(current.step.kind);i++){
    const answer=current.step.kind==='delay'?{status:200,body:{}}:respond(current.step);
    current=result(current,answer.body,answer.status);
  }
  return current;
}
const options=current=>current.step.fields[0].options.map(option=>option.value);

test('a create refused for its credentials ties nothing to them, so a lookup with new ones settles it',()=>{
  // The token could read but not write: the first create (the SSH key) is refused, and nothing was made.
  let current=result(plain(worker.next(state('digitalocean'),{type:'resume'})),opaque,403);
  assert.equal(current.step.form,'recovery');assert.equal(current.state.cloudRef,undefined);
  const post=Object.keys(current.state.unanswered)[0];
  current=plain(worker.next(current.state,{type:'input',value:{action:'account'}}));
  current=plain(worker.next(current.state,{type:'input',value:{credentialRef:'other-ref'}}));
  assert.equal(current.step.method,'GET');assert.equal(current.step.auth.credentialRef,'other-ref');
  const lookup=current.step.id;
  current=result(current,{ssh_keys:[],meta:{total:0}});
  assert.equal(current.state.creationAbsent,true);assert.deepEqual(plain(current.state.reconciled),{[post]:lookup});
  // The reviewed new attempt goes to the new account, which the VPN's resources then belong to.
  current=plain(worker.next(current.state,{type:'input',value:{action:'recreate'}}));
  current=result(plain(worker.next(current.state,{type:'input',value:{approved:true}})),{ssh_keys:[],meta:{total:0}});
  assert.equal(current.step.method,'POST');assert.equal(current.state.cloudRef,'other-ref');
  // Once the VPN holds something, or another create may have made something, a refusal changes nothing.
  const held=result(cutOffDroplet().current,{},200);
  assert.equal(held.state.cloudRef,'cloud-ref');
  const second=Object.assign(state('digitalocean'),{index:1,resources:{key:{provider:'digitalocean',type:'key',id:11,owned:true,status:'created'}},cloudRef:'cloud-ref'});
  assert.equal(result(plain(worker.next(second,{type:'resume'})),opaque,403).state.cloudRef,'cloud-ref');
  const other=Object.assign(state('digitalocean'),{cloudRef:'cloud-ref',unanswered:{'earlier-post':'server'}});
  assert.equal(result(plain(worker.next(other,{type:'resume'})),opaque,401).state.cloudRef,'cloud-ref');
});

test('at the other-credentials pause the user may say they are for the same account, and what they find then counts',()=>{
  const prior=Object.assign(state('digitalocean'),{phase:'ready',host:'192.0.2.40',cloudRef:'cloud-ref',credentialRef:'other-ref',resources:{
    key:{provider:'digitalocean',type:'key',id:11,owned:true,status:'created'},server:{provider:'digitalocean',type:'server',id:22,owned:true,status:'created'},
    address:{provider:'digitalocean',type:'address',id:'192.0.2.40',host:'192.0.2.40',owned:true,status:'created'},
    firewall:{provider:'digitalocean',type:'firewall',id:'fw-id',owned:true,status:'created'}}});
  // Deleted in the console: nothing is found with the new token, so nothing proves the account.
  let current=drive(plain(worker.next(lifecycle('delete',prior).state,{type:'input',value:{approved:true}})),()=>({status:404,body:opaque}));
  assert.equal(current.step.form,'recovery');assert.match(current.state.error.message,/^These cloud credentials are not the ones this VPN's resources were created with\. If they reach another account/);
  assert.ok(options(current).includes('sameAccount'));assert.equal(current.step.fields[0].default,'reconcile');
  assert.ok(Object.values(current.state.resources).every(x=>x.status==='created'));
  for(const action of ['reconcile','retry'])
    assert.ok(drive(plain(worker.next(current.state,{type:'input',value:{action}})),()=>({status:404,body:opaque})).state.error.message.startsWith('These cloud credentials'),action);
  // Said to be the same account, it asks again, saying what that risks; going back changes nothing.
  const asked=plain(worker.next(current.state,{type:'input',value:{action:'sameAccount'}}));
  assert.equal(asked.step.form,'recovery');assert.equal(asked.step.title,'Count these credentials as this VPN\'s account?');
  assert.deepEqual(options(asked),['back','sameAccountConfirmed']);assert.equal(asked.step.fields[0].default,'back');
  assert.match(asked.step.message,/keep running and billing/);assert.equal(asked.state.cloudRef,'cloud-ref');
  const back=plain(worker.next(asked.state,{type:'input',value:{action:'back'}}));
  assert.deepEqual(options(back),options(current));assert.equal(back.state.cloudRef,'cloud-ref');assert.equal(back.state.sameAccountAsked,undefined);
  assert.equal(plain(worker.next(current.state,{type:'input',value:{action:'sameAccountConfirmed'}})).state.cloudRef,'cloud-ref');
  // Confirmed: each deletion is checked again with them, and 404 now shows it gone.
  const same=plain(worker.next(asked.state,{type:'input',value:{action:'sameAccountConfirmed'}}));
  assert.equal(same.state.cloudRef,'other-ref');assert.equal(same.step.method,'GET');assert.match(same.step.url,/firewalls\/fw-id$/);
  const done=drive(same,()=>({status:404,body:opaque}));
  assert.equal(done.step.kind,'vpn.cleanup');assert.ok(Object.values(done.state.resources).every(x=>x.status==='deleted'));
  // Offered only at that pause, and refused with the credentials the resources were created with.
  const {current:cut}=cutOffDroplet();
  assert.ok(!options(cut).includes('sameAccount'));
  const own=plain(worker.next(cut.state,{type:'input',value:{action:'sameAccount'}}));
  assert.equal(own.step.form,'recovery');assert.match(own.state.error.message,/^These are the credentials/);assert.equal(own.state.cloudRef,'cloud-ref');
});

test('an unassigned reserved IP does not stop the lookup while the Droplet its create named exists',()=>{
  const live=Object.assign(state('digitalocean'),{index:2,resources:{key:{provider:'digitalocean',type:'key',id:11,owned:true,status:'created'},
    server:{provider:'digitalocean',type:'server',id:22,owned:true,status:'created'}}});
  let current=result(plain(worker.next(live,{type:'resume'})),opaque,503);
  const post=Object.keys(current.state.unanswered)[0];
  current=plain(worker.next(current.state,{type:'input',value:{action:'reconcile'}}));
  const loose={reserved_ips:[{ip:'198.51.100.77',droplet:null,region:{slug:'nyc3'}}],meta:{total:1}};
  const check=result(current,loose);
  assert.equal(check.step.method,'GET');assert.equal(check.step.url,'https://api.digitalocean.com/v2/droplets/22');
  // There: an IP that request made would be assigned to it, so the unassigned one is not this VPN's.
  let again=result(check,{droplet:found.droplets[0]});
  assert.equal(again.step.url,'https://api.digitalocean.com/v2/reserved_ips');
  const lookup=again.step.id;again=result(again,loose);
  assert.equal(again.state.creationAbsent,true);assert.deepEqual(plain(again.state.reconciled),{[post]:lookup});
  // Gone (deleted in the console): the IP may be this VPN's, so it pauses as before; a later lookup reads the Droplet again.
  const gone=result(check,opaque,404);
  assert.equal(gone.step.form,'recovery');assert.match(gone.state.error.message,/^DigitalOcean names no reserved IP, and one in nyc3 is unassigned/);
  assert.equal(gone.state.reconciled,undefined);assert.equal(gone.state.dropletSeen,undefined);
  assert.equal(result(plain(worker.next(gone.state,{type:'input',value:{action:'reconcile'}})),loose).step.url,'https://api.digitalocean.com/v2/droplets/22');
  // A delete's lookup reads it the same way, then deletes the rest.
  const kept=plain(worker.next(result(plain(worker.next(live,{type:'resume'})),opaque,503).state,{type:'input',value:{action:'keep'}})).state;
  let deleting=result(plain(worker.next(lifecycle('delete',kept).state,{type:'input',value:{approved:true}})),loose);
  assert.equal(deleting.step.url,'https://api.digitalocean.com/v2/droplets/22');
  deleting=result(result(deleting,{droplet:found.droplets[0]}),loose);
  assert.ok(deleting.state.reconciled[post]);assert.equal(deleting.step.method,'DELETE');assert.match(deleting.step.url,/droplets\/22$/);
});

test('a create an older version sent before its region or project changed is looked up where it went, after the rest',()=>{
  const aws=Object.assign(state('aws'),{phase:'cancelled',interruptedPhase:'provision',
    resources:{key:{provider:'aws',type:'key',id:'mssh-testdeployment123',owned:true,status:'created'}}});
  aws.inputs.region='eu-west-1';aws.inputs.zone='eu-west-1a';
  const earlier='test-deployment-123-provision-0-create-0#1',target='Lightsail_20161128.ImportKeyPair';
  const unresolved=[{id:earlier,method:'POST',url:'https://lightsail.us-east-1.amazonaws.com/',target}];
  const start=lifecycle('delete',aws,{unresolved});
  assert.deepEqual(plain(start.state.unanswered),{[earlier]:'key'});
  // This VPN's own key is deleted where its settings point first: a lookup elsewhere never keeps it billing.
  const sent=[];let current=plain(worker.next(start.state,{type:'input',value:{approved:true}}));
  for(let i=0;i<20&&!(current.step.kind==='http'&&current.step.url.includes('us-east-1'));i++){
    const action=(get(current.step,'headers.X-Amz-Target')||'').replace('Lightsail_20161128.','');if(current.step.kind==='http')sent.push(action);
    current=current.step.kind==='delay'?result(current,{}):action==='DeleteKeyPair'?result(current,{operations:[]}):result(current,{code:'NotFoundException'},400);
  }
  assert.deepEqual(sent,['DeleteKeyPair','GetKeyPair']);assert.equal(current.state.resources.key.status,'deleted');
  assert.equal(current.state.phase,'cleanupFind');assert.equal(current.step.url,'https://lightsail.us-east-1.amazonaws.com/');
  assert.equal(current.step.headers['X-Amz-Target'],'Lightsail_20161128.GetKeyPair');assert.equal(current.step.auth.region,'us-east-1');
  assert.ok(nativeReadOnly(current.step));assert.ok(sameApi(unresolved[0],current.step));
  // Made there: not deleted from here, nor taken for this VPN's own key; it pauses saying where.
  const there=result(current,{keyPair:{name:aws.name}});
  assert.equal(there.step.form,'recovery');
  assert.match(there.state.error.message,/at lightsail\.us-east-1\.amazonaws\.com, which its settings no longer use.* The rest of this VPN is deleted\.$/);
  assert.equal(there.state.resources.key.status,'deleted');assert.deepEqual(plain(there.state.unanswered),{[earlier]:'key'});
  assert.equal(plain(worker.next(there.state,{type:'input',value:{action:'reconcile'}})).step.url,'https://lightsail.us-east-1.amazonaws.com/');
  // Not readable there: it pauses the same way, with the rest deleted.
  assert.match(result(current,opaque,403).state.error.message,/^Could not check whether an interrupted key creation made one \(HTTP 403, CLOUD_HTTP_ERROR\)\. The rest of this VPN is deleted\.$/);
  // Not there: settled by that lookup alone, and the delete ends.
  const lookup=current.step.id,absent=result(current,{code:'NotFoundException'},400);
  assert.deepEqual(plain(absent.state.reconciled),{[earlier]:lookup});assert.deepEqual(plain(absent.state.unanswered),{});
  assert.equal(absent.step.kind,'vpn.cleanup');assert.equal(absent.state.findMoved,undefined);
  // A new delete after one stopped there, with nothing else left, looks it up at once.
  const stopped=plain(worker.next(there.state,{type:'input',value:{action:'keep'}})).state;
  const again=plain(worker.next(lifecycle('delete',stopped,{unresolved}).state,{type:'input',value:{approved:true}}));
  assert.equal(again.step.url,'https://lightsail.us-east-1.amazonaws.com/');assert.equal(again.step.headers['X-Amz-Target'],'Lightsail_20161128.GetKeyPair');
  // A Google Cloud project changed: the lookup reads the network by name in the earlier project.
  const gcp=Object.assign(state('gcp'),{phase:'cancelled',resources:{}});
  const old=worker.graph(gcp)[0].create.url.replace('/projects/example/','/projects/old-project/');
  const gcpFind=plain(worker.next(lifecycle('delete',gcp,{unresolved:[{id:'test-deployment-123-provision-0-create-0#1',method:'POST',url:old}]}).state,{type:'input',value:{approved:true}}));
  assert.equal(gcpFind.step.url,'https://compute.googleapis.com/compute/v1/projects/old-project/global/networks/mssh-testdeployment123');
  // One that cannot be rebuilt there stays unadopted, and the host keeps refusing its removal.
  assert.equal(lifecycle('delete',aws,{unresolved:[{id:earlier,method:'POST',url:'https://example.invalid/',target}]}).state.unanswered,undefined);
});

test('a lookup that finds another resource than the receipt held keeps that receipt and deletes it after the rest',()=>{
  const linode=Object.assign(state('linode'),{phase:'ready',host:'192.0.2.78',resources:{server:{provider:'linode',type:'server',id:78,host:'192.0.2.78',owned:true,status:'created'},
    firewall:{provider:'linode',type:'firewall',id:5,owned:true,status:'created'}}});
  const earlier='test-deployment-123-provision-0-create-0#1';
  let current=plain(worker.next(lifecycle('delete',linode,{unresolved:[{id:earlier,method:'POST',url:'https://api.linode.com/v4/linode/instances'}]}).state,{type:'input',value:{approved:true}}));
  assert.equal(current.step.url,'https://api.linode.com/v4/linode/instances');
  // The user deleted server 78 in the console: the lookup finds only 77, the earlier attempt's.
  current=result(current,{data:[{id:77,label:linode.name,status:'running',ipv4:['192.0.2.77']}],page:1,pages:1,results:1});
  assert.equal(current.state.resources.server.id,77);assert.deepEqual(plain(current.state.resources['server~78']),linode.resources.server);
  const live={77:true,5:true},sent=[];
  const done=drive(current,step=>{const id=(step.url.match(/\/(\d+)$/)||[])[1];sent.push(step.method+' '+id);
    if(step.method==='DELETE'){if(!live[id])return {status:404,body:opaque};delete live[id];return {status:200,body:{}};}
    return live[id]?{status:200,body:{id:+id}}:{status:404,body:opaque};});
  assert.deepEqual(sent.filter(x=>x.startsWith('DELETE')),['DELETE 5','DELETE 77','DELETE 78']);
  assert.equal(done.step.kind,'vpn.cleanup');
  assert.ok(Object.values(done.state.resources).every(x=>x.status==='deleted'),JSON.stringify(done.state.resources));
  // The receipt it holds found again: nothing is kept beside it.
  const same=result(plain(worker.next(lifecycle('delete',linode,{unresolved:[{id:earlier,method:'POST',url:'https://api.linode.com/v4/linode/instances'}]}).state,{type:'input',value:{approved:true}})),
    {data:[{id:78,label:linode.name,status:'running',ipv4:['192.0.2.78']}],page:1,pages:1,results:1});
  assert.deepEqual(Object.keys(same.state.resources).sort(),['firewall','server']);
});

test('credentials entered again that were not the step\'s own leave it unsent and ask how to go on',()=>{
  const current=plain(worker.next(plain(worker.next(state('linode'),{type:'resume'})).state,{type:'error',code:'CREDENTIAL_CHANGED'}));
  assert.equal(current.step.form,'recovery');assert.equal(current.state.interruptedPhase,'provision');
  assert.match(current.state.error.message,/^Other cloud credentials were entered than the ones this step was prepared with/);
  assert.ok(options(current).includes('account'));
});

// Fifth review. Every receipt any saved state named, by provider, type and id, with the status it was last saved with: the
// phone's ledger keeps a row for each, and refuses to remove the entry while an owned one is not deleted.
function ledger(rows,current){
  for(const x of Object.values(current.state.resources||{}))if(x&&x.id!==undefined)rows[[x.provider,x.type,x.id].join('/')]=x.status;
  return current;
}
// Compute Engine answers an insert or a delete with an Operation, whose own id is not the resource's (targetId, unless bare).
function computeEngine(live,bare){
  let operation=7000,resource=9000;
  return step=>{
    const at=step.method==='POST'?step.url.split('/').pop()+'/'+step.body.name:step.url.split('/').slice(-2).join('/');
    if(step.method==='POST'){live[at]=String(++resource);return {status:200,body:{kind:'compute#operation',id:String(++operation),status:'RUNNING',...bare?{}:{targetId:live[at]}}};}
    if(!live[at])return {status:404,body:opaque};
    if(step.method==='DELETE'){delete live[at];return {status:200,body:{kind:'compute#operation',id:String(++operation),status:'RUNNING'}};}
    return {status:200,body:{kind:'compute#'+at.split('/')[0].replace(/s$/,''),id:live[at],name:at.split('/')[1],status:'RUNNING',address:'192.0.2.40'}};
  };
}
// Answers the job's HTTP and delay steps from respond, saving each state in rows, until it asks or reaches the server.
function gcpRun(current,respond,rows){
  ledger(rows,current);
  for(let i=0;i<80&&['http','delay'].includes(current.step.kind);i++){
    const answer=current.step.kind==='delay'?{status:200,body:{}}:respond(current.step);
    current=ledger(rows,result(current,answer.body,answer.status));
  }
  return current;
}
// Deletes the Google Cloud VPN of state prior, which must end deleted.
function gcpDelete(prior,respond,rows){
  const current=gcpRun(plain(worker.next(lifecycle('delete',prior).state,{type:'input',value:{approved:true}})),respond,rows);
  assert.equal(current.step.kind,'vpn.cleanup');assert.equal(ledger(rows,result(current,{})).state.phase,'deleted');
}
// Sets up, then deletes, a Google Cloud VPN, saving each state in rows; returns the setup's last state.
function gcpSetupAndDelete(live,rows,bare){
  const respond=computeEngine(live,bare);
  let current=gcpRun(plain(worker.next(state('gcp'),{type:'resume'})),respond,rows);
  assert.equal(current.step.operation,'bootstrap');
  current=ledger(rows,result(ledger(rows,result(current,{clientId:'7',configRef:'vault-config-ref'})),{profileId:'native-profile'}));
  assert.equal(current.state.phase,'ready');
  gcpDelete(current.state,respond,rows);
  return current.state;
}

test('Google Cloud receipts take the id an insert\'s Operation names for its resource, so a clean delete leaves no row held',()=>{
  const live={},rows={};
  const ready=gcpSetupAndDelete(live,rows);
  // The insert's answer already gave each receipt the id its read then found: one row each, all deleted, nothing left.
  assert.equal(ready.resources.network.id,'9001');assert.equal(ready.resources.address.id,'9004');
  assert.deepEqual(Object.keys(rows).sort(),['gcp/address/9004','gcp/network/9001','gcp/server/mssh-testdeployment123',
    'gcp/sshFirewall/mssh-testdeployment123-ssh','gcp/vpnFirewall/mssh-testdeployment123-vpn']);
  assert.ok(Object.values(rows).every(x=>x==='deleted'),JSON.stringify(rows));assert.deepEqual(live,{});
  // An Operation naming no targetId: the receipt takes the name, which its read keeps as a spare. Its DELETE, by name after
  // the resource went, answers 404, so that row is deleted too.
  const bare={},named={};
  const spare=gcpSetupAndDelete(bare,named,true);
  assert.equal(spare.resources.network.id,'9001');assert.equal(spare.resources['network~mssh-testdeployment123'].id,'mssh-testdeployment123');
  assert.equal(named['gcp/network/mssh-testdeployment123'],'deleted');assert.equal(named['gcp/address/mssh-testdeployment123'],'deleted');
  assert.ok(Object.values(named).every(x=>x==='deleted'),JSON.stringify(named));assert.deepEqual(bare,{});
  // VPN Setup 1.0.3 took the Operation's id, and its setup stopped before the read: the delete removes the network by name
  // under that id, so its row goes.
  const legacy=Object.assign(state('gcp'),{phase:'cancelled',suspendedPhase:'provision',httpStage:'read',
    resources:{network:{provider:'gcp',type:'network',id:'7999',name:'mssh-testdeployment123',owned:true,status:'created'}}});
  const old={'networks/mssh-testdeployment123':'9999'},seen={};
  gcpDelete(legacy,computeEngine(old),seen);
  assert.deepEqual(seen,{'gcp/network/7999':'deleted'});assert.deepEqual(old,{});
});

test('a DigitalOcean reserved IP still being assigned is counted though its Droplet exists, and the read for a lost answer pauses',()=>{
  const live=Object.assign(state('digitalocean'),{index:2,resources:{key:{provider:'digitalocean',type:'key',id:11,owned:true,status:'created'},
    server:{provider:'digitalocean',type:'server',id:22,owned:true,status:'created'}}});
  const assigning={reserved_ips:[{ip:'203.0.113.9',droplet:null,region:{slug:'nyc3'},locked:true}],meta:{total:1}};
  // The phone's read in place of the create's lost answer may come while DigitalOcean still assigns the IP: no Droplet read.
  const sent=plain(worker.next(live,{type:'resume'}));
  const lost=result(sent,{reserved_ips:[{...assigning.reserved_ips[0],locked:false}],meta:{total:1}},200,{recovered:true});
  assert.equal(lost.step.form,'recovery');assert.match(lost.state.error.message,/^DigitalOcean names no reserved IP, and one in nyc3 is unassigned/);
  assert.equal(lost.state.reconciled,undefined);assert.equal(lost.state.unanswered[sent.step.id],'address');
  // Checked again: the Droplet is read, but an IP still locked counts all the same.
  let again=result(plain(worker.next(lost.state,{type:'input',value:{action:'reconcile'}})),assigning);
  assert.equal(again.step.url,'https://api.digitalocean.com/v2/droplets/22');
  again=result(result(again,{droplet:found.droplets[0]}),assigning);
  assert.equal(again.step.form,'recovery');assert.match(again.state.error.message,/^DigitalOcean names no reserved IP/);
  assert.equal(again.state.reconciled,undefined);assert.equal(again.state.creationAbsent,undefined);
  // Assigned by the next check: found, with a receipt.
  const made=result(plain(worker.next(again.state,{type:'input',value:{action:'reconcile'}})),
    {reserved_ips:[{ip:'203.0.113.9',droplet:{id:22},region:{slug:'nyc3'},locked:false}],meta:{total:1}});
  assert.equal(made.state.resources.address.id,'203.0.113.9');assert.ok(made.state.reconciled[sent.step.id]);
  // A delete's lookup counts a locked one the same way.
  const kept=plain(worker.next(lost.state,{type:'input',value:{action:'keep'}})).state;
  let deleting=result(plain(worker.next(lifecycle('delete',kept).state,{type:'input',value:{approved:true}})),assigning);
  assert.equal(deleting.step.url,'https://api.digitalocean.com/v2/droplets/22');
  deleting=result(result(deleting,{droplet:found.droplets[0]}),assigning);
  assert.equal(deleting.step.form,'recovery');assert.equal(deleting.state.reconciled,undefined);
  assert.equal(deleting.state.resources.server.status,'created');
});

test('a delete of a setup on the user\'s own server with no host yet, or with no provider chosen, cleans up locally at once',()=>{
  for(const stopped of [{provider:'existing',mode:'manual',suspendedPhase:'manual'},{suspendedPhase:'provider'},{provider:'existing',mode:'manual',suspendedPhase:'sshKey'}]){
    const prior=Object.assign({version:1,deploymentId:'test-deployment-123',name:'mssh-testdeployment123',phase:'cancelled',resources:{},inputs:{},clientSequence:0},stopped);
    let current=plain(worker.next(lifecycle('delete',prior).state,{type:'input',value:{approved:true}}));
    assert.equal(current.step.kind,'vpn.cleanup',JSON.stringify(stopped));
    current=result(current,{});
    assert.equal(current.step.kind,'complete');assert.equal(current.state.phase,'deleted');
  }
});

// VPN Setup 1.0.5: Hetzner's settings are listed from the account's catalog, read with its API key before they are asked.
// Synthetic answers in the documented shapes (GET /v1/server_types, /v1/locations, /v1/pricing); placeholder prices.
const STEP_ID=/^[A-Za-z0-9._:/-]{1,160}$/;
// Hetzner's format: the net with 10 decimals, the gross with 16 ("1.1900000000000000").
const money=(net)=>({net:net.toFixed(10),gross:(Math.round(net*11900)/10000).toFixed(4)+'0'.repeat(12)});
const priced=(locations,net)=>locations.map(location=>({location,price_hourly:money(net/700),price_monthly:money(net),included_traffic:21990232555520,price_per_tb_traffic:money(1)}));
const at=(name,extra={})=>({id:{fsn1:1,nbg1:2,hel1:3,ash:4,hil:5,sin:6}[name]||9,name,deprecation:null,available:true,recommended:false,...extra});
const pages=(key,lists)=>lists.map((list,i)=>({[key]:list,meta:{pagination:{page:i+1,per_page:50,previous_page:i?i:null,next_page:i+1<lists.length?i+2:null,last_page:lists.length,total_entries:lists.flat().length}}}));
function hetznerCatalog() {
  const type=(id,name,cores,memory,disk,net,locations,extra={})=>({id,name,description:name.toUpperCase(),cores,memory,disk,prices:priced(locations.map(l=>l.name),net),
    storage_type:'local',cpu_type:extra.cpu_type||'shared',category:'Shared vCPU',architecture:extra.architecture||'x86',deprecation:extra.deprecation||null,locations});
  const retired={announced:'2025-10-16T00:00:00Z',unavailable_after:'2026-01-01T00:00:00Z'};
  return {
    types:pages('server_types',[[
      type(114,'cx23',2,4,40,3.19,[at('fsn1',{available:false}),at('nbg1',{recommended:true}),at('hel1')]),
      type(45,'cax11',2,4,40,2.99,[at('fsn1'),at('nbg1'),at('hel1')],{architecture:'arm'}),
      type(109,'cpx22',2,4,80,6.49,[at('fsn1'),at('nbg1'),at('hel1'),at('ash',{recommended:true})])
    ],[
      type(115,'cx33',4,8,80,5.49,[at('fsn1',{recommended:true}),at('nbg1')]),
      type(104,'cx22',2,4,40,2.49,[at('fsn1',{available:false,deprecation:retired}),at('nbg1',{deprecation:retired})]),
      type(96,'ccx13',2,8,80,12.49,[at('fsn1'),at('xyz9')],{cpu_type:'dedicated'}),
      type(22,'cpx11',2,2,40,1.99,[at('fsn1',{available:false,deprecation:retired})],{deprecation:retired})
    ]]),
    locations:pages('locations',[[
      {id:1,name:'fsn1',description:'Falkenstein DC Park 1',country:'DE',city:'Falkenstein',latitude:50.47612,longitude:12.370071,network_zone:'eu-central'},
      {id:2,name:'nbg1',description:'Nuremberg DC Park 1',country:'DE',city:'Nuremberg',latitude:49.452102,longitude:11.076665,network_zone:'eu-central'},
      {id:3,name:'hel1',description:'Helsinki DC Park 1',country:'FI',city:'Helsinki',latitude:60.169855,longitude:24.938379,network_zone:'eu-central'},
      {id:4,name:'ash',description:'Ashburn, VA',country:'US',city:'Ashburn, VA',latitude:39.045,longitude:-77.487,network_zone:'us-east'},
      {id:6,name:'sin',description:'Singapore',country:'SG',city:'Singapore',latitude:1.283,longitude:103.833,network_zone:'ap-southeast'}
    ]]),
    pricing:{pricing:{currency:'EUR',vat_rate:'19.00',primary_ips:[{type:'ipv4',prices:['fsn1','nbg1','hel1','ash'].map(location=>({location,price_hourly:money(0.001),price_monthly:money(0.5)}))},
      {type:'ipv6',prices:[{location:'fsn1',price_hourly:money(0),price_monthly:money(0)}]}],server_types:[]}}
  };
}
// A new Hetzner setup up to its catalog's first read.
function toCatalog(id='catalog-test') {
  let current=plain(worker.next({deploymentId:id,operation:'setup',inputs:{}},{type:'start'}));
  current=plain(worker.next(current.state,{type:'input',value:{provider:'hetzner'}}));
  current=plain(worker.next(current.state,{type:'input',value:{mode:'automatic'}}));
  current=plain(worker.next(current.state,{type:'input',value:{credentialRef:'cloud-ref'}}));
  return plain(worker.next(current.state,{type:'input',value:{credentialRef:'ssh-ref',publicKey:key}}));
}
// Answers each catalog read in turn; reads holds each answer or [status, body].
function readCatalog(current,c=hetznerCatalog(),seen=[]) {
  const queue=[...c.types,...c.locations,c.pricing];
  while(current.state.phase==='catalog'){
    const step=current.step;seen.push(step);
    assert.equal(step.kind,'http');assert.equal(step.method,'GET');assert.match(step.id,STEP_ID);
    assert.equal(step.auth.credentialRef,current.state.credentialRef);assert.equal(step.body,undefined);
    const next=queue.shift();
    current=Array.isArray(next)?result(current,next[1],next[0]):result(current,next);
  }
  return current;
}
const answer=(current,value)=>plain(worker.next(current.state,{type:'input',requestId:current.step.id,value}));
const listed=step=>step.fields[0].options.map(o=>o.value);

test('Hetzner reads its catalog after the API key and SSH key, before any setting, with read-only GETs only',()=>{
  const seen=[];let current=toCatalog();
  assert.equal(current.state.phase,'catalog');
  current=readCatalog(current,hetznerCatalog(),seen);
  assert.deepEqual(seen.map(s=>s.url),['https://api.hetzner.cloud/v1/server_types?per_page=50&page=1','https://api.hetzner.cloud/v1/server_types?per_page=50&page=2',
    'https://api.hetzner.cloud/v1/locations?per_page=50&page=1','https://api.hetzner.cloud/v1/pricing']);
  assert.deepEqual(seen.map(s=>s.id),['catalog-test-catalog-server_types-1','catalog-test-catalog-server_types-2','catalog-test-catalog-locations-1','catalog-test-catalog-pricing-1']);
  assert.equal(new Set(seen.map(s=>s.id)).size,seen.length);
  assert.ok(seen.every(s=>!s.reconcile&&!s.readOnly&&s.auth.scheme==='hetzner'));
  // Compact: only what the lists and the suggestion need.
  assert.deepEqual(current.state.catalog.locations,[['fsn1','Falkenstein, DE'],['nbg1','Nuremberg, DE'],['hel1','Helsinki, FI'],['ash','Ashburn, VA, US']]);
  assert.deepEqual(current.state.catalog.types.map(t=>t.n),['cx23','cpx22','cx33','ccx13']);
  assert.deepEqual(current.state.catalog.types[0],{n:'cx23',c:2,m:4,at:[['nbg1',3.7961,true],['hel1',3.7961,false]]});
  assert.equal(current.state.catalog.currency,'EUR');assert.ok(JSON.stringify(current.state.catalog).length<1500);
  assert.equal(current.state.catalogRead,undefined);
});

test('Hetzner asks the location from a list, then the server types orderable there, cheapest first, with Other last',()=>{
  let current=readCatalog(toCatalog());
  let step=current.step;
  assert.equal(step.kind,'input');assert.equal(step.form,'instance');assert.equal(step.id,'catalog-test-options-0');
  assert.equal(step.title,'Where should the VPN server run?');assert.equal(step.fields[0].label,'Location');assert.equal(step.fields[0].type,'select');
  assert.equal(step.message,'Where should the VPN server run? These Hetzner locations can take a new server in your account now. For another one, choose Other.');
  // sin lists no server type, so it is left out; the suggestion is where the cheapest type is, Hetzner's recommended one at equal prices.
  // The selected one comes first (a voice "yes" takes the first choice), then Hetzner's order.
  assert.deepEqual(step.fields[0].options,[{value:'nbg1',label:'nbg1 (suggested) · Nuremberg, DE'},{value:'fsn1',label:'fsn1 · Falkenstein, DE'},
    {value:'hel1',label:'hel1 · Helsinki, FI'},{value:'ash',label:'ash · Ashburn, VA, US'},{value:'(other)',label:'Other (type a value)'}]);
  assert.equal(step.fields[0].default,'nbg1');
  current=answer(current,{region:'nbg1'});step=current.step;
  assert.equal(step.id,'catalog-test-options-1');assert.equal(step.title,'Which server type should it use?');assert.equal(step.fields[0].label,'Server type');
  // Short labels, what one chooses by first: the native list shows one line and cuts off the end.
  assert.deepEqual(step.fields[0].options,[{value:'cx23',label:'cx23 (suggested) · 3.80 EUR/mo · 2 vCPU, 4 GB RAM'},
    {value:'cx33',label:'cx33 · 6.53 EUR/mo · 4 vCPU, 8 GB RAM'},{value:'cpx22',label:'cpx22 · 7.72 EUR/mo · 2 vCPU, 4 GB RAM'},
    {value:'(other)',label:'Other (type a value)'}]);
  assert.ok(step.fields[0].options.every(o=>o.label.length<=50&&o.label.indexOf('EUR')<32),'name, suggestion and price fit one line');
  assert.equal(step.fields[0].default,'cx23');
  assert.equal(step.message,'Which server type should it use? These can be ordered in nbg1 now, cheapest first. A VPN needs little, so the suggested one is plenty. '+
    'Prices are per month for the server alone; its public IPv4 address adds 0.60 EUR a month. For another one, choose Other.');
  // fsn1 lists what can be ordered there now: not the sold-out cx23, the cx22 or cpx11 retired there, or the Arm cax11.
  const there=answer(answer(readCatalog(toCatalog()),{region:'fsn1'}),{});
  assert.equal(there.step.fields[0].key,'sshCidr');assert.equal(there.state.inputs.size,'cx33');
  const fsn1=answer(readCatalog(toCatalog()),{region:'fsn1'}).step;
  assert.deepEqual(listed(fsn1),['cx33','cpx22','ccx13','(other)']);assert.equal(fsn1.fields[0].default,'cx33');
  const ash=answer(readCatalog(toCatalog()),{region:'ash'}).step;
  assert.deepEqual(listed(ash),['cpx22','(other)']);
});

test('the listed answers flow unchanged into the read-only checks and the create request',()=>{
  let current=readCatalog(toCatalog());
  current=answer(current,{region:'hel1'});current=answer(current,{size:'cpx22'});
  assert.equal(current.step.title,'Which addresses may connect over SSH?');assert.equal(current.step.fields[0].options,undefined);
  current=answer(current,{sshCidr:'198.51.100.0/24'});
  assert.equal(current.state.phase,'preflight');assert.equal(current.state.catalog,undefined);
  assert.deepEqual(current.state.inputs,{region:'hel1',size:'cpx22',sshCidr:'198.51.100.0/24'});
  assert.equal(current.step.url,'https://api.hetzner.cloud/v1/server_types?name=cpx22');
  current=result(current,{server_types:[{name:'cpx22',architecture:'x86',locations:[{id:3,name:'hel1',available:true}]}]});
  assert.equal(current.step.url,'https://api.hetzner.cloud/v1/locations?name=hel1');
  current=result(current,{locations:[{id:3,name:'hel1'}]});
  assert.equal(current.step.form,'confirm');assert.deepEqual(current.step.summary.settings,{region:'hel1',size:'cpx22',sshCidr:'198.51.100.0/24'});
  const create=worker.graph(current.state).find(op=>op.key==='server').create.body;
  assert.equal(create.server_type,'cpx22');assert.equal(create.location,'hel1');assert.equal(create.image,'ubuntu-24.04');
  assert.equal(worker.graph(current.state).find(op=>op.key==='address').create.body.location,'hel1');
});

test('a voice answer is one of the listed values, and Other is one more choice followed by a typed question',()=>{
  // As the app's voice offers a single-field select: each option's value as its choice id, its label as said.
  const choose=(step,said)=>{const o=step.fields[0].options.find(x=>x.label.toLowerCase().includes(said));assert.ok(o,said);return {[step.fields[0].key]:o.value};};
  let current=readCatalog(toCatalog());
  assert.ok(current.step.fields[0].options.length<=26);
  assert.ok(current.step.fields[0].options.every(o=>o.label.length<=80&&o.value.length<=40));
  current=answer(current,choose(current.step,'helsinki'));assert.equal(current.state.inputs.region,'hel1');
  current=answer(current,choose(current.step,'other'));
  // The same setting, typed: the voice asks it as text with the earlier answer or the usual default.
  assert.equal(current.step.id,'catalog-test-options-1');assert.equal(current.step.fields.length,1);
  assert.deepEqual(current.step.fields[0],{key:'size',label:'Server type',type:'string',required:true,default:'cx23'});
  // The voice says the title: after Other it asks for a name, not the same question again.
  assert.equal(current.step.title,'Which server type? Type or say its name, such as cx23.');
  assert.equal(current.step.message,'Which server type should it use? Enter an x86 Hetzner server type, such as cx23.');
  assert.equal(current.state.inputs.size,undefined);assert.equal(current.state.typing,'size');
  current=answer(current,{size:'ccx23'});
  assert.equal(current.state.inputs.size,'ccx23');assert.deepEqual(current.state.custom,{size:'ccx23'});assert.equal(current.state.typing,undefined);
  assert.equal(current.step.fields[0].key,'sshCidr');
});

test('a value typed after Other is not held to the lists: only the read-only checks judge it',()=>{
  let current=readCatalog(toCatalog());
  current=answer(current,{region:'(other)'});
  assert.deepEqual(current.step.fields[0],{key:'region',label:'Location',type:'string',required:true,default:'fsn1'});
  assert.equal(current.step.message,'Where should the VPN server run? Enter a Hetzner location name, such as fsn1, nbg1 or hel1.');
  // A typed value cleanInputs would refuse is asked again, typed, with the reason.
  current=answer(current,{region:'sin 1'});
  assert.equal(current.step.fields[0].options,undefined);assert.match(current.step.message,/^Use only letters/);assert.equal(current.state.typing,'region');
  current=answer(current,{region:'sin'});
  // The catalog lists nothing to order in sin, so its server type is typed too, with the usual default.
  assert.equal(current.step.fields[0].options,undefined);assert.equal(current.step.fields[0].default,'cx23');
  current=answer(current,{size:'cax11'});current=answer(current,{});
  assert.deepEqual(current.state.inputs,{region:'sin',size:'cax11',sshCidr:'0.0.0.0/0'});assert.deepEqual(current.state.custom,{region:'sin',size:'cax11'});
  assert.equal(current.step.url,'https://api.hetzner.cloud/v1/server_types?name=cax11');
  current=result(current,{server_types:[{name:'cax11',architecture:'arm',locations:[{id:1,name:'fsn1',available:true}]}]});
  assert.equal(current.step.form,'recovery');assert.equal(current.state.error.message,'Server type cax11 is not an x86 type (it is arm). Choose an x86 server type.');
  // Other in a listed location: a type the list leaves out (sold out there) is taken and checked.
  let sold=answer(readCatalog(toCatalog()),{region:'fsn1'});
  sold=answer(answer(answer(sold,{size:'(other)'}),{size:'cx23'}),{});
  assert.equal(sold.state.inputs.size,'cx23');assert.equal(sold.step.url,'https://api.hetzner.cloud/v1/server_types?name=cx23');
  // Other is never stored as a setting, nor taken where nothing is listed.
  const typed=answer(answer(readCatalog(toCatalog(),{types:[[401,{code:'CLOUD_HTTP_ERROR'}]],locations:[],pricing:{}}),{}),{});
  assert.equal(typed.state.inputs.region,'fsn1');
  const refusedOther=plain(worker.next(Object.assign(state('hetzner'),{phase:'options',optionIndex:0}),{type:'input',value:{region:'(other)'}}));
  assert.equal(refusedOther.state.phase,'options');assert.match(refusedOther.step.message,/^Use only letters/);
});

test('Change server settings reads the catalog again: earlier answers stay selected while orderable, a typed one is offered as entered before',()=>{
  let current=readCatalog(toCatalog());
  current=answer(current,{region:'nbg1'});current=answer(answer(current,{size:'(other)'}),{size:'cpx32'});current=answer(current,{});
  // The check finds cpx32 sold out in nbg1.
  current=result(current,{server_types:[{name:'cpx32',architecture:'x86',locations:[{id:2,name:'nbg1',available:false},{id:3,name:'hel1',available:true}]}]});
  assert.equal(current.step.form,'recovery');assert.equal(current.step.fields[0].default,'edit');
  current=answer(current,{action:'edit'});
  assert.equal(current.state.phase,'catalog');assert.equal(current.state.catalog,undefined);assert.equal(current.step.id,'catalog-test-catalog-server_types-1');
  // This time nbg1 has nothing but cpx22.
  const c=hetznerCatalog();c.types[0].server_types[0].locations[1].available=false;c.types[1].server_types[0].locations[1].available=false;
  current=readCatalog(current,c);
  assert.equal(current.step.fields[0].default,'nbg1');
  current=answer(current,{});
  assert.deepEqual(current.step.fields[0].options.map(o=>[o.value,o.label]),[['cpx32','cpx32 (entered before)'],
    ['cpx22','cpx22 (suggested) · 7.72 EUR/mo · 2 vCPU, 4 GB RAM'],['(other)','Other (type a value)']]);
  assert.match(current.step.message,/now, your earlier answer first, then cheapest first\./);
  assert.equal(current.step.fields[0].default,'cpx32');
  // Kept without typing it again.
  const kept=answer(answer(current,{}),{});
  assert.equal(kept.state.inputs.size,'cpx32');assert.deepEqual(kept.state.custom,{size:'cpx32'});
  // A listed answer forgets it.
  const changed=answer(current,{size:'cpx22'});
  assert.equal(changed.state.inputs.size,'cpx22');assert.equal(changed.state.custom,undefined);
  // An earlier listed answer no longer orderable is not offered: the suggestion is selected instead.
  let again=readCatalog(toCatalog());again=answer(answer(answer(again,{region:'nbg1'}),{size:'cx23'}),{});
  again=result(again,{server_types:[{name:'cx23',architecture:'x86',locations:[{id:2,name:'nbg1',available:false}]}]});
  again=readCatalog(answer(again,{action:'edit'}),c);
  assert.equal(again.step.fields[0].default,'nbg1');again=answer(again,{});
  assert.deepEqual(listed(again.step),['cpx22','(other)']);assert.equal(again.step.fields[0].default,'cpx22');
  // A typed location the list holds is simply selected there.
  let place=answer(answer(readCatalog(toCatalog()),{region:'(other)'}),{region:'hel1'});place=answer(answer(place,{}),{});
  place=result(place,{server_types:[]});place=readCatalog(answer(place,{action:'edit'}));
  assert.deepEqual(listed(place.step),['hel1','fsn1','nbg1','ash','(other)']);assert.equal(place.step.fields[0].default,'hel1');
});

test('other credentials read the catalog again before the settings, and a refresh sends the same step ids',()=>{
  let current=readCatalog(toCatalog());
  current=answer(answer(answer(current,{region:'hel1'}),{}),{});
  current=result(current,{code:'CLOUD_HTTP_ERROR'},401);
  assert.equal(current.step.fields[0].default,'account');
  current=answer(answer(current,{action:'account'}),{credentialRef:'new-ref'});
  // A failed check resumes at the checks with new credentials (every one again), as before.
  assert.equal(current.state.phase,'preflight');assert.equal(current.step.auth.credentialRef,'new-ref');
  // A cloud recovery whose setup stopped while asking the settings asks them again, from a new catalog.
  const asking=Object.assign(state('hetzner'),{phase:'recovery',interruptedPhase:'options',error:{code:'workflow_failed',message:'Invalid region'},optionIndex:1,
    catalog:{locations:[['fsn1','']],types:[{n:'cx23',at:[['fsn1',null,false]]}]}});
  current=answer(plain(worker.next(asking,{type:'resume'})),{action:'account'});
  assert.equal(current.step.form,'credential');
  current=answer(current,{credentialRef:'other-ref'});
  assert.equal(current.state.phase,'catalog');assert.equal(current.state.catalog,undefined);assert.equal(current.step.auth.credentialRef,'other-ref');
  assert.equal(current.step.id,'test-deployment-123-catalog-server_types-1');
});

test('any failed or odd catalog answer leaves the settings typed, as in 1.0.4, and never pauses the setup',()=>{
  const c=hetznerCatalog(),[types1,types2]=c.types,[places]=c.locations;
  const odd=[
    ['refused token',{types:[[401,{code:'CLOUD_HTTP_ERROR'}]]}],['forbidden',{types:[[403,{code:'CLOUD_HTTP_ERROR'}]]}],
    ['rate limited',{types:[[429,{code:'CLOUD_HTTP_ERROR'}]]}],['server error',{types:[[503,{code:'CLOUD_HTTP_ERROR'}]]}],
    ['second page refused',{types:[types1,[500,{code:'CLOUD_HTTP_ERROR'}]]}],['locations refused',{types:[types1,types2],locations:[[502,{}]]}],
    ['not JSON',{types:['<html>maintenance</html>']}],['no list',{types:[{server_types:{cx23:{}}}]}],['empty',{types:[{server_types:[],meta:{pagination:{next_page:null}}}],locations:[places]}],
    ['no locations',{types:[types1,types2],locations:[{locations:[]}]}],['redirect',{types:[[301,{}]]}],
    ['all sold out',{types:[{server_types:types1.server_types.map(t=>Object.assign({},t,{locations:t.locations.map(l=>Object.assign({},l,{available:false}))}))}],locations:[places]}],
    ['unknown places only',{types:[types1,types2],locations:[{locations:[{id:7,name:'zz1',city:'Nowhere',country:'ZZ'}]}]}],
    ['malformed entries',{types:[{server_types:[null,7,'cx23',{name:'cx 23',architecture:'x86',locations:[at('fsn1')]},{name:'cx23',architecture:'x86',locations:'fsn1'}]}],locations:[places]}]
  ];
  for(const [name,reads] of odd){
    let current=readCatalog(toCatalog(),Object.assign({types:[],locations:[],pricing:{}},reads));
    assert.equal(current.state.phase,'options',name);assert.equal(current.state.catalog,undefined,name);assert.equal(current.state.error,undefined,name);
    assert.deepEqual(current.step.fields,[{key:'region',label:'Location',type:'string',required:true,default:'fsn1'}],name);
    assert.equal(current.step.message,'Where should the VPN server run? Enter a Hetzner location name, such as fsn1, nbg1 or hel1.',name);
    current=answer(current,{});
    assert.deepEqual(current.step.fields,[{key:'size',label:'Server type',type:'string',required:true,default:'cx23'}],name);
  }
  // The read cut off (an error event other than other credentials): typed.
  const cut=plain(worker.next(toCatalog().state,{type:'error',code:'SSH_FAILED'}));
  assert.equal(cut.state.phase,'options');assert.equal(cut.step.fields[0].type,'string');assert.equal(cut.state.error,undefined);
  // A state whose catalog read is unreadable.
  for(const catalogRead of [null,{at:0},{at:0,page:'1',types:[],places:[]},{at:'x',page:1,types:[],places:[]},{at:0,page:1,types:{},places:[]}]){
    const broken=plain(worker.next(Object.assign(toCatalog().state,{catalogRead}),{type:'resume'}));
    assert.equal(broken.state.phase,'options');assert.equal(broken.step.fields[0].type,'string');
  }
  // Prices refused: still listed, without prices, cheapest first all the same.
  let unpriced=readCatalog(toCatalog(),{types:c.types,locations:c.locations,pricing:[503,{code:'CLOUD_HTTP_ERROR'}]});
  unpriced=answer(unpriced,{});
  assert.equal(unpriced.state.catalog.currency,undefined);
  assert.equal(unpriced.step.fields[0].options[0].label,'cx23 (suggested) · 2 vCPU, 4 GB RAM');
  assert.equal(unpriced.step.message,'Which server type should it use? These can be ordered in nbg1 now, cheapest first. A VPN needs little, so the suggested one is plenty. For another one, choose Other.');
});

test('catalog pages are followed in order up to four, and a page out of order ends that list',()=>{
  const type=n=>({name:'cx'+n,architecture:'x86',cores:2,memory:4,disk:40,prices:priced(['fsn1'],n),locations:[at('fsn1')]});
  const many=pages('server_types',[1,2,3,4,5,6].map(n=>[type(n+10)]));
  const seen=[];
  let current=readCatalog(toCatalog(),{types:many.slice(0,4),locations:hetznerCatalog().locations,pricing:{}},seen);
  assert.deepEqual(seen.filter(s=>/server_types/.test(s.url)).map(s=>s.url.split('page=')[2]),['1','2','3','4']);
  assert.deepEqual(current.state.catalog.types.map(t=>t.n),['cx11','cx12','cx13','cx14']);
  const skipping=[{server_types:[type(11)],meta:{pagination:{page:1,next_page:3}}}];
  current=readCatalog(toCatalog(),{types:skipping,locations:hetznerCatalog().locations,pricing:{}});
  assert.deepEqual(current.state.catalog.types.map(t=>t.n),['cx11']);
  // More orderable types than a voice list holds: the cheapest twelve, then Other.
  const lots=pages('server_types',[Array.from({length:30},(_,i)=>type(40-i))]);
  current=answer(readCatalog(toCatalog(),{types:lots,locations:hetznerCatalog().locations,pricing:{}}),{});
  assert.equal(current.step.fields[0].options.length,13);assert.equal(current.step.fields[0].default,'cx11');
});

test('jobs from VPN Setup 1.0.4 keep working: a typed question answered, a recovery changing the settings, manual setups',()=>{
  // A 1.0.4 state waiting on its typed Location question (no catalog): the answer is taken as typed.
  const old=Object.assign(state('hetzner'),{phase:'options',optionIndex:0,inputs:{},pending:'test-deployment-123-options-0'});
  let current=plain(worker.next(old,{type:'input',requestId:'test-deployment-123-options-0',value:{region:'nbg1'}}));
  assert.equal(current.state.inputs.region,'nbg1');assert.equal(current.step.id,'test-deployment-123-options-1');
  assert.equal(current.step.fields[0].type,'string');assert.equal(current.step.fields[0].default,'cx23');
  current=answer(answer(current,{size:'cpx22'}),{});
  assert.equal(current.state.phase,'preflight');assert.match(current.step.url,/name=cpx22$/);
  // A 1.0.4 job stopped by the sold-out check: Change server settings reads the catalog, then lists from it.
  current=soldOut();
  assert.equal(current.state.catalog,undefined);
  current=readCatalog(answer(current,{action:'edit'}));
  assert.equal(current.step.fields[0].type,'select');assert.equal(current.step.fields[0].default,'fsn1');
  current=answer(current,{});
  assert.deepEqual(listed(current.step),['cx33','cpx22','ccx13','(other)']);assert.equal(current.step.fields[0].default,'cx33');
  // A manual setup has no credentials: its questions are the console ones, as before.
  let manual=plain(worker.next({deploymentId:'manual-test',operation:'setup',inputs:{}},{type:'start'}));
  manual=answer(answer(answer(manual,{provider:'hetzner'}),{mode:'manual'}),{credentialRef:'ssh-ref',publicKey:key});
  assert.equal(manual.state.phase,'manual');assert.equal(manual.state.catalogRead,undefined);
  // Other providers ask as before, typed and titled by the label.
  let other=plain(worker.next({deploymentId:'other-test',operation:'setup',inputs:{}},{type:'start'}));
  other=answer(answer(answer(answer(other,{provider:'digitalocean'}),{mode:'automatic'}),{credentialRef:'cloud-ref'}),{credentialRef:'ssh-ref',publicKey:key});
  assert.equal(other.state.phase,'options');assert.equal(other.step.title,'Region');assert.equal(other.step.message,undefined);
  // A later operation starts without the setup's catalog, typed answers or progress through them.
  const setup=Object.assign(state('hetzner'),{phase:'ready',host:'203.0.113.7',catalog:{locations:[],types:[]},catalogRead:{at:1},typing:'size',custom:{size:'cpx32'}});
  const deleting=lifecycle('delete',setup);
  for(const field of ['catalog','catalogRead','typing','custom'])assert.equal(deleting.state[field],undefined,field);
  assert.equal(deleting.step.form,'confirm');
});

test('prices as Hetzner writes them (gross with 16 decimals) are shown, and the cheapest type and its location are suggested',()=>{
  // Hetzner's own example: net "1.0000000000", gross "1.1900000000000000". Hetzner recommends the pricier cpx22 in ash only.
  const p=(net,gross)=>({net,gross}),loc=(location,net,gross)=>({location,price_hourly:p('0.0010000000','0.0011900000000000'),price_monthly:p(net,gross)});
  const types={server_types:[
    {name:'cpx22',architecture:'x86',cores:2,memory:4,disk:80,deprecation:null,prices:[loc('ash','6.4900000000','7.7231000000000000'),loc('nbg1','6.4900000000','7.7231000000000000')],
      locations:[at('ash',{recommended:true}),at('nbg1')]},
    {name:'cx23',architecture:'x86',cores:2,memory:4,disk:40,deprecation:null,prices:[loc('nbg1','1.0000000000','1.1900000000000000')],locations:[at('nbg1')]},
    {name:'ccx13',architecture:'x86',cores:2,memory:8,disk:80,deprecation:null,prices:[loc('nbg1','12.4900000000','14.8631000000000000')],locations:[at('nbg1',{recommended:true})]}],
    meta:{pagination:{next_page:null}}};
  const pricing={pricing:{currency:'EUR',primary_ips:[{type:'ipv4',prices:[{location:'nbg1',price_hourly:p('0.0008000000','0.0009520000000000'),price_monthly:p('0.5200000000','0.6188000000000000')}]}]}};
  let current=readCatalog(toCatalog(),{types:[types],locations:hetznerCatalog().locations,pricing});
  assert.deepEqual(current.state.catalog.types.find(t=>t.n==='cx23').at,[['nbg1',1.19,false]]);
  assert.equal(current.step.fields[0].default,'nbg1');assert.equal(current.step.fields[0].options[0].label,'nbg1 (suggested) · Nuremberg, DE');
  current=answer(current,{});
  assert.equal(current.step.fields[0].default,'cx23');
  assert.deepEqual(current.step.fields[0].options.map(o=>o.label),['cx23 (suggested) · 1.19 EUR/mo · 2 vCPU, 4 GB RAM','cpx22 · 7.72 EUR/mo · 2 vCPU, 4 GB RAM',
    'ccx13 · 14.86 EUR/mo · 2 vCPU, 8 GB RAM','Other (type a value)']);
  assert.match(current.step.message,/now, cheapest first\. .* its public IPv4 address adds 0\.62 EUR a month\./);
  // Still bounded: no more than 20 decimals, no exponent.
  const odd=JSON.parse(JSON.stringify(types));odd.server_types[1].prices[0].price_monthly.gross='1.'+'1'.repeat(21);odd.server_types[2].prices[0].price_monthly.gross='1e3';
  const unpriced=readCatalog(toCatalog(),{types:[odd],locations:hetznerCatalog().locations,pricing});
  assert.deepEqual(unpriced.state.catalog.types.map(t=>t.at[t.at.length-1][1]),[7.7231,null,null]);
});

test('a type whose own deprecation is set is listed where Hetzner still lists it as orderable, and not where it is retired',()=>{
  const c=hetznerCatalog(),retired={announced:'2025-10-16T00:00:00Z',unavailable_after:'2026-01-01T00:00:00Z'};
  c.types[1].server_types.push({name:'cx13',architecture:'x86',cores:1,memory:2,disk:20,deprecation:retired,prices:priced(['nbg1','hel1'],2.49),
    locations:[at('nbg1'),at('hel1',{available:false,deprecation:retired})]});
  let current=answer(readCatalog(toCatalog(),c),{region:'nbg1'});
  assert.equal(current.step.fields[0].default,'cx13');assert.equal(current.step.fields[0].options[0].label,'cx13 (suggested) · 2.96 EUR/mo · 1 vCPU, 2 GB RAM');
  current=answer(readCatalog(toCatalog(),c),{region:'hel1'});
  assert.deepEqual(listed(current.step),['cx23','cpx22','(other)']);
});

test('the selected answer is the first choice, so a voice "yes" takes what the dialog preselects',()=>{
  // The voice offers a select's options in order and maps a plain agreement to the first.
  const first=step=>{assert.equal(step.fields[0].options[0].value,step.fields[0].default);return step;};
  let current=readCatalog(toCatalog());
  first(current.step);assert.equal(current.step.fields[0].default,'nbg1');
  current=answer(current,{region:current.step.fields[0].options[0].value});
  first(current.step);assert.equal(current.step.fields[0].default,'cx23');
  // An earlier answer that is not the cheapest stays selected, and first, when the settings are asked again.
  current=answer(answer(answer(current,{size:'cpx22'}),{}),{});
  current=result(current,{server_types:[{name:'cpx22',architecture:'x86',locations:[{id:2,name:'nbg1',available:false}]}]});
  current=readCatalog(answer(current,{action:'edit'}));
  first(current.step);current=answer(current,{});
  first(current.step);assert.equal(current.step.fields[0].default,'cpx22');
  assert.deepEqual(listed(current.step),['cpx22','cx23','cx33','(other)']);
  assert.match(current.step.message,/These can be ordered in nbg1 now, your earlier answer first, then cheapest first\./);
  // After Other the voice asks for a name.
  const other=answer(readCatalog(toCatalog()),{region:'(other)'});
  assert.equal(other.step.title,'Which location? Type or say its Hetzner name, such as fsn1.');
  assert.equal(other.step.message,'Where should the VPN server run? Enter a Hetzner location name, such as fsn1, nbg1 or hel1.');
});

test('a type the catalog lists as not orderable in the chosen location is not preselected again, typed or entered before',()=>{
  // fsn1: cx23 sold out there. Other fills in the suggestion, not the usual cx23.
  let current=answer(answer(readCatalog(toCatalog()),{region:'fsn1'}),{size:'(other)'});
  assert.equal(current.step.fields[0].type,'string');assert.equal(current.step.fields[0].default,'cx33');
  // Typed all the same, it is taken and checked; the check finds it sold out.
  current=answer(answer(current,{size:'cx23'}),{});
  assert.deepEqual(current.state.custom,{size:'cx23'});
  current=result(current,{server_types:[{name:'cx23',architecture:'x86',locations:[{id:1,name:'fsn1',available:false},{id:2,name:'nbg1',available:true}]}]});
  current=readCatalog(answer(current,{action:'edit'}));
  assert.equal(current.step.fields[0].default,'fsn1');current=answer(current,{});
  // Still offered (the user may know better), labelled, and not selected.
  assert.deepEqual(current.step.fields[0].options.map(o=>[o.value,o.label]).slice(0,2),[['cx33','cx33 (suggested) · 6.53 EUR/mo · 4 vCPU, 8 GB RAM'],
    ['cx23','cx23 (entered before, not available here)']]);
  assert.equal(current.step.fields[0].default,'cx33');
  const kept=answer(current,{size:'cx23'});assert.equal(kept.state.inputs.size,'cx23');assert.deepEqual(kept.state.custom,{size:'cx23'});
  // In nbg1, where the catalog lists it, it is simply selected there.
  const there=answer(current,{});assert.equal(there.state.inputs.size,'cx33');assert.equal(there.state.custom,undefined);
  // A type the catalog does not know (cpx32, Arm cax11) stays selected: only the checks judge it.
  let arm=answer(answer(answer(readCatalog(toCatalog()),{region:'fsn1'}),{size:'(other)'}),{size:'cax11'});arm=answer(arm,{});
  arm=result(arm,{server_types:[{name:'cax11',architecture:'arm',locations:[{id:1,name:'fsn1',available:true}]}]});
  arm=answer(readCatalog(answer(arm,{action:'edit'})),{});
  assert.equal(arm.step.fields[0].default,'cax11');assert.equal(arm.step.fields[0].options[0].label,'cax11 (entered before)');
});

test('the usual server type left as it was, after a location the catalog lists nothing in, is not offered back as entered before',()=>{
  let current=answer(answer(readCatalog(toCatalog()),{region:'(other)'}),{region:'fsn9'});
  assert.equal(current.step.fields[0].type,'string');assert.equal(current.step.fields[0].default,'cx23');
  current=answer(answer(current,{}),{});
  assert.deepEqual(current.state.custom,{region:'fsn9'});assert.equal(current.state.inputs.size,'cx23');
  current=result(current,{server_types:[{name:'cx23',architecture:'x86',locations:[{id:2,name:'nbg1',available:true}]}]});
  current=readCatalog(answer(current,{action:'edit'}));
  assert.equal(current.step.fields[0].default,'fsn9');assert.equal(current.step.fields[0].options[0].label,'fsn9 (entered before)');
  current=answer(current,{region:'fsn1'});
  // fsn1 sells no cx23 now: the suggestion is selected.
  assert.deepEqual(listed(current.step),['cx33','cpx22','ccx13','(other)']);assert.equal(current.step.fields[0].default,'cx33');
  // One typed there that differs from the default counts as entered before.
  let typed=answer(answer(readCatalog(toCatalog()),{region:'(other)'}),{region:'fsn9'});typed=answer(typed,{size:'cpx32'});
  assert.deepEqual(typed.state.custom,{region:'fsn9',size:'cpx32'});
});

test('other credentials entered during a catalog read pause at once with the reason, and the account choice reads it again with them',()=>{
  const reading=toCatalog();
  let current=plain(worker.next(reading.state,{type:'error',requestId:reading.step.id,code:'CREDENTIAL_CHANGED'}));
  assert.equal(current.state.phase,'recovery');assert.equal(current.state.interruptedPhase,'catalog');
  assert.match(current.step.message,/^Other cloud credentials were entered than the ones this step was prepared with/);
  assert.ok(current.step.fields[0].options.some(o=>o.value==='account'));
  // Checking again sends the same read (the app asks for the original credentials).
  const again=answer(current,{action:'reconcile'});
  assert.equal(again.state.phase,'catalog');assert.equal(again.step.id,reading.step.id);assert.equal(again.step.url,reading.step.url);
  assert.equal(readCatalog(again).step.fields[0].type,'select');
  // Update cloud account credentials: a new catalog read with them, then the lists.
  current=answer(answer(current,{action:'account'}),{credentialRef:'other-ref'});
  assert.equal(current.state.phase,'catalog');assert.equal(current.step.auth.credentialRef,'other-ref');assert.equal(current.step.id,'catalog-test-catalog-server_types-1');
  current=readCatalog(current);
  assert.equal(current.step.fields[0].type,'select');
  // Change server settings reads it again too.
  const edit=answer(plain(worker.next(reading.state,{type:'error',requestId:reading.step.id,code:'CREDENTIAL_CHANGED'})),{action:'edit'});
  assert.equal(edit.state.phase,'catalog');assert.equal(edit.step.id,reading.step.id);
});
