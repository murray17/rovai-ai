import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { launchHost } from './lib/host-test-client.mjs'
import { pause } from './lib/host-web-browser.mjs'
import { coreDataDirectoryArguments } from './lib/runtime-camp-files-root.mjs'
import { isolatedFileReferenceRuntimeEnvironment, configureFileReferenceRuntime } from './lib/project-file-reference-runtime-env.mjs'
if (!process.argv.includes('--real-runtime')) throw Error('Explicit --real-runtime is required (paid model calls; six file-read inputs or eight file/directory location inputs).')
const repository = resolve(import.meta.dirname, '..')
const directoryCases = process.argv.includes('--directory-cases')
const identityCases = directoryCases || process.argv.includes('--identity-cases')
const sameNameOnly = process.argv.includes('--same-name-only')
if (sameNameOnly && !identityCases) throw Error('--same-name-only requires file or directory identity cases')
const resumeIndex = process.argv.indexOf(directoryCases ? '--remaining-directory-cases' : identityCases ? '--remaining-identity-cases' : '--remaining-live-cases')
const resume = resumeIndex >= 0 ? resolve(process.argv[resumeIndex+1]) : null
if (identityCases && process.argv.includes('--remaining-live-cases')) throw Error('Complex-location cases cannot resume or rewrite the original file-read evidence.')
const plannedInputs = sameNameOnly ? 2 : identityCases ? 8 : 6
const fixtureIndex = process.argv.indexOf('--fixture')
const explicitFixture = fixtureIndex >= 0 ? resolve(process.argv[fixtureIndex+1]) : null
if(explicitFixture&&!resume)assert.equal((await readdir(explicitFixture)).length,0,'Explicit fixture must be empty')
const fixture = resume ?? explicitFixture ?? await realpath(await mkdtemp(join(tmpdir(), 'rovai-file-reference-runtime-')))
const report = resume ? JSON.parse(await readFile(join(fixture,'private-evidence.json'),'utf8')) : { fixture, realRuntime:true, cases:[], qualification:[], startedAt:new Date().toISOString() }
if (resume && identityCases) {
  assert.equal(report.scope,directoryCases ? 'directory-locations' : 'complex-file-locations')
  assert.ok(report.cases.every(item=>item.success),'Only resume an interrupted fixture with no failed model cases')
  report.interruptions=[...(report.interruptions??[]),{error:report.error,completed:report.cases.map(item=>item.case),resumedAt:new Date().toISOString()}]
  delete report.error
}
report.scope = directoryCases ? 'directory-locations' : identityCases ? 'complex-file-locations' : 'original-R1-matrix'
report.caseSubset = sameNameOnly ? 'same-name' : 'all'
const data = join(fixture,'data'), project = join(fixture,'project'), binaries = join(fixture,'bin')
for(const directory of [data, project, binaries])await mkdir(directory,{mode:0o700,recursive:true})
for(const name of ['rovai-host','rovai'])await cp(join(repository,'target/debug',name),join(binaries,name))
const native = await isolatedFileReferenceRuntimeEnvironment(fixture)
const host = launchHost(join(binaries,'rovai-host'), [...coreDataDirectoryArguments(data),'--skill-library-root',join(data,'skills'),'--mcp-config-path',join(data,'mcp.json')], {cwd:repository,env:native.env})
console.log(JSON.stringify({channel:'automatic_acceptance',fixture,data,skills:join(data,'skills'),mcp:join(data,'mcp.json'),nativeHomes:'private fixture only',realRuntime:true,plannedInputs,scope:report.scope}))
const active = new Map()
const wait = async(probe,label,timeout=240000)=>{const until=Date.now()+timeout;while(Date.now()<until){const found=await probe();if(found)return found;await pause(500)}throw Error('Timed out: '+label)}
const snapshot = threadId=>host.request('threads.open',{threadId,traceId:randomUUID()})
const reference = async(threadId,path)=>{
  const resolved=await host.request('projectFiles.request',{threadId,action:'resolve'});assert.equal(resolved.ok,true)
  const scopeId=resolved.value.scopeId
  try{
    const opened=await host.request('projectFiles.request',{threadId,action:'open',scopeId,entryId:'p:'+Buffer.from(path).toString('base64url')});assert.equal(opened.ok,true)
    const confirmed=await host.request('projectFileReferences.resolve',{threadId,references:[{threadId,rawReference:opened.value.rawReference,...(opened.value.targetKind?{targetKind:opened.value.targetKind}:{})}]})
    assert.equal(confirmed.value[0].status,'available');return {kind:'atom',atom:confirmed.value[0].reference}
  }finally{await host.request('projectFiles.request',{threadId,action:'release',scopeId})}
}
let db
try{
  await host.ready
  db=new DatabaseSync(join(data,'rovai.sqlite'),{readOnly:true})
  const profiles=await host.request('members.list')
  const configured=resume&&!identityCases?[{kind:'codex-cli',agentId:profiles[0].agentId}]:[]
  for(const [index,kind]of (resume&&!identityCases?[]:['codex-cli','claude-code-cli']).entries()){
    try{
      const member=await configureFileReferenceRuntime(host.request.bind(host),kind,profiles[index].agentId)
      report.qualification.push({kind,status:member.runtimeReadiness.status,model:member.runtimeConfiguration.model})
      configured.push({kind,agentId:member.agentId})
    }catch(error){report.qualification.push({kind,status:'unavailable',error:String(error.message)});throw error}
  }
  const create=async(runtime,name)=>{
    const result=await host.request('threads.create',{commandId:randomUUID(),name,workspace:{projectPath:project},memberAgentIds:[runtime.agentId],defaultLeadAgentId:runtime.agentId,collaborationMode:'peer',activationState:'pending'})
    assert.equal(result.status,'applied');return result.payload.threadId
  }
  const input=async(runtime,threadId,segments,caseName)=>{
    const before=(await snapshot(threadId)).agentRuns.map(run=>run.id)
    const commandId=randomUUID()
    const result=await host.request('thread.messages.send',{commandId,threadId,content:{version:2,segments},execution:{taskId:null,purpose:'Project file read acceptance',completionRole:'required',budget:null}})
    assert.notEqual(result.commandResult.status,'rejected',caseName+': '+result.commandResult.code)
    const messageId=result.commandResult.payload.threadMessageId
    assert.ok(messageId)
    const message=(await snapshot(threadId)).messages.find(message=>message.id===messageId)
    const setup = caseName.startsWith('I3-prepare-')
    assert.equal(message.content.some(segment=>segment.kind==='project_file_reference'),!setup)
    const candidate={case:caseName,runtime:runtime.kind,threadId,messageId,bodyProjection:message.body,content:message.content,setup,success:false}
    report.cases.push(candidate)
    candidate.wait=async()=>{
      const run=await wait(async()=>{
        const current=await snapshot(threadId)
        const run=current.agentRuns.find(run=>!before.includes(run.id))
        if(!run)return null
        active.set(run.id,{threadId,run})
        for(const approval of current.approvals.filter(approval=>approval.agentRunId===run.id&&approval.status==='pending')){
          const option=approval.options.find(option=>option.kind==='allow_once')
          if(option)await host.request('action.approvals.resolve',{commandId:randomUUID(),threadId,approvalId:approval.id,expectedVersion:approval.version,optionId:option.optionId,reason:'Isolated project-file read acceptance'})
        }
        return ['succeeded','failed','cancelled','interrupted'].includes(run.status)?run:null
      },caseName+' completion')
      active.delete(run.id);candidate.runId=run.id;candidate.status=run.status
      candidate.workspace=JSON.parse(db.prepare('SELECT workspace_json FROM agent_run WHERE id=?').get(run.id).workspace_json)
      candidate.runtimeVersion=db.prepare('SELECT runtime_initial_reported_version AS initial, runtime_reported_version AS observed FROM agent_run WHERE id=?').get(run.id)
      const current=await snapshot(threadId)
      candidate.reply=current.messages.filter(message=>message.sourceAgentRunId===run.id).map(message=>message.body).join('\n')
      const manifests=db.prepare('SELECT b.storage_relative_path FROM context_manifest m JOIN managed_blob b ON b.id=m.rendered_payload_blob_id WHERE m.agent_run_id=? ORDER BY m.created_at').all(run.id)
      candidate.frozenInputs=[]
      for(const row of manifests)candidate.frozenInputs.push(await readFile(join(data,'managed-blobs',row.storage_relative_path),'utf8'))
      if (!setup) assert.equal(candidate.frozenInputs.some(text=>text.includes('file:')),true,caseName+' URI survives actual input freezing')
      return candidate
    }
    return candidate
  }
  if (identityCases) {
    const hooks=join(fixture,'empty-hooks');await mkdir(hooks,{recursive:true})
    const git=(...args)=>execFileSync('git',['-c',`core.hooksPath=${hooks}`,'-c','commit.gpgsign=false','-C',project,...args],{encoding:'utf8'}).trim()
    if (!resume) {
      execFileSync('git',['init',project],{stdio:'ignore'})
      await writeFile(join(project,'tracked.txt'),'private acceptance repository\n')
      git('add','.');git('-c','user.name=Reference acceptance','-c','user.email=reference@example.invalid','commit','-m','fixture')
    }
    const done=name=>report.cases.some(item=>item.case===name&&item.success)
    const verify = async (runtime, threadId, relative, path, selected, decoy, name) => {
      const segment=await reference(threadId,relative)
      const work=await input(runtime,threadId,[{kind:'text',text:directoryCases ? 'List the referenced directory with your file tools, then read its marker.txt and report its NONCE. Read only that directory. Do not edit files or delegate. ' : 'Read only the referenced file with your file tools and report its NONCE. Do not edit files or delegate. '},segment],name)
      const result=await work.wait();assert.equal(result.status,'succeeded');assert.ok(result.reply.includes(selected));assert.ok(!result.reply.includes(decoy));assert.ok(!result.bodyProjection.includes(selected)&&!result.bodyProjection.includes(decoy))
      assert.equal(result.content.find(segment=>segment.kind==='project_file_reference').pathAtSend,await realpath(path))
      if(directoryCases){assert.equal(result.content.find(segment=>segment.kind==='project_file_reference').targetKind,'directory');assert.ok(result.bodyProjection.includes('/)'))}
      const shortName=relative.split('/').at(-1)
      assert.ok(result.bodyProjection.includes(`[${shortName}](`),'Body uses the short name')
      assert.ok(result.frozenInputs.some(text=>text.includes(`[${shortName}](`)),'Short name survives input freezing')
      assert.ok(result.frozenInputs.every(text=>!text.includes(selected)&&!text.includes(decoy)),'File contents are not injected')
      result.expectedPath=await realpath(path);result.selectedNonce=selected;result.decoyNonce=decoy;result.success=true
      return result
    }
    for(const runtime of configured){
      const suffix=runtime.kind.startsWith('codex')?'codex':'claude'
      for(const directory of ['src/auth','src/billing','src/中文 目录'])await mkdir(join(project,directory),{recursive:true})
      let selected=randomBytes(12).toString('hex'),decoy=randomBytes(12).toString('hex')
      if (!done('I1-same-name-'+suffix)) {
      if(directoryCases){await mkdir(join(project,'src/auth/config'),{recursive:true});await writeFile(join(project,'src/auth/config/marker.txt'),decoy)}else await writeFile(join(project,'src/auth/config.ts'),`export const NONCE = '${decoy}'\n`)
      if(directoryCases){await mkdir(join(project,'src/billing/config'),{recursive:true});await writeFile(join(project,'src/billing/config/marker.txt'),selected)}else await writeFile(join(project,'src/billing/config.ts'),`export const NONCE = '${selected}'\n`)
      await verify(runtime,await create(runtime,'Same-name file identity '+suffix),directoryCases?'src/billing/config':'src/billing/config.ts',join(project,directoryCases?'src/billing/config':'src/billing/config.ts'),selected,decoy,'I1-same-name-'+suffix)
      }
      if (sameNameOnly) continue
      if (!done('I2-special-path-'+suffix)) {
      selected=randomBytes(12).toString('hex');decoy=randomBytes(12).toString('hex')
      const special=directoryCases?'src/中文 目录/参数 (草稿)#1':'src/中文 目录/参数 (草稿)#1.ts'
      if(directoryCases){await mkdir(join(project,special),{recursive:true});await writeFile(join(project,special,'marker.txt'),selected)}else await writeFile(join(project,special),`export const NONCE = '${selected}'\n`)
      await writeFile(join(project,'src/中文 目录/参数 (草稿)1.ts'),`export const NONCE = '${decoy}'\n`)
      await verify(runtime,await create(runtime,'Special-path file identity '+suffix),special,join(project,special),selected,decoy,'I2-special-path-'+suffix)
      }
      if (done('I3-worktree-'+suffix)) continue
      const mission=await host.request('missions.create',{commandId:randomUUID(),command:{title:'Worktree file identity '+suffix,description:'When I provide a file reference in the next message, read only that referenced file and report its NONCE. For now, briefly say you are ready. Do not read or edit project files or delegate.',projectPath:project,projectBindingKind:'directory',memberAgentIds:[runtime.agentId],defaultLeadAgentId:runtime.agentId,tags:[]}})
      assert.equal(mission.status,'applied')
      const threadId=mission.payload.threadId
      // A real queued Mission task prepares its workspace through the normal dispatcher.
      // Count this preparation separately from the six file-read tasks; never seed a ready row.
      const prepare=await input(runtime,threadId,[{kind:'text',text:'Read the Mission description, then briefly confirm you are ready for the file I will supply next. Do not read or edit project files or delegate.'}],'I3-prepare-'+suffix)
      const ready=await prepare.wait();assert.equal(ready.status,'succeeded');ready.success=true
      const workspace=db.prepare("SELECT state,working_directory FROM mission_workspace WHERE mission_id=?").get(mission.payload.missionId)
      assert.equal(workspace?.state,'ready');assert.notEqual(workspace.working_directory,project)
      selected=randomBytes(12).toString('hex');decoy=randomBytes(12).toString('hex')
      if(directoryCases){await mkdir(join(project,'config'),{recursive:true});await writeFile(join(project,'config/marker.txt'),decoy)}else await writeFile(join(project,'config.ts'),`export const NONCE = '${decoy}'\n`)
      if(directoryCases){await mkdir(join(workspace.working_directory,'config'),{recursive:true});await writeFile(join(workspace.working_directory,'config/marker.txt'),selected)}else await writeFile(join(workspace.working_directory,directoryCases?'config':'config.ts'),`export const NONCE = '${selected}'\n`)
      const file=await reference(threadId,directoryCases?'config':'config.ts'),work=await input(runtime,threadId,directoryCases?[{kind:'text',text:'List the referenced directory and read its marker.txt with your file tools; report the NONCE. Do not edit or delegate. '},file]:[file],'I3-worktree-'+suffix),result=await work.wait()
      assert.equal(result.status,'succeeded');assert.ok(result.reply.includes(selected));assert.ok(!result.reply.includes(decoy));assert.ok(!result.bodyProjection.includes(selected)&&!result.bodyProjection.includes(decoy))
      assert.equal(result.content.find(segment=>segment.kind==='project_file_reference').pathAtSend,await realpath(join(workspace.working_directory,directoryCases?'config':'config.ts')))
      result.expectedPath=await realpath(join(workspace.working_directory,directoryCases?'config':'config.ts'));result.selectedNonce=selected;result.decoyNonce=decoy;result.sourceDirectory=project;result.success=true
      console.log(JSON.stringify({completed:['I1-same-name-'+suffix,'I2-special-path-'+suffix,'I3-worktree-'+suffix],runtime:runtime.kind,correctSelectedNonce:true}))
    }
  }
  if(!resume && !identityCases) {
  for(const runtime of configured){
    const suffix=runtime.kind.startsWith('codex')?'codex':'claude'
    const a=randomBytes(12).toString('hex'),b=randomBytes(12).toString('hex'),log=randomBytes(12).toString('hex')
    await writeFile(join(project,`${suffix}-one.txt`),'NONCE_ONE='+a+'\n');await writeFile(join(project,`${suffix}-two.txt`),'NONCE_TWO='+b+'\n');await writeFile(join(project,`${suffix}-log.txt`),'LOG_NONCE='+log+'\n')
    const threadId=await create(runtime,'Project file real read '+suffix)
    const first=await input(runtime,threadId,[{kind:'text',text:'Read both referenced files with your file tools and report their NONCE values to this conversation. Do not edit files. After that, when I provide a log file in the next message, read it and report LOG_NONCE. Ask me to provide that log. '},await reference(threadId,`${suffix}-one.txt`),{kind:'text',text:' '},await reference(threadId,`${suffix}-two.txt`)],'Read-files-'+suffix)
    const result=await first.wait();assert.equal(result.status,'succeeded');assert.ok(result.reply.includes(a)&&result.reply.includes(b),'Actual file nonce values must appear in reply');assert.ok(!result.bodyProjection.includes(a)&&!result.bodyProjection.includes(b),'File bytes are absent from user body');result.success=true
    const follow=await input(runtime,threadId,[await reference(threadId,`${suffix}-log.txt`)],'Follow-up-file-'+suffix)
    const followResult=await follow.wait();assert.equal(followResult.status,'succeeded');assert.ok(followResult.reply.includes(log));followResult.success=true
    console.log(JSON.stringify({completed:[result.case,followResult.case],runtime:runtime.kind,nonceRead:true}))
  }
  }
  if (!identityCases) {
  const runtime=configured[0]
  for(const failure of [false,true]){
    const name=failure?'unreadable.txt':'live.txt', gate=failure?'read-error.ready':'live.ready', old=randomBytes(12).toString('hex'),next=randomBytes(12).toString('hex')
    await writeFile(join(project,name),'NONCE='+old+'\n')
    const threadId=await create(runtime,'File live/read-error acceptance')
    const request=await input(runtime,threadId,[{kind:'text',text:`First use your shell tool to wait up to 30 seconds for ${join(project,gate)} to exist. Only after the gate exists, read the referenced file and report its NONCE. If reading fails, report the real error and do not change permissions, retry alternate paths, or modify any files. `},await reference(threadId,name)],failure?'Read-permission-error':'Live-content')
    if(failure)await chmod(join(project,name),0);else await writeFile(join(project,name),'NONCE='+next+'\n')
    await writeFile(join(project,gate),'ready\n')
    const result=await request.wait()
    if(failure){assert.match(result.reply,/permission|denied|权限|读取失败|无法读取/iu);assert.equal((await stat(join(project,name))).mode&0o777,0);await chmod(join(project,name),0o600)}else{assert.equal(result.status,'succeeded');assert.ok(result.reply.includes(next));assert.ok(!result.reply.includes(old))}
    const original=(await snapshot(threadId)).messages.find(message=>message.id===result.messageId)
    assert.equal(original.body,result.bodyProjection);result.success=true
  }
  }
  report.success=report.cases.length===plannedInputs&&report.cases.every(item=>item.success)
}catch(error){report.error=String(error.message);report.success=false;throw error}
finally{
  for(const [runId,{threadId}]of active){try{const run=(await snapshot(threadId)).agentRuns.find(run=>run.id===runId);if(run)await host.request('agentRuns.cancel',{commandId:randomUUID(),command:{threadId,agentRunId:runId,expectedVersion:run.version}})}catch{}}
  // Export only file-related native tool calls/results; thinking blocks are deliberately excluded.
  const tools=[]
  const scan=async directory=>{let entries;try{entries=await readdir(directory,{withFileTypes:true})}catch{return}for(const entry of entries){const path=join(directory,entry.name);if(entry.isDirectory())await scan(path);else if(entry.name.endsWith('.jsonl')){for(const line of(await readFile(path,'utf8')).split('\n')){try{const record=JSON.parse(line);const payload=record.payload??record;const type=payload.type;if(['function_call','function_call_output'].includes(type)){tools.push(payload)}else for(const content of record.message?.content??[]){if(['tool_use','tool_result'].includes(content.type))tools.push(content)}}catch{}}}}}
  await scan(join(fixture,'native-codex','sessions'));await scan(join(fixture,'native-claude','projects'))
  report.toolEvidence=[...(resume?report.toolEvidence??[]:[]),...tools]
  if (db) {
    // Select tool input/result evidence only. Narration, steps, and reasoning are not exported.
    const load = async (preview, blobId) => {
      if (!blobId) return JSON.parse(preview ?? '{}')
      const blob = db.prepare('SELECT storage_relative_path FROM managed_blob WHERE id=?').get(blobId)
      return blob ? JSON.parse(await readFile(join(data,'managed-blobs',blob.storage_relative_path),'utf8')) : JSON.parse(preview ?? '{}')
    }
    report.coreToolEvidence = []
    for (const item of report.cases) if (item.runId) {
      for (const row of db.prepare("SELECT sequence,kind,input_preview_json,input_blob_id,result_preview_json,result_blob_id FROM agent_run_execution_evidence WHERE agent_run_id=? AND kind IN ('command','tool_result') ORDER BY sequence").all(item.runId)) {
        const input=await load(row.input_preview_json,row.input_blob_id),result=await load(row.result_preview_json,row.result_blob_id)
        if (!/\.(?:txt|ts)\b|NONCE|permission denied/iu.test(JSON.stringify({input,result}))) continue
        report.coreToolEvidence.push({case:item.case,runtime:item.runtime,sequence:row.sequence,kind:row.kind,input,result})
      }
    }
  }
  for(const item of report.cases)delete item.wait
  await writeFile(join(fixture,'private-evidence.json'),JSON.stringify(report,null,2),{mode:0o600})
  console.log(JSON.stringify({fixture,success:report.success,cases:report.cases.map(({case:name,runtime,status,success})=>({name,runtime,status,success})),nativeToolRecords:tools.length,error:report.error??null}))
  db?.close();await host.close();await native.cleanup()
}
