import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { launchHost } from './lib/host-test-client.mjs'
import { pause } from './lib/host-web-browser.mjs'
import { coreDataDirectoryArguments } from './lib/runtime-camp-files-root.mjs'
import { isolatedFileReferenceRuntimeEnvironment, configureFileReferenceRuntime } from './lib/project-file-reference-runtime-env.mjs'
if (!process.argv.includes('--real-runtime')) throw Error('Explicit --real-runtime is required (paid model calls, seven planned task inputs).')
const repository = resolve(import.meta.dirname, '..')
const resumeIndex = process.argv.indexOf('--remaining-live-cases')
const resume = resumeIndex >= 0 ? resolve(process.argv[resumeIndex+1]) : null
const fixture = resume ?? await realpath(await mkdtemp(join(tmpdir(), 'rovai-file-reference-runtime-')))
const data = join(fixture,'data'), project = join(fixture,'project'), binaries = join(fixture,'bin')
for(const directory of [data, project, binaries])await mkdir(directory,{mode:0o700,recursive:true})
for(const name of ['rovai-host','rovai'])await cp(join(repository,'target/debug',name),join(binaries,name))
const native = await isolatedFileReferenceRuntimeEnvironment(fixture)
const host = launchHost(join(binaries,'rovai-host'), [...coreDataDirectoryArguments(data),'--skill-library-root',join(data,'skills'),'--mcp-config-path',join(data,'mcp.json')], {cwd:repository,env:native.env})
const report = resume ? JSON.parse(await readFile(join(fixture,'private-evidence.json'),'utf8')) : { fixture, realRuntime:true, cases:[], qualification:[], startedAt:new Date().toISOString() }
console.log(JSON.stringify({channel:'automatic_acceptance',fixture,data,skills:join(data,'skills'),mcp:join(data,'mcp.json'),nativeHomes:'private fixture only',realRuntime:true,plannedInputs:7}))
const active = new Map()
const wait = async(probe,label,timeout=240000)=>{const until=Date.now()+timeout;while(Date.now()<until){const found=await probe();if(found)return found;await pause(500)}throw Error('Timed out: '+label)}
const snapshot = threadId=>host.request('threads.open',{threadId,traceId:randomUUID()})
const reference = async(threadId,path)=>{
  const resolved=await host.request('projectFiles.request',{threadId,action:'resolve'});assert.equal(resolved.ok,true)
  const scopeId=resolved.value.scopeId
  try{
    const opened=await host.request('projectFiles.request',{threadId,action:'open',scopeId,entryId:'p:'+Buffer.from(path).toString('base64url')});assert.equal(opened.ok,true)
    const confirmed=await host.request('projectFileReferences.resolve',{threadId,references:[{threadId,rawReference:opened.value.rawReference}]})
    assert.equal(confirmed.value[0].status,'available');return {kind:'atom',atom:confirmed.value[0].reference}
  }finally{await host.request('projectFiles.request',{threadId,action:'release',scopeId})}
}
let db
try{
  await host.ready
  db=new DatabaseSync(join(data,'rovai.sqlite'),{readOnly:true})
  const profiles=await host.request('members.list')
  const configured=resume?[{kind:'codex-cli',agentId:profiles[0].agentId}]:[]
  for(const [index,kind]of (resume?[]:['codex-cli','claude-code-cli']).entries()){
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
    assert.ok(message.content.some(segment=>segment.kind==='project_file_reference'))
    const candidate={case:caseName,runtime:runtime.kind,threadId,messageId,bodyProjection:message.body,content:message.content,success:false}
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
      candidate.runtimeVersion=db.prepare('SELECT runtime_initial_reported_version AS initial, runtime_reported_version AS observed FROM agent_run WHERE id=?').get(run.id)
      const current=await snapshot(threadId)
      candidate.reply=current.messages.filter(message=>message.sourceAgentRunId===run.id).map(message=>message.body).join('\n')
      const manifests=db.prepare('SELECT b.storage_relative_path FROM context_manifest m JOIN managed_blob b ON b.id=m.rendered_payload_blob_id WHERE m.agent_run_id=? ORDER BY m.created_at').all(run.id)
      candidate.frozenInputs=[]
      for(const row of manifests)candidate.frozenInputs.push(await readFile(join(data,'managed-blobs',row.storage_relative_path),'utf8'))
      assert.equal(candidate.frozenInputs.some(text=>text.includes('file:')),true,caseName+' URI survives actual input freezing')
      return candidate
    }
    return candidate
  }
  if(!resume) {
  for(const runtime of configured){
    const suffix=runtime.kind.startsWith('codex')?'codex':'claude'
    const a=randomBytes(12).toString('hex'),b=randomBytes(12).toString('hex'),log=randomBytes(12).toString('hex')
    await writeFile(join(project,`${suffix}-one.txt`),'NONCE_ONE='+a+'\n');await writeFile(join(project,`${suffix}-two.txt`),'NONCE_TWO='+b+'\n');await writeFile(join(project,`${suffix}-log.txt`),'LOG_NONCE='+log+'\n')
    const threadId=await create(runtime,'Project file real read '+suffix)
    const first=await input(runtime,threadId,[{kind:'text',text:'Read both referenced files with your file tools and report their NONCE values to this conversation. Do not edit files. After that, when I provide a log file in the next message, read it and report LOG_NONCE. Ask me to provide that log. '},await reference(threadId,`${suffix}-one.txt`),{kind:'text',text:' '},await reference(threadId,`${suffix}-two.txt`)],'R1-'+suffix)
    const result=await first.wait();assert.equal(result.status,'succeeded');assert.ok(result.reply.includes(a)&&result.reply.includes(b),'Actual file nonce values must appear in reply');assert.ok(!result.bodyProjection.includes(a)&&!result.bodyProjection.includes(b),'File bytes are absent from user body');result.success=true
    const follow=await input(runtime,threadId,[await reference(threadId,`${suffix}-log.txt`)],'R2-file-only-'+suffix)
    const followResult=await follow.wait();assert.equal(followResult.status,'succeeded');assert.ok(followResult.reply.includes(log));followResult.success=true
    console.log(JSON.stringify({completed:[result.case,followResult.case],runtime:runtime.kind,nonceRead:true}))
  }
  const runtime=configured[0]
  const unknown=await create(runtime,'File only without task')
  await writeFile(join(project,'unassigned.txt'),'An unrelated fixture. No work has been requested.\n')
  const unclear=await input(runtime,unknown,[await reference(unknown,'unassigned.txt')],'R3-new-file-only')
  const unclearResult=await unclear.wait();assert.equal(unclearResult.status,'succeeded')
  assert.match(unclearResult.reply,/[?？]|需要|what|would|please.*task/iu);assert.equal(await readFile(join(project,'unassigned.txt'),'utf8'),'An unrelated fixture. No work has been requested.\n');unclearResult.success=true
  }
  const runtime=configured[0]
  for(const failure of [false,true]){
    const name=failure?'unreadable.txt':'live.txt', gate=failure?'read-error.ready':'live.ready', old=randomBytes(12).toString('hex'),next=randomBytes(12).toString('hex')
    await writeFile(join(project,name),'NONCE='+old+'\n')
    const threadId=await create(runtime,'File live/read-error acceptance')
    const request=await input(runtime,threadId,[{kind:'text',text:`First use your shell tool to wait up to 30 seconds for ${join(project,gate)} to exist. Only after the gate exists, read the referenced file and report its NONCE. If reading fails, report the real error and do not change permissions, retry alternate paths, or modify any files. `},await reference(threadId,name)],failure?'R4-permission-error':'R4-live-content')
    if(failure)await chmod(join(project,name),0);else await writeFile(join(project,name),'NONCE='+next+'\n')
    await writeFile(join(project,gate),'ready\n')
    const result=await request.wait()
    if(failure){assert.match(result.reply,/permission|denied|权限|读取失败|无法读取/iu);assert.equal((await stat(join(project,name))).mode&0o777,0);await chmod(join(project,name),0o600)}else{assert.equal(result.status,'succeeded');assert.ok(result.reply.includes(next));assert.ok(!result.reply.includes(old))}
    const original=(await snapshot(threadId)).messages.find(message=>message.id===result.messageId)
    assert.equal(original.body,result.bodyProjection);result.success=true
  }
  report.success=report.cases.length===7&&report.cases.every(item=>item.success)
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
        if (!/\.txt|NONCE|permission denied/iu.test(JSON.stringify({input,result}))) continue
        report.coreToolEvidence.push({case:item.case,runtime:item.runtime,sequence:row.sequence,kind:row.kind,input,result})
      }
    }
  }
  for(const item of report.cases)delete item.wait
  await writeFile(join(fixture,'private-evidence.json'),JSON.stringify(report,null,2),{mode:0o600})
  console.log(JSON.stringify({fixture,success:report.success,cases:report.cases.map(({case:name,runtime,status,success})=>({name,runtime,status,success})),nativeToolRecords:tools.length,error:report.error??null}))
  db?.close();await host.close();await native.cleanup()
}
