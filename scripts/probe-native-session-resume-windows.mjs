// Native Windows counterpart of probe-native-session-resume.mjs.
// Private roots contain auth copies and exact native-history backups. Do not publish them.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { zstdDecompressSync } from 'node:zlib'
import { configureSub2api } from './lib/native-resume-sub2api.mjs'
import { startQualificationCore, processTable, descendantsOf, waitForProcessIdentitiesToExit } from './lib/qualification-core.mjs'
import { composerDocumentForAddress } from './lib/create-configured-camp.mjs'
assert.equal(process.platform, 'win32', 'Native Windows only; never WSL')
const repo = resolve(import.meta.dirname, '..'), kind = process.argv[2], outputRoot = resolve(process.argv[3])
const coreExecutable = join(repo, 'target/debug/rovai-core.exe')
const sourceHome = homedir(), local = process.env.LOCALAPPDATA, roaming = process.env.APPDATA
const specs = {
  'codex-cli': ['codex', 'ROVAI_CODEX_BIN', 'CODEX_HOME', '.codex', ['config.toml','auth.json']],
  'claude-code-cli': ['claude', 'ROVAI_CLAUDE_CODE_BIN', 'CLAUDE_CONFIG_DIR', '.claude', ['settings.json','settings.local.json','config.json','.credentials.json']],
  'pi': ['pi', 'ROVAI_PI_BIN', 'PI_CODING_AGENT_DIR', '.pi/agent', ['auth.json','settings.json','models.json','models-store.json']],
  'copilot-cli': ['copilot','ROVAI_COPILOT_BIN','COPILOT_HOME','.copilot',['config.json','settings.json','permissions-config.json']],
  'qwen-code': ['qwen','ROVAI_QWEN_BIN','QWEN_HOME','.qwen',['settings.json','oauth_creds.json','installation_id']],
  'qoder-cli': ['qodercli','ROVAI_QODER_BIN','QODER_CONFIG_DIR','.qoder',['settings.json','state.json','.auth','.models','security']],
  'codebuddy-cli': ['codebuddy','ROVAI_CODEBUDDY_BIN','CODEBUDDY_CONFIG_DIR','.codebuddy',['settings.json','user-state.json','models.json']],
  'kimi-code-cli': ['kimi','ROVAI_KIMI_BIN','KIMI_CODE_HOME','.kimi-code',['config.toml','device_id','credentials']],
  'grok-build': ['grok','ROVAI_GROK_BIN','GROK_HOME','.grok',['config.toml','managed_config.toml','requirements.toml','.env','agent_id']],
  'kiro-cli': ['kiro-cli','ROVAI_KIRO_BIN','KIRO_HOME','.kiro',['settings','agents']],
  'opencode-cli': ['opencode','ROVAI_OPENCODE_BIN'],
  'trae-cn-cli': ['trae-cli','ROVAI_TRAE_CN_BIN'],
  'deepseek-harness': ['dsh','ROVAI_DEEPSEEK_HARNESS_BIN','DSH_HOME','.dsh',['.credentials.yaml','settings.yaml','.env','cordis.patch.yml','profiles']],
  'antigravity-app': ['agy','ROVAI_ANTIGRAVITY_BIN'],
  'zcode-app': ['zcode','ROVAI_ZCODE_BIN']
}
const spec = specs[kind]; assert.ok(spec, 'Unsupported or excluded Adapter')
const fixture = join(outputRoot, kind), project = join(fixture,'project with spaces'), native = join(fixture,'native')
const reproduceReplacementFailure=process.argv.includes('--reproduce-replacement-failure')
const continueMissing=process.argv.includes('--continue-missing')||reproduceReplacementFailure
assert.ok(isAbsolute(fixture)); assert.ok(continueMissing || !(await stat(fixture).catch(()=>null)), 'New fixture required; no implicit retries')
const prepared = spawnSync(coreExecutable, ['--prepare-windows-data-root', fixture], {encoding:'utf8',windowsHide:true})
assert.equal(prepared.status,0,prepared.stderr)
const layout=JSON.parse(prepared.stdout), data=resolve(layout.core)
if(!continueMissing){await mkdir(project); await mkdir(native)}
const wirePath=join(fixture,'wire.jsonl'), stagePath=join(fixture,'stage.txt')
let stage='setup', core, campId
const base=spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).stdout.trim()
const coreSha256=createHash('sha256').update(await readFile(coreExecutable)).digest('hex')
const result=continueMissing?JSON.parse(await readFile(join(fixture,'result.json'),'utf8')):{adapter:kind,platform:'windows-x64',base,
  coreSha256,fixture,data,project,stages:[],shutdowns:[],startedAt:new Date().toISOString()}
const notifications=result.notifications??[]
if(continueMissing){
  assert.equal(result.base,base,'A different source revision requires a fresh fixture')
  assert.equal(result.coreSha256,coreSha256,'A different Core build requires a fresh fixture')
  if(reproduceReplacementFailure){
    const missing=result.stages.find(s=>s.stage==='missing');assert.equal(kind,'copilot-cli');assert.ok(result.finishedAt&&result.historyRemoved&&missing?.status==='failed'&&!missing.timedOut&&missing.businessInputCount===0&&missing.input.every(x=>x.status!=='accepted'),'Only confirmed unsubmitted failed replacement may be examined with a new input')
  }else assert.ok(result.finishedAt&&!result.historyRemoved&&!result.stages.some(s=>s.stage==='missing'),'Only a completed cold run before deletion may continue');
  campId=result.campId;result.priorFailure=result.failure;delete result.failure;delete result.finishedAt
}
async function save(){await writeFile(join(fixture,'result.json'),JSON.stringify({...result,notifications},null,2))}
async function copyOptional(source,target){
  if(continueMissing)return
  try{const meta=await lstat(source);assert.ok(!meta.isSymbolicLink(),'Refuse redirected config');await mkdir(dirname(target),{recursive:true});
    if(meta.isDirectory())await cp(source,target,{recursive:true,filter:p=>!p.split(sep).includes('node_modules')});else await copyFile(source,target)
  }catch(e){if(e.code!=='ENOENT')throw e}
}
function setEnv(key,value){for(const k of Object.keys(process.env))if(k.toLowerCase()===key.toLowerCase())delete process.env[k];process.env[key]=value}
const priorEnv={...process.env}
for(const key of Object.keys(process.env))if(key.startsWith('ROVAI_'))delete process.env[key]
async function setStage(s){stage=s;await writeFile(stagePath,s)}
function query(sql,...params){const db=new DatabaseSync(join(data,'rovai.sqlite'),{readOnly:true});try{return db.prepare(sql).all(...params)}finally{db.close()}}
async function wire(){try{return(await readFile(wirePath,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)}catch(e){if(e.code==='ENOENT')return[];throw e}}
async function startCore(){core=startQualificationCore({coreExecutable,dataDirectory:data,workingDirectory:project,runtimeCacheDirectory:join(fixture,'cache'),mcpConfigPath:join(data,'mcp.json'),onNotification:m=>{if(['agent_run.started','agent_run.native_session_bound','agent_run.native_session_continuity_lost','agent_run.terminal','error'].includes(m.method))notifications.push({stage,...m})}});const health=await core.request('health.check');result.platformAdmission=health.runtimePlatformAdmission;result.hostPlatform=health.hostPlatform}
async function stopCore(){if(!core)return;const corePid=core.pid,table=await processTable(),pids=new Set([corePid,...descendantsOf(table,corePid)]),identities=table.filter(p=>pids.has(p.pid));
  const stopped=await core.stop();await writeFile(join(fixture,stage+'-stderr.txt'),stopped.stderrTail??'');core=null;
  const remaining=await waitForProcessIdentitiesToExit(identities,15000);result.shutdowns.push({stage,corePid,code:stopped.code,identities,remaining});assert.equal(remaining.length,0,'Test children remain; deletion prohibited')}
async function waitUntil(fn,timeout=150000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,250))}throw Error('Timed out: '+stage)}
async function send(label){await setStage(label);const previousId=query('SELECT native_session_id AS id FROM conversation WHERE camp_id=? AND agent_id=?',campId,'agent_2')[0]?.id;
  const count=query('SELECT COUNT(*) AS n FROM agent_run WHERE camp_id=?',campId)[0].n;
  const sent=await core.request('thread.messages.send',{commandId:crypto.randomUUID(),threadId:campId,
    content:composerDocumentForAddress({mode:'explicit',agentIds:['agent_2']},`这是授权的隔离恢复验收，新输入编号 ${crypto.randomUUID()}。不要调用工具或改动文件。只回复 WIN_RESUME_${label.toUpperCase()}_OK。`),sourceAttachments:[],quotes:[],replyToThreadMessageId:null,
    execution:{taskId:null,purpose:'Native Windows session resume acceptance',completionRole:'required'}});
  assert.equal(sent.commandResult.status,'accepted');let run,timedOut=false;
  const latest=()=>query('SELECT id,status,version,last_error_code,last_error_details_ref FROM agent_run WHERE camp_id=? ORDER BY rowid DESC LIMIT 1',campId)[0];
  try{run=await waitUntil(()=>query('SELECT COUNT(*) AS n FROM agent_run WHERE camp_id=?',campId)[0].n>count&&['succeeded','failed','cancelled'].includes(latest()?.status)?latest():false)}
  catch(e){timedOut=true;run=latest();if(run&&!['succeeded','failed','cancelled'].includes(run.status))await core.request('agentRuns.cancel',{commandId:crypto.randomUUID(),command:{campId,agentRunId:run.id,expectedVersion:run.version}});run=await waitUntil(()=>['succeeded','failed','cancelled'].includes(latest()?.status)?latest():false,20000)}
  const currentId=query('SELECT native_session_id AS id FROM conversation WHERE camp_id=? AND agent_id=?',campId,'agent_2')[0]?.id;
  const requests=(await wire()).filter(r=>r.stage===label);
  const row={stage:label,status:run.status,error:run.last_error_code,detailsRef:run.last_error_details_ref,runId:run.id,timedOut,previousId,currentId,
    input:query('SELECT status FROM runtime_input_delivery WHERE agent_run_id=?',run.id),
    noticeCount:query("SELECT COUNT(*) AS n FROM event_log WHERE entity_id=? AND event_type='agent_run.native_session_continuity_lost'",run.id)[0].n,
    businessInputCount:requests.filter(r=>r.direction==='in'&&r.businessMarkers?.includes(`WIN_RESUME_${label.toUpperCase()}_OK`)&&['session/prompt','turn/start','prompt','user','v4/command','user_input'].includes(r.method)).length,requests};
  result.stages.push(row);await save();console.log(JSON.stringify({adapter:kind,stage:label,status:row.status,originalId:previousId?previousId===currentId:null,inputCount:row.businessInputCount,error:row.error}));return row}
function contained(path,root){const rel=relative(resolve(root),resolve(path));return rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)}
async function exactFiles(root,id,found=[]){
  for(const entry of await readdir(root,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return[];throw e})){
    if(entry.isSymbolicLink())continue;const p=join(root,entry.name)
    if(entry.isDirectory()){if(['node_modules','cache','logs','.git'].includes(entry.name))continue;await exactFiles(p,id,found)}
    else if(entry.isFile()&&(/\.(json|jsonl|jsonl.zstd)$/.test(entry.name))){
      // Select by parsed exact native identity, never by a filename or ID substring.
      const meta=await stat(p);if(meta.size>32*1024*1024)continue
      const bytes=await readFile(p),text=entry.name.endsWith('.zstd')?zstdDecompressSync(bytes).toString('utf8'):bytes.toString('utf8');let records=[];try{records=[JSON.parse(text)]}catch{records=text.split('\n').filter(Boolean).slice(0,12).flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}})}
      const owns=records.some(v=>[v.id,v.sessionId,v.session_id,v.payload?.id,v.header?.id].includes(id))
      const cwd=records.some(v=>[v.cwd,v.projectRoot,v.metadata?.cwd,v.payload?.cwd].some(x=>typeof x==='string'&&resolve(x)===resolve(project)))
      if(owns)found.push({path:p,cwdVerified:cwd})
    }
  }return found
}
async function removeHistory(id){
  assert.ok(!core,'Stop Core first');assert.ok(result.shutdowns.length&&result.shutdowns.every(s=>s.remaining.length===0));
  const seed=result.stages.find(s=>s.stage==='seed'),cold=result.stages.find(s=>s.stage==='cold');assert.equal(seed.status,'succeeded');assert.ok(!seed.previousId);assert.equal(seed.currentId,id);assert.equal(cold.status,'succeeded');assert.equal(cold.currentId,id);
  assert.equal(query('SELECT native_session_id AS id FROM conversation WHERE camp_id=? AND agent_id=?',campId,'agent_2')[0].id,id)
  let files=[];
  if(kind==='grok-build'){
    const matches=(await exactFiles(native,id)).filter(f=>basename(f.path)==='events.jsonl'&&basename(dirname(f.path))===id);
    assert.equal(matches.length,1,'Exactly one native Grok session directory required');const target=dirname(matches[0].path);
    const context=JSON.parse(await readFile(join(target,'prompt_context.json'),'utf8'));assert.equal(resolve(context.working_directory),resolve(project));
    files=[{path:target,cwdVerified:true}]
  }else if(kind==='copilot-cli'){
    const root=join(native,'session-state'),target=join(root,id),header=JSON.parse((await readFile(join(target,'events.jsonl'),'utf8')).split('\n')[0]);
    assert.equal(header.type,'session.start');assert.equal(header.data.sessionId,id);assert.equal(resolve(header.data.context.cwd),resolve(project));files=[{path:target,cwdVerified:true}]
  }else if(kind==='trae-cn-cli'){
    const root=join(result.provider?.isolatedLocal??local,'trae-cli','sessions'),target=join(root,id),meta=JSON.parse(await readFile(join(target,'session.json'),'utf8'));
    assert.equal(meta.id,id);assert.equal(resolve(meta.metadata.cwd),resolve(project));files=[{path:target,cwdVerified:true,sharedRoot:root}]
  }else if(kind==='antigravity-app'){
    const root=join(sourceHome,'.gemini','antigravity-cli','conversations'),target=join(root,id+'.db');
    const db=new DatabaseSync(target,{readOnly:true});try{const ids=db.prepare('SELECT cascade_id FROM trajectory_meta').all();assert.equal(ids.length,1);assert.equal(ids[0].cascade_id,id)}finally{db.close()}
    for(const suffix of['','-wal','-shm'])if(await stat(target+suffix).catch(()=>null))files.push({path:target+suffix,sharedRoot:root})
  }else if(['opencode-cli','zcode-app'].includes(kind)){
    const dbpath=kind==='zcode-app'?join(native,'sessions.sqlite'):join(native,'data','opencode','opencode.db');
    const protocol=await wire();const db=new DatabaseSync(dbpath,{readOnly:true});try{
      const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
      const table=tables.includes('session_v2')?'session_v2':'session';
      const rows=db.prepare(`SELECT id,directory FROM ${table} WHERE parent_id IS NULL`).all();
      const target=rows.find(r=>r.id===id);assert.ok(target,'Exact bound Session must exist in private database');assert.equal(resolve(target.directory),resolve(project));
      for(const row of rows.filter(r=>r.id!==id))assert.ok(protocol.some(r=>r.stage==='discovery'&&r.direction==='out'&&r.resultSessionId===row.id&&resolve(r.cwd)===resolve(row.directory)),'Every other root must be an observed probe created in this private store');
      result.isolatedDatabaseRoots=rows
    }finally{db.close()}
    for(const suffix of['','-wal','-shm'])if(await stat(dbpath+suffix).catch(()=>null))files.push({path:dbpath+suffix,cwdVerified:true})
  }else{files=await exactFiles(native,id);assert.ok(files.length,'No exact native identity found in isolated history; no deletion')}
  result.deletionManifest=[];await mkdir(join(fixture,'removed-history'))
  for(const [i,f]of files.entries()){
    assert.ok(contained(f.path,f.sharedRoot??native));assert.equal(resolve(await realpath(f.path)).toLowerCase(),resolve(f.path).toLowerCase());assert.ok(!(await lstat(f.path)).isSymbolicLink());
    const backup=join(fixture,'removed-history',String(i)+'-'+basename(f.path));await cp(f.path,backup,{recursive:true,dereference:false});result.deletionManifest.push({...f,backup,sessionId:id});
  }
  await save();
  // All exact targets and backups are verified before any removal; no shared root/database deletion.
  for(const f of files)await rm(f.path,{recursive:true});result.historyRemoved=true;await save()
}
try{
  let executable=kind==='zcode-app'?join(local,'Programs','ZCode','ZCode.exe'):
    spawnSync('where.exe',[spec[0]],{encoding:'utf8',windowsHide:true}).stdout?.trim().split(/\r?\n/).find(p=>/\.(exe|cmd)$/i.test(p));
  assert.ok(executable&&await stat(executable).catch(()=>null),'Not installed');result.executable=executable;
  let target=executable,prefix=[],extraEnv={};
  if(kind==='pi') {target=process.execPath;prefix=[join(roaming,'npm','node_modules','@earendil-works','pi-coding-agent','dist','bundle','cli.js')]}
  if(kind==='deepseek-harness'){target=process.execPath;prefix=[join(roaming,'npm','node_modules','@deepseek-ai','dsh','lib','bin.js')]}
  if(kind==='qwen-code'&&executable.endsWith('.cmd')){const base=join(local,'qwen-code','qwen-code');target=join(base,'node','node.exe');prefix=[join(base,'lib','cli-entry.js')];extraEnv.QWEN_CODE_LAUNCHER_PATH=join(base,'bin','qwen.cmd')}
  if(kind==='zcode-app'){target=process.execPath;result.officialAppVersion=spawnSync('powershell.exe',['-NoProfile','-Command',`(Get-Item -LiteralPath '${executable.replaceAll("'","''")}').VersionInfo.ProductVersion`],{encoding:'utf8',windowsHide:true}).stdout.trim()}
  const version=kind==='zcode-app'?null:spawnSync(target,[...prefix,'--version'],{encoding:'utf8',windowsHide:true,timeout:15000});result.version=version?(version.stdout||version.stderr||'').trim().slice(0,200):result.officialAppVersion;
  result.resolvedLaunch={target,prefix};result.executableSha256=createHash('sha256').update(await readFile(executable)).digest('hex');
  if(spec[2]){const source=priorEnv[spec[2]]||join(sourceHome,spec[3]);for(const name of spec[4])await copyOptional(join(source,name),join(native,name));setEnv(spec[2],native)}
  if(kind==='claude-code-cli')await copyOptional(join(sourceHome,'.claude.json'),join(native,'.claude.json'))
  if(kind==='qwen-code')setEnv('QWEN_RUNTIME_DIR',native)
  if(kind==='opencode-cli'){
    for(const [key,dir]of[['XDG_CONFIG_HOME','config'],['XDG_DATA_HOME','data'],['XDG_STATE_HOME','state'],['XDG_CACHE_HOME','cache']])setEnv(key,join(native,dir));
    for(const name of['opencode.json','opencode.jsonc','cli.json'])await copyOptional(join(sourceHome,'.config','opencode',name),join(native,'config','opencode',name));
    await copyOptional(join(sourceHome,'.local/share/opencode/auth.json'),join(native,'data/opencode/auth.json'))
  }
  if(kind==='zcode-app'){setEnv('ZCODE_STORAGE_DIR',native);setEnv('ZCODE_SESSION_DB_PATH',join(native,'sessions.sqlite'));setEnv('ZCODE_DATA_BASE_DIR',native);for(const name of['config.json','setting.json','provider_config.json'])await copyOptional(join(sourceHome,'.zcode/v2',name),join(native,'.zcode/v2',name))}
  if(process.argv.includes('--sub2api'))result.provider=await configureSub2api(kind,native,setEnv)
  for(const s of Object.values(specs))setEnv(s[1],join(fixture,'not-installed.exe'));
  for(const key of['ROVAI_CURSOR_BIN','ROVAI_CLINE_BIN','ROVAI_COMMAND_CODE_BIN'])setEnv(key,join(fixture,'not-installed.exe'));
  const wrapper=join(fixture,'runtime-wire-proxy.exe');await copyFile(join(repo,'scripts/lib/native-resume-wire-proxy.mjs'),join(fixture,'proxy.mjs'));
  await writeFile(join(fixture,'proxy-config.json'),JSON.stringify({target,prefix,env:extraEnv,stagePath,wirePath}));
  await copyFile(join(repo,'target/native-resume-launcher.exe'),wrapper);await writeFile(join(fixture,'node-path.txt'),process.execPath);
  if(kind==='zcode-app'){setEnv(spec[1],executable);setEnv('ROVAI_ZCODE_NODE_BIN',process.execPath);await copyFile(join(repo,'scripts/lib/native-resume-zcode-tap.cjs'),join(fixture,'zcode-tap.cjs'));setEnv('NODE_OPTIONS',`${priorEnv.NODE_OPTIONS??''} --require "${join(fixture,'zcode-tap.cjs').replaceAll('\\','/')}"`)}else setEnv(spec[1],wrapper);
  spawnSync('git',['init','-b','main'],{cwd:project,windowsHide:true});await writeFile(join(project,'README.md'),'# Disposable native Windows acceptance\n');
  console.log(JSON.stringify({adapter:kind,version:result.version,channel:'automatic-acceptance',data,skills:join(data,'managed-skill-library'),mcp:join(data,'mcp.json')}));
  if(continueMissing){
    const cold=result.stages.find(s=>s.stage==='cold');assert.equal(cold?.status,'succeeded');
    assert.equal(query('SELECT status FROM agent_run WHERE camp_id=? ORDER BY rowid DESC LIMIT 1',campId)[0]?.status,reproduceReplacementFailure?'failed':'succeeded');
    const identities=result.shutdowns.flatMap(s=>s.identities);assert.equal((await waitForProcessIdentitiesToExit(identities,1000)).length,0);
    if(reproduceReplacementFailure){
      await setStage('replacement-check-start');await startCore();const check=await send('replacement_check');
      result.replacementFailureReproduced=check.status==='failed'&&check.businessInputCount===0&&check.previousId===check.currentId&&check.noticeCount===0;
      if(result.replacementFailureReproduced)process.exitCode=1
    }else{await removeHistory(cold.currentId);await setStage('missing-start');await startCore();await send('missing')}
  }else{
  await setStage('discovery');await startCore();await core.request('runtime.discovery.rescan',{interactiveShell:false});
  const installations=await core.request('runtime.installations.list');result.installations=installations.filter(r=>r.adapterKind===kind);
  try { await core.request('runtime.product.check',{runtimeKind:kind}) }
  catch(error) { result.checkFailure=error.message; await save() }
  const installation=await waitUntil(async()=>{const row=(await core.request('runtime.installations.list')).find(r=>r.adapterKind===kind&&r.installationClass==='managed_default'&&r.authScope==='default');return row?.memberRuntimeDefaults&&(!result.provider?.memberModel||row.snapshot?.probeStatus==='ready')?row:false},90000);
  result.installation=installation;
  const profile=await core.request('members.get',{agentId:'agent_2'});
  const configured=await core.request('members.runtime.set',{commandId:crypto.randomUUID(),command:{agentId:'agent_2',expectedVersion:profile.version,adapterKind:kind,model:result.provider?.memberModel??{mode:'runtime_default'},permissions:installation.memberRuntimeDefaults.permissions}});assert.equal(configured.status,'applied',JSON.stringify(configured));
  const camp=await core.request('threads.create',{commandId:crypto.randomUUID(),name:kind+' Windows resume',workspace:{projectPath:project},memberAgentIds:['agent_2'],defaultLeadAgentId:'agent_2',collaborationMode:'peer'});assert.equal(camp.status,'applied',JSON.stringify(camp));campId=camp.payload.threadId;result.campId=campId;
  const seed=await send('seed');assert.ok(seed.status==='succeeded'&&seed.currentId,'Seed did not establish a successful native Session');
  await send('warm');await stopCore();await setStage('cold-start');await startCore();const cold=await send('cold');await stopCore();
  assert.equal(cold.status,'succeeded','Cold did not succeed; preserve native history');assert.equal(cold.currentId,seed.currentId,'Cold changed binding; preserve history');
  assert.ok(cold.requests.some(r=>(r.direction==='in'&&['thread/resume','session/load','session/resume','switch_session'].includes(r.method)&&(r.sessionId===seed.currentId||r.sessionPath?.includes(seed.currentId)))||(r.direction==='launch'&&r.resumeArgument===seed.currentId)),'No observed exact-ID cold call; preserve history');
  await removeHistory(seed.currentId);await setStage('missing-start');await startCore();await send('missing');
  }
}catch(error){result.failure={stage,message:error.message};console.log(JSON.stringify({adapter:kind,stage,failure:error.message}))}
finally{try{await stopCore()}catch(e){result.cleanupFailure=e.message}result.finishedAt=new Date().toISOString();await save()}
