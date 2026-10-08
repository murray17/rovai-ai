// Opt-in real Core crash/restart and native failure acceptance. Negative model
// inputs use only an unlogged fixture or a loopback failure server, never paid credentials.
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {createHash,randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {createConfiguredCampAndSend} from '../../../../scripts/lib/create-configured-camp.mjs'
import {spawnSync} from 'node:child_process'
import {startPackagedHubAcceptance} from './native_hub_packaged_client.mjs'
import {startQualificationCore} from '../../../../scripts/lib/qualification-core.mjs'
import {seedCompletedOnboardingForAcceptance} from '../../../../scripts/lib/dev-desktop.mjs'
import {removeEphemeralRuntimeCampFilesRoot} from '../../../../scripts/lib/runtime-camp-files-root.mjs'
const {values}=parseArgs({options:{'login-fixture':{type:'boolean',default:false},'native-account':{type:'boolean',default:false},root:{type:'string'},core:{type:'string'},app:{type:'string'},cline:{type:'string'},'settings-source':{type:'string'}}})
for(const key of ['root','core','cline','settings-source'])assert(values[key],`${key} required`)
const root=resolve(values.root),source=resolve(values['settings-source']),cli=resolve(values.cline)
await mkdir(root,{mode:0o700})
const data=join(root,'core-data'),workspace=join(root,'workspace'),native=join(root,'native'),settings=join(native,'data/settings'),hosts=join(data,'runtime/cline-hub/hosts')
await mkdir(workspace,{mode:0o700});await mkdir(settings,{recursive:true,mode:0o700});seedCompletedOnboardingForAcceptance(data)
await writeFile(join(settings,'global-settings.json'),JSON.stringify({telemetryOptOut:true,autoUpdateEnabled:false}),{mode:0o600})
await writeFile(join(data,'mcp.json'),'{"mcpServers":{}}',{mode:0o600})
const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex')
const before=await digest(join(source,'providers.json'))
for(const key of Object.keys(process.env))if(/^(ROVAI_|CLINE_)/.test(key)||(values['native-account']&&/^OPENAI_/.test(key)))delete process.env[key]
const start=async()=>values.app?await startPackagedHubAcceptance({app:resolve(values.app),data,cwd:workspace}):startQualificationCore({coreExecutable:resolve(values.core),dataDirectory:data,workingDirectory:workspace,runtimeCacheDirectory:join(root,'cache'),mcpConfigPath:join(data,'mcp.json')})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const environment=[{name:'CLINE_DIR',value:native},{name:'CLINE_DATA_DIR',value:join(native,'data')},{name:'CLINE_PROVIDER_SETTINGS_PATH',value:join(source,'providers.json')}]
let core=await start(),daemonPid
const proof={kind:values.app?'packaged-hub-diagnostics':'interrupted-native-hub-diagnostic-recovery',modelInputs:0}
try{
 await core.request('health.check')
 const current=await core.request('runtime.startup.get',{runtimeKind:'cline-cli'})
 await core.request('runtime.startup.save',{runtimeKind:'cline-cli',expectedRevision:current.revision,configuration:{programPath:cli,environment}})
 if(!values.app){
 const pending=core.request('runtime.product.check',{runtimeKind:'cline-cli'}).catch(()=>null)
 for(let i=0;i<8000&&!daemonPid;i++){
  for(const name of await readdir(hosts).catch(()=>[])){
   if(!name.startsWith('probe-'))continue
   const dir=join(hosts,name)
   const discovery=await readFile(join(dir,'discovery.json'),'utf8').then(JSON.parse,()=>null)
   if(!discovery)continue
   for(const ledger of await readdir(join(dir,'owned-processes')).catch(()=>[])){
    if(!ledger.endsWith('.json'))continue
    const record=await readFile(join(dir,'owned-processes',ledger),'utf8').then(JSON.parse,()=>null)
    if(record&&Object.values(record.processes).some(p=>p.pid===discovery.pid)){daemonPid=discovery.pid;proof.ownershipRecorded=true;break}
   }
  }
  if(!daemonPid)await sleep(5)
 }
 assert(daemonPid,'must observe live diagnostic ownership before terminating fixture Core')
 proof.corePid=core.pid;proof.nativePid=daemonPid
 process.kill(core.pid,'SIGKILL')
 await pending
 await core.stop()
 const beforeRestart=spawnSync('ps',['-p',String(daemonPid),'-o','stat='],{encoding:'utf8'})
 assert.equal(beforeRestart.status,0,'native daemon must still be live after fixture Core crash')
 assert(!beforeRestart.stdout.trim().startsWith('Z'))
 proof.nativeAliveBeforeRestart=true
 core=await start();await core.request('health.check')
 const old=spawnSync('ps',['-p',String(daemonPid),'-o','stat='],{encoding:'utf8'})
 assert(old.status!==0||old.stdout.trim().startsWith('Z'),'restart must reap the exact native daemon')
 assert.deepEqual(await readdir(hosts),[])
 proof.restartReapedNative=true;proof.privateHostRemoved=true
 }else{proof.packagedRendererToCore=true;proof.appPid=core.pid}
 await core.request('runtime.product.check',{runtimeKind:'cline-cli'})
 const install=(await core.request('runtime.installations.list')).find(i=>i.adapterKind==='cline-cli'&&i.installationClass==='managed_default')
 assert.equal(install.snapshot.probeStatus,'ready');assert(install.snapshot.protocols.includes('cline-hub-v1'))
 proof.normalDiagnosticAfterRecovery='ready'
 // Fail after private settings are written, before a daemon starts. Repeated
 // diagnostics must leave no private Host directory or Provider copy.
 await writeFile(join(settings,'cline_mcp_settings.json'),'{"mcpServers":false}',{mode:0o600})
 for(let attempt=0;attempt<2;attempt++){
  const check=await core.request('runtime.product.check',{runtimeKind:'cline-cli'})
  assert.equal(check.ready,false)
  const failed=(await core.request('runtime.installations.list')).find(i=>i.adapterKind==='cline-cli'&&i.installationClass==='managed_default')
  assert.equal(failed.lastProbeAttempt.failure.code,'cline_native_mcp_config_invalid')
  assert.deepEqual(await readdir(hosts),[])
 }
 proof.preparationFailureCleanedTwice=true
 await rm(join(settings,'cline_mcp_settings.json'))
 // A synthetic unlogged source; never alter real credentials or expiration.
 await writeFile(join(settings,'unlogged.json'),JSON.stringify({version:1,lastUsedProvider:'openai-codex',providers:{'openai-codex':{settings:{provider:'openai-codex',model:'native-model'}}}}),{mode:0o600})
 const latest=await core.request('runtime.startup.get',{runtimeKind:'cline-cli'})
 await core.request('runtime.startup.save',{runtimeKind:'cline-cli',expectedRevision:latest.revision,configuration:{programPath:cli,environment:[...environment.filter(v=>v.name!=='CLINE_PROVIDER_SETTINGS_PATH'),{name:'CLINE_PROVIDER_SETTINGS_PATH',value:join(settings,'unlogged.json')}]}})
 await core.request('runtime.product.check',{runtimeKind:'cline-cli'})
 const auth=(await core.request('runtime.installations.list')).find(i=>i.adapterKind==='cline-cli'&&i.installationClass==='managed_default')
 assert.equal(auth.snapshot.probeStatus,'ready')
 assert.equal(auth.snapshot.authenticationStatus,'unknown')
 proof.zeroModelProbeDoesNotClaimAuthentication=true
 const failedRequest=async(label,expectedCode)=>{
  const created=await core.request('members.create',{commandId:randomUUID(),command:{displayName:'Native failure '+label,teamRole:'Fixture',professionalResponsibilities:'Native failure acceptance.',personalityTraits:['precise'],workingPrinciples:'No tools.',growthTopic:'Native results.'}})
  assert.equal(created.status,'applied')
  const agentId=created.payload.agentId,profile=await core.request('members.get',{agentId})
  const installation=(await core.request('runtime.installations.list')).find(i=>i.adapterKind==='cline-cli'&&i.installationClass==='managed_default')
  const configured=await core.request('members.runtime.set',{commandId:randomUUID(),command:{agentId,expectedVersion:profile.version,adapterKind:'cline-cli',model:installation.memberRuntimeDefaults.model,permissions:installation.memberRuntimeDefaults.permissions}})
  assert.equal(configured.status,'applied')
  const sent=await createConfiguredCampAndSend(core.request,{commandId:randomUUID(),name:'Native failure '+label,workspace:{projectPath:workspace},memberAgentIds:[agentId],defaultLeadAgentId:agentId,address:{mode:'explicit',agentIds:[agentId]},body:'Native failure acceptance: reply OK without tools or publication.',purpose:'Synthetic native failure'})
  proof.modelInputs++
  let snapshot,run
  for(let i=0;i<240;i++){
   snapshot=await core.request('threads.snapshot',{threadId:sent.payload.threadId});run=snapshot.agentRuns[0]
   if(run&&['failed','succeeded','cancelled'].includes(run.status))break
   await sleep(500)
  }
  proof.failures??=[];proof.failures.push({label,status:run?.status,code:run?.failure?.code,retryable:run?.failure?.retryable,runCount:snapshot.agentRuns.length})
  assert.equal(run?.status,'failed');assert.equal(run.failure.code,expectedCode);assert.equal(run.failure.retryable,false)
  assert(!JSON.stringify(snapshot).includes('fixture-private'),'native errors must not disclose raw service details')
  await sleep(600)
  assert.equal((await core.request('threads.snapshot',{threadId:sent.payload.threadId})).agentRuns.length,1,'native failure must not replay input')
 }
 await failedRequest('unlogged','cline_hub_native_credentials_unavailable')
 assert.deepEqual(await readdir(hosts),[])
 let status=401,calls=0
 const server=createServer((req,res)=>{
  calls++;req.resume();res.writeHead(status,{'content-type':'application/json'})
  res.end(JSON.stringify({error:{message:status===401?'invalid api key fixture-private':'service unavailable fixture-private',type:status===401?'authentication_error':'server_error'}}))
 })
 await new Promise(done=>server.listen(0,'127.0.0.1',done))
 try{
  const endpoint=`http://127.0.0.1:${server.address().port}/v1`
  for(const [label,httpStatus,code] of [['authentication-rejected',401,'cline_hub_native_authentication_failed'],['service-unavailable',503,'cline_hub_native_service_unavailable']]){
   status=httpStatus
   await writeFile(join(settings,'unlogged.json'),JSON.stringify({version:1,lastUsedProvider:'openai-compatible',providers:{'openai-compatible':{settings:{provider:'openai-compatible',model:'native-model',baseUrl:endpoint,apiKey:'isolated-fixture-key'}}}}),{mode:0o600})
   await core.request('runtime.product.check',{runtimeKind:'cline-cli'})
   await failedRequest(label,code)
  }
  proof.loopbackFailureRequests=calls
 }finally{await new Promise(done=>server.close(done))}
 if(values.app||values['login-fixture']){
  // Private selected-CLI fixture owns product login IO/cancellation only. It is
  // not an OAuth qualification and never reads the real account source.
  const fake=join(root,'login-cli-fixture')
  await writeFile(fake,'#!/bin/sh\nif [ "$2" = "--help" ]; then echo "Authenticate --provider"; exit 0; fi\nprintf "%s\\n" "Login https://auth.invalid/?user_code=synthetic" "access_token=fixture-must-not-render"\nIFS= read -r answer\nif [ "$answer" = finish ]; then exit 0; fi\nexec /bin/sleep 60\n',{mode:0o700})
  await writeFile(join(settings,'unlogged.json'),JSON.stringify({nativeFormat:'unknown-to-rovai'}),{mode:0o600})
  const selected=await core.request('runtime.startup.get',{runtimeKind:'cline-cli'})
  await core.request('runtime.startup.save',{runtimeKind:'cline-cli',expectedRevision:selected.revision,configuration:{programPath:fake,environment:[{name:'CLINE_PROVIDER_SETTINGS_PATH',value:join(settings,'unlogged.json')}]}})
  const stored=await core.request('runtime.startup.get',{runtimeKind:'cline-cli'})
  assert.equal(stored.configuration.programPath,fake)
  let login=await core.request('runtime.clineLogin.start')
  for(let i=0;i<100&&!login.output.includes('auth.invalid');i++){await sleep(30);login=await core.request('runtime.clineLogin.read',{attemptId:login.attemptId})}
  proof.loginObservation={status:login.status,outputBytes:login.output.length,syntheticLinkPresent:login.output.includes('auth.invalid')}
  assert(login.output.includes('auth.invalid'));assert(!login.output.includes('fixture-must-not-render'))
  await core.request('runtime.clineLogin.input',{attemptId:login.attemptId,input:'continue'})
  login=await core.request('runtime.clineLogin.cancel',{attemptId:login.attemptId})
  assert.equal(login.status,'cancelled');assert.equal(login.output,'')
  login=await core.request('runtime.clineLogin.start')
  await core.request('runtime.clineLogin.input',{attemptId:login.attemptId,input:'finish'})
  for(let i=0;i<100&&login.status==='running';i++){await sleep(30);login=await core.request('runtime.clineLogin.read',{attemptId:login.attemptId})}
  assert.equal(login.status,'completed');assert.equal(login.output,'')
  await core.request('runtime.clineLogin.start')
  proof.loginFixture={packagedRendererToCore:Boolean(values.app),selectedAbsoluteProgram:true,explicitStart:true,privateOutputRedacted:true,input:true,cancel:true,subsequentCompletion:true,realOAuth:false}
 }
 proof.sourceChanged=await digest(join(source,'providers.json'))!==before
 proof.nativeWriteAuthorized=true;proof.passed=true
}finally{
 await core.stop()
 proof.hostTempRemaining=await readdir(hosts)
 if(proof.loginFixture){assert.deepEqual(proof.hostTempRemaining,[]);proof.loginFixture.shutdownActiveLogin=true}
 proof.runtimeFilesRemoved=await removeEphemeralRuntimeCampFilesRoot(data,{temporaryDirectory:root})
 proof.providerCopiesCreated=false
 await writeFile(join(root,'evidence.json'),JSON.stringify(proof,null,2),{mode:0o600})
 console.log(JSON.stringify(proof))
}
