(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let selected = null, jobs = [], busy = false, timer;
  const active = job => !['SUCCEEDED','FAILED','CANCELLED','COMPLETED'].includes(String(job.status).toUpperCase());
  function message(value) { $('notice').textContent = value; }
  function setBusy(value) {
    busy=value;
    document.querySelectorAll('button,select').forEach(control=>{control.disabled=value;});
    $('revoke').disabled=value||!$('clients').options.length;
    $('export').disabled=value||!$('clients').options.length;
  }
  async function action(task) {
    if(busy)return;setBusy(true);
    try { await task();await refresh();message(''); }
    catch(error){message(error.message||'The workflow could not be updated.');}
    finally{setBusy(false);}
  }
  function render(job) {
    selected=job;$('current').hidden=!job;if(!job)return;
    const state=job.state||{},step=job.pendingStep||{};
    $('title').textContent=state.name||'VPN setup';
    $('status').textContent=String(job.status||state.phase||'Ready').replace(/_/g,' ');
    $('endpoint').textContent=state.host?'Server: '+state.host:'';
    $('question').textContent=state.phase==='deleted'&&state.mode==='manual'
      ?'VPN removed. Delete any unused VM, disks and public IP in your cloud console to stop their charges.'
      :step.title||(state.error&&state.error.message)||'';
    const pausedHttp=String(job.status).toUpperCase()==='PAUSED'&&job.needsCredential===true;
    $('review').hidden=step.kind!=='input'&&!pausedHttp;$('review').textContent=pausedHttp?'Review cloud credentials':step.form==='confirm'?'Review and approve':'Continue';
    $('resume').hidden=!['PAUSED','FAILED','CANCELLED'].includes(String(job.status).toUpperCase());$('cancel').hidden=!active(job);
    $('resources').replaceChildren();
    Object.entries(state.resources||{}).forEach(([key,value])=>{const li=document.createElement('li');li.textContent=key+': '+(value.id||'pending')+' · '+(value.status||'created');$('resources').append(li);});
    $('manage').hidden=!state.host||!['ready','cancelled','recovery'].includes(state.phase);
    $('clients').replaceChildren();
    (state.clients||[]).forEach(client=>{const option=document.createElement('option');option.value=client.clientId;option.textContent='Client '+client.clientId;$('clients').append(option);});
    $('revoke').disabled=busy||!$('clients').options.length;
    $('export').disabled=busy||!$('clients').options.length;$('forget').hidden=!state.credentialRef;
  }
  async function refresh() {
    const value=await MobileSSH.workflows.list();jobs=Array.isArray(value)?value:value.jobs||[];
    const id=selected&&selected.id;
    $('jobs').replaceChildren();
    jobs.forEach(job=>{const option=document.createElement('option');option.value=job.id;option.textContent=((job.state||{}).name||'VPN setup')+' · '+job.status;$('jobs').append(option);});
    const item=jobs.find(job=>job.id===id)||jobs.find(active)||jobs[0];
    if(item){$('jobs').value=item.id;render(await MobileSSH.workflows.get({id:item.id}));}else render(null);
  }
  async function create(operation,inputs) {const job=await MobileSSH.workflows.create({operation,inputs:inputs||{}});selected=job;return job;}
  async function manage(operation) {await create(operation,{deploymentId:selected.state.deploymentId,clientId:operation==='revokeClient'?$('clients').value:undefined});}
  $('new').onclick=()=>action(()=>create('setup'));
  $('jobs').onchange=()=>action(async()=>render(await MobileSSH.workflows.get({id:$('jobs').value})));
  $('review').onclick=()=>action(async()=>render(await MobileSSH.workflows.review({id:selected.id})));
  $('resume').onclick=()=>action(()=>MobileSSH.workflows.resume({id:selected.id,revision:selected.revision}));
  $('cancel').onclick=()=>action(()=>MobileSSH.workflows.cancel({id:selected.id,revision:selected.revision}));
  $('health').onclick=()=>action(()=>manage('health'));$('client').onclick=()=>action(()=>manage('createClient'));
  $('connect').onclick=()=>action(()=>MobileSSH.workflows.openVpn({id:selected.id}));
  $('export').onclick=()=>action(()=>MobileSSH.workflows.export({id:selected.id,clientId:$('clients').value}));
  $('admin').onclick=()=>action(()=>MobileSSH.workflows.openAdmin({id:selected.id}));
  $('forget').onclick=()=>action(()=>MobileSSH.workflows.forgetCredential({id:selected.id}));
  $('revoke').onclick=()=>action(()=>manage('revokeClient'));$('delete').onclick=()=>action(()=>manage('delete'));
  async function init(){
    if(!window.MobileSSH||!MobileSSH.workflows){message('VPN Setup requires Mobile SSH with workflow bridge 1.3.0 or newer.');$('new').disabled=true;return;}
    try{const theme=await MobileSSH.ui.theme();for(const [key,value] of Object.entries({accent:theme.accent,bg:theme.background,surface:theme.surface,text:theme.text}))if(value)document.documentElement.style.setProperty('--'+key,value);}catch(_){}
    await action(async()=>{await refresh();if(!jobs.length)await create('setup');});
    timer=setInterval(()=>{if(!busy&&selected&&active(selected))action(refresh);},1000);
  }
  window.addEventListener('pagehide',()=>clearInterval(timer));
  init();
})();
