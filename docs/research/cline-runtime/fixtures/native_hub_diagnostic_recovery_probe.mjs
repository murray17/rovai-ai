// Opt-in real Core crash/restart acceptance; no model input is submitted.
import assert from 'node:assert/strict'
import {mkdir,copyFile,chmod,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {createHash} from 'node:crypto'
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
for(const name of values['native-account']?[]:['providers.json','models.json']){await copyFile(join(source,name),join(settings,name));await chmod(join(settings,name),0o600)}
await writeFile(join(settings,'global-settings.json'),JSON.stringify({telemetryOptOut:true,autoUpdateEnabled:false}),{mode:0o600})
await writeFile(join(data,'mcp.json'),'{"mcpServers":{}}',{mode:0o600})
const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex')
const before=await digest(join(source,'providers.json'))
for(const key of Object.keys(process.env))if(/^(ROVAI_|CLINE_)/.test(key)||(values['native-account']&&/^OPENAI_/.test(key)))delete process.env[key]
const start=async()=>values.app?await startPackagedHubAcceptance({app:resolve(values.app),data,cwd:workspace}):startQualificationCore({coreExecutable:resolve(values.core),dataDirectory:data,workingDirectory:workspace,runtimeCacheDirectory:join(root,'cache'),mcpConfigPath:join(data,'mcp.json')})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const environment=[{name:'CLINE_DIR',value:native},{name:'CLINE_DATA_DIR',value:join(native,'data')},...(values['native-account']?[{name:'CLINE_PROVIDER_SETTINGS_PATH',value:join(source,'providers.json')}]:[])]
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
 // Fail after private provider/settings copies are written, before a daemon
 // starts. Repeated diagnostics must leave no unmarked credential directory.
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
 assert.equal(auth.lastProbeAttempt.failureClass,'authentication_required')
 assert.equal(auth.lastProbeAttempt.failure.code,'cline_hub_native_not_logged_in')
 const health=await core.request('health.check')
 const availability=health.runtimeAvailability.find(i=>i.runtimeKind==='cline-cli')
 assert.equal(availability.failure.code,'cline_hub_native_not_logged_in')
 assert(availability.failure.summary.includes('尚未登录'))
 assert.deepEqual(await readdir(hosts),[])
 proof.unloggedExplicit=true
 if(values.app||values['login-fixture']){
  // Private selected-CLI fixture owns product login IO/cancellation only. It is
  // not an OAuth qualification and never reads the real account source.
  const fake=join(root,'login-cli-fixture')
  await writeFile(fake,'#!/bin/sh\nif [ "$2" = "--help" ]; then echo "Authenticate --provider"; exit 0; fi\nprintf "%s\\n" "Login https://auth.invalid/?user_code=synthetic" "access_token=fixture-must-not-render"\nIFS= read -r answer\nif [ "$answer" = finish ]; then exit 0; fi\nexec /bin/sleep 60\n',{mode:0o700})
  await writeFile(join(settings,'unlogged.json'),JSON.stringify({version:1,lastUsedProvider:'openai-codex',providers:{'openai-codex':{tokenSource:'oauth',settings:{provider:'openai-codex',auth:{accountId:'synthetic-account'}}}}}),{mode:0o600})
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
 if(!values['native-account'])assert.equal(proof.sourceChanged,false)
 proof.nativeWriteAuthorized=values['native-account'];proof.passed=true
}finally{
 await core.stop()
 proof.hostTempRemaining=await readdir(hosts)
 if(proof.loginFixture){assert.deepEqual(proof.hostTempRemaining,[]);proof.loginFixture.shutdownActiveLogin=true}
 proof.runtimeFilesRemoved=await removeEphemeralRuntimeCampFilesRoot(data,{temporaryDirectory:root})
 await rm(join(settings,'providers.json'),{force:true});proof.privateProviderCopyRemoved=true
 await writeFile(join(root,'evidence.json'),JSON.stringify(proof,null,2),{mode:0o600})
 console.log(JSON.stringify(proof))
}
