// Opt-in real Core crash/restart acceptance; no model input is submitted.
import assert from 'node:assert/strict'
import {mkdir,copyFile,chmod,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {startQualificationCore} from '../../../../scripts/lib/qualification-core.mjs'
import {seedCompletedOnboardingForAcceptance} from '../../../../scripts/lib/dev-desktop.mjs'
import {removeEphemeralRuntimeCampFilesRoot} from '../../../../scripts/lib/runtime-camp-files-root.mjs'
const {values}=parseArgs({options:{root:{type:'string'},core:{type:'string'},cline:{type:'string'},'settings-source':{type:'string'}}})
for(const key of ['root','core','cline','settings-source'])assert(values[key],`${key} required`)
const root=resolve(values.root),source=resolve(values['settings-source']),cli=resolve(values.cline)
await mkdir(root,{mode:0o700})
const data=join(root,'core-data'),workspace=join(root,'workspace'),native=join(root,'native'),settings=join(native,'data/settings'),hosts=join(data,'runtime/cline-hub/hosts')
await mkdir(workspace,{mode:0o700});await mkdir(settings,{recursive:true,mode:0o700});seedCompletedOnboardingForAcceptance(data)
for(const name of ['providers.json','models.json']){await copyFile(join(source,name),join(settings,name));await chmod(join(settings,name),0o600)}
await writeFile(join(settings,'global-settings.json'),JSON.stringify({telemetryOptOut:true,autoUpdateEnabled:false}),{mode:0o600})
await writeFile(join(data,'mcp.json'),'{"mcpServers":{}}',{mode:0o600})
const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex')
const before=await digest(join(source,'providers.json'))
for(const key of Object.keys(process.env))if(/^(ROVAI_|CLINE_)/.test(key))delete process.env[key]
const start=()=>startQualificationCore({coreExecutable:resolve(values.core),dataDirectory:data,workingDirectory:workspace,runtimeCacheDirectory:join(root,'cache'),mcpConfigPath:join(data,'mcp.json')})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
let core=start(),daemonPid
const proof={kind:'interrupted-native-hub-diagnostic-recovery',modelInputs:0}
try{
 await core.request('health.check')
 const current=await core.request('runtime.startup.get',{runtimeKind:'cline-cli'})
 await core.request('runtime.startup.save',{runtimeKind:'cline-cli',expectedRevision:current.revision,configuration:{programPath:cli,environment:[{name:'CLINE_DIR',value:native},{name:'CLINE_DATA_DIR',value:join(native,'data')}]}})
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
 core=start();await core.request('health.check')
 const old=spawnSync('ps',['-p',String(daemonPid),'-o','stat='],{encoding:'utf8'})
 assert(old.status!==0||old.stdout.trim().startsWith('Z'),'restart must reap the exact native daemon')
 assert.deepEqual(await readdir(hosts),[])
 proof.restartReapedNative=true;proof.privateHostRemoved=true
 await core.request('runtime.product.check',{runtimeKind:'cline-cli'})
 const install=(await core.request('runtime.installations.list')).find(i=>i.adapterKind==='cline-cli'&&i.installationClass==='managed_default')
 assert.equal(install.snapshot.probeStatus,'ready');assert(install.snapshot.protocols.includes('cline-hub-v1'))
 proof.normalDiagnosticAfterRecovery='ready'
 assert.equal(await digest(join(source,'providers.json')),before)
 assert.equal(await digest(join(settings,'providers.json')),before)
 proof.sourceUnchanged=true;proof.passed=true
}finally{
 await core.stop()
 proof.hostTempRemaining=await readdir(hosts)
 proof.runtimeFilesRemoved=await removeEphemeralRuntimeCampFilesRoot(data,{temporaryDirectory:root})
 await rm(join(settings,'providers.json'),{force:true});proof.privateProviderCopyRemoved=true
 await writeFile(join(root,'evidence.json'),JSON.stringify(proof,null,2),{mode:0o600})
 console.log(JSON.stringify(proof))
}
