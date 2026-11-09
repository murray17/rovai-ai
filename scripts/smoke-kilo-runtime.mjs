// Real Core + official Kilo, using a local deterministic Provider and owned data.
// ROVAI_KILO_BIN=/absolute/path/to/kilo node scripts/smoke-kilo-runtime.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, realpath, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { isolatedKiloEnvironment } from './lib/isolated-kilo-environment.mjs'
import { createConfiguredCampAndSend, composerDocumentForAddress } from './lib/create-configured-camp.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

const executable = process.env.ROVAI_KILO_BIN
assert(executable && isAbsolute(executable), 'ROVAI_KILO_BIN must select an absolute official CLI')
const repo = resolve(import.meta.dirname, '..')
const root = await realpath(process.env.ROVAI_KILO_SMOKE_ROOT ?? await mkdtemp(join(tmpdir(), 'rovai-kilo-core-')))
for (const part of ['home','project','core','config','data','member-data','cache','state','evidence','service']) await mkdir(join(root,part))
const project = join(root,'project'), data = join(root,'core')
const startedFile = join(project,'cancel-started'), lateFile = join(project,'cancel-late')
const quote = s => "'"+s.replaceAll("'","'\\''")+"'"
let approvalDecision = 'allow_once'
let enterBusy, releaseBusy
const busyEntered = new Promise(resolve=>{enterBusy=resolve})
const busyGate = new Promise(resolve=>{releaseBusy=resolve})
const bootstrapChecks=[]
const calls = [], events = [], result = { root, platform:process.platform+'-'+process.arch, checks:{} }
const provider = createServer((req,res)=>{
  serve(req,res).catch(error=>{result.fixtureError=error.stack;res.writeHead(500);res.end('Fixture provider failed')})
})
async function serve(req,res) {
  let text='';for await(const chunk of req)text+=chunk
  const body=JSON.parse(text);calls.push(body)
  const nativeSystem=body.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n')
  const source=nativeSystem.match(/Instructions from: (.+\/bootstrap\.md)\n/)?.[1]
  if(body.tools?.length) {
    const frozen=source?await readFile(source,'utf8'):''
    bootstrapChecks.push({index:calls.length-1,bytes:Buffer.byteLength(frozen),verbatim:!!source&&nativeSystem.includes('Instructions from: '+source+'\n'+frozen)})
  }
  await writeFile(join(root,'evidence','model-requests.json'),JSON.stringify(calls,null,2))
  const message=[...body.messages].reverse().find(m=>m.role==='user')
  const content=typeof message?.content==='string'?message.content:JSON.stringify(message?.content)
  let delta={role:'assistant',content:'KILO_CORE_PUBLIC'},finish='stop'
  if(body.messages.at(-1)?.role!=='tool' && content?.includes('CORE_MCP')) {
    const tool=body.tools?.find(tool=>tool.function.name.includes('kilo_review')&&tool.function.name.endsWith('echo'))
    assert(tool,'Assigned MCP tool must be visible')
    delta={role:'assistant',tool_calls:[{index:0,id:'call_mcp_'+calls.length,type:'function',function:{name:tool.function.name,arguments:'{"text":"CORE_MCP_MARKER"}'}}]};finish='tool_calls'
  } else if(body.messages.at(-1)?.role!=='tool' && content?.includes('CORE_WRITE') && body.tools?.some(t=>t.function.name==='write')) {
    const filename=content.includes('CORE_WRITE_ALLOW')?'allowed.txt':'denied.txt'
    delta={role:'assistant',tool_calls:[{index:0,id:'call_write_'+calls.length,type:'function',function:{name:'write',arguments:JSON.stringify({filePath:join(project,filename),content:'KILO_WRITE_OK'})}}]};finish='tool_calls'
  } else if(body.messages.at(-1)?.role!=='tool' && body.tools?.some(t=>t.function.name==='bash')) {
    let command
    if(content?.includes('CORE_FIRST_CLI')) command="printf KILO_CORE_STDOUT; rovai send --public-only --body KILO_CORE_CLI"
    else if(content?.includes('CORE_PERMISSION_')) {
      const label=content.match(/CORE_PERMISSION_(FILE|INLINE|AGENT)/)[1]
      command='printf KILO_'+label+'_BLOCKED > '+quote(join(project,label.toLowerCase()+'-blocked.txt'))
    }
    else if(content?.includes('CORE_CANCEL')) command="printf STARTED > "+quote(startedFile)+"; sleep 5; printf LATE > "+quote(lateFile)
    if(command){delta={role:'assistant',tool_calls:[{index:0,id:'call_core_'+calls.length,type:'function',function:{name:'bash',arguments:JSON.stringify({command,description:'Kilo Core integration probe'})}}]};finish='tool_calls'}
  }
  if(body.messages.at(-1)?.role==='tool' && content?.includes('CORE_MCP_BUSY')) { enterBusy(); await busyGate }
  // Hold the first generation so optional baseline I/O can finish, then keep
  // a later generation active across a sampling tick after another tool step.
  if(content?.includes('CORE_FIRST_CLI') && body.tools?.length) {
    if(body.messages.at(-1)?.role==='tool' && !body.messages.some(message=>message.tool_calls?.some(tool=>tool.id.startsWith('call_sample_')))) {
      delta={role:'assistant',tool_calls:[{index:0,id:'call_sample_'+calls.length,type:'function',function:{name:'bash',arguments:JSON.stringify({command:'printf KILO_NATIVE_SAMPLE',description:'Keep numeric sampling independent of the first baseline'})}}]};finish='tool_calls'
    } else await new Promise(resolve=>setTimeout(resolve,8500))
  }
  const base={id:'kilo-core-'+calls.length,object:'chat.completion.chunk',created:1,model:'local-model'}
  res.writeHead(200,{'content-type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta,finish_reason:null}]})+'\n\n')
  res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:25}}})+'\n\n')
  res.end('data: [DONE]\n\n')
}
await new Promise(r=>provider.listen(0,'127.0.0.1',r))
await mkdir(join(root,'config','kilo'))
await writeFile(join(root,'config','kilo','kilo.json'),JSON.stringify({permission:{bash:{'printf *':'allow','* KILO_FILE_BLOCKED*':'deny'}}}))
await writeFile(join(root,'canary.txt'),'INHERITED_KILO_CONFIG_CANARY')
await writeFile(join(root,'canary.json'),JSON.stringify({instructions:[join(root,'canary.txt')]}))
process.env.KILO_CONFIG=join(root,'canary.json')
process.env.KILO_CONFIG_DIR=join(root,'inherited-config')
process.env.KILO_DB=':memory:'
const config={permission:{bash:{'printf *':'allow','* KILO_INLINE_BLOCKED*':'deny'}},
  agent:{build:{permission:{bash:{'printf KILO_AGENT*':'allow','* KILO_AGENT_BLOCKED*':'deny'}}}},autoupdate:false,share:'disabled',enabled_providers:['local'],model:'local/local-model',small_model:'local/local-model',
  provider:{local:{name:'Local smoke',npm:'@ai-sdk/openai-compatible',env:[],options:{apiKey:'fixture-key',baseURL:'http://127.0.0.1:'+provider.address().port+'/v1'},
    models:{'local-model':{name:'Local model',tool_call:true,variants:{low:{temperature:0.1},high:{temperature:0.8}},cost:{input:1,output:2,cache_read:0.5,cache_write:1},limit:{context:32768,output:2048}}}}}}
const environment={...isolatedKiloEnvironment(root),ROVAI_KILO_BIN:executable,
  XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),XDG_STATE_HOME:join(root,'state'),
  KILO_CONFIG_CONTENT:JSON.stringify(config),KILO_CLIENT:'acp',KILO_DISABLE_AUTOUPDATE:'1',
  KILO_DISABLE_MODELS_FETCH:'1',KILO_DISABLE_EXTERNAL_SKILLS:'1',KILO_DISABLE_CLAUDE_CODE:'1',
  KILO_DISABLE_DEFAULT_PLUGINS:'1',KILO_DISABLE_LSP_DOWNLOAD:'1',KILO_EXPERIMENTAL_DISABLE_FILEWATCHER:'1'}
let core, index=0
async function openCore(){
  const child=spawn(join(repo,'target/debug/rovai-core'),[...coreDataDirectoryArguments(data,{homeDirectory:join(root,'home')}),'--skill-library-root',join(data,'managed-skill-library'),'--mcp-config-path',join(data,'mcp.json')],{cwd:repo,env:environment,stdio:['pipe','pipe','pipe']})
  const pending=new Map();let id=0,stderr='',closePromise,ended=false
  const closed=new Promise(r=>child.once('close',(code,signal)=>{ended=true;r({code,signal})}))
  child.stderr.on('data',b=>stderr=(stderr+b).slice(-64000))
  const rejectAll=error=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(error)}pending.clear()}
  child.once('error',rejectAll);child.once('exit',(code,signal)=>rejectAll(new Error('Core exited '+code+'/'+signal+' '+stderr.slice(-3000))))
  createInterface({input:child.stdout}).on('line',line=>{
    const frame=JSON.parse(line);events.push(frame)
    if(frame.method)return
    const p=pending.get(frame.id);if(!p)return
    pending.delete(frame.id);clearTimeout(p.timer);frame.error?p.reject(new Error(p.method+': '+frame.error.message)):p.resolve(frame.result)
  })
  const number=++index
  const client={request(method,params={}){
    return new Promise((resolve,reject)=>{
      const next=++id,timer=setTimeout(()=>{pending.delete(next);reject(new Error('Core request timeout: '+method+' '+stderr.slice(-2000)))},30000)
      pending.set(next,{method,resolve,reject,timer});child.stdin.write(JSON.stringify({id:next,method,params})+'\n')
    })
  },close(){return closePromise??=(async()=>{
    if(!ended)child.stdin.end()
    const timer=setTimeout(()=>child.kill('SIGKILL'),15000)
    const status=await closed;clearTimeout(timer)
    await writeFile(join(root,'evidence','core-'+number+'-stderr.log'),stderr)
    assert.equal(status.code,0,'Core must shut down cleanly: '+stderr.slice(-2000))
  })()}}
  return client
}
const delay=()=>new Promise(r=>setTimeout(r,200))
async function waitForRun(threadId,messageId){
  const deadline=Date.now()+90000, resolvedApprovals=new Set()
  while(Date.now()<deadline){
    const snapshot=await core.request('camps.snapshot',{threadId})
    for(const approval of snapshot.approvals.filter(a=>a.status==='pending'&&!resolvedApprovals.has(a.id))) {
      const option=approval.options.find(o=>o.kind===approvalDecision)
      assert(option,'Missing native approval option '+approvalDecision)
      const receipt=await core.request('action.approvals.resolve',{commandId:crypto.randomUUID(),threadId,approvalId:approval.id,expectedVersion:approval.version,optionId:option.optionId,reason:'Kilo native approval smoke'})
      assert.notEqual(receipt.status,'rejected',JSON.stringify(receipt));resolvedApprovals.add(approval.id)
    }
    const run=snapshot.agentRuns.find(r=>r.triggerThreadMessageId===messageId||r.triggerCampMessageId===messageId)
      ?? snapshot.agentRuns.find(r=>r.id===events.findLast(e=>e.method==='agent_run.created'&&(e.params?.triggerThreadMessageId===messageId||e.params?.triggerCampMessageId===messageId))?.params.agentRunId)
    if(run&&['succeeded','failed','cancelled'].includes(run.status))return {run,snapshot}
    if(snapshot.agentRuns.length && !run) {
      const newest=snapshot.agentRuns.at(0)
      if(newest&&['succeeded','failed','cancelled'].includes(newest.status)&&!result.finishedRuns?.includes(newest.id))return {run:newest,snapshot}
    }
    await delay()
  }
  throw new Error('Run timeout '+messageId)
}
let threadId
async function send(body){
  return core.request('thread.messages.send',{commandId:crypto.randomUUID(),threadId,content:composerDocumentForAddress({mode:'explicit',agentIds:['agent_2']},body),sourceAttachments:[],quotes:[],replyToThreadMessageId:null,execution:{taskId:null,purpose:'Kilo integration smoke',completionRole:'required'}})
}
async function settle(sent){
  const receipt=sent.commandResult??sent
  assert.equal(receipt.status,'accepted',JSON.stringify(receipt))
  const done=await waitForRun(threadId,receipt.payload.threadMessageId)
  assert.equal(done.run.status,'succeeded',JSON.stringify(done.run))
  result.finishedRuns??=[];result.finishedRuns.push(done.run.id)
  const requests=calls.flatMap((body,index)=>{
    const user=body.messages.findLast(message=>message.role==='user')
    return body.tools?.length&&JSON.stringify(user?.content).includes(receipt.payload.threadMessageId)?[index]:[]
  })
  assert(requests.length>0,'Every settled Run must have its current Dynamic Context at the model')
  assert(requests.every(index=>bootstrapChecks.some(check=>check.index===index&&check.verbatim)),'Every Run must receive its current complete Bootstrap')
  result.checks.bootstrapRuns??=[];result.checks.bootstrapRuns.push({run:done.run.id,requests:requests.length})
  const started=events.find(e=>e.method==='agent_run.started'&&e.params?.agentRunId===done.run.id)
  assert(started,'The native input must be accepted')
  return {...done,started:started.params}
}
try{
  console.log(JSON.stringify({channel:'automatic-acceptance',dataDir:data,skillRoot:join(data,'managed-skill-library'),project}))
  core=await openCore()
  await core.request('health.check')
  await configureProductRuntime(core.request.bind(core),'kilo-cli',['agent_2'])
  const profile = await core.request('members.get',{agentId:'agent_2'})
  const configured = await core.request('members.runtime.set',{commandId:crypto.randomUUID(),command:{
    agentId:'agent_2',expectedVersion:profile.version,adapterKind:'kilo-cli',
    model:{mode:'explicit',modelId:'local/local-model',options:{effort:'high'}},permissions:profile.runtimeConfiguration.permissions,
    environment:{expectedRevision:0,json:JSON.stringify({XDG_DATA_HOME:join(root,'member-data'),KILO_DB:'custom.db',KILO_PERMISSION:JSON.stringify({'*':'allow'})})}
  }})
  assert.equal(configured.status,'applied',JSON.stringify(configured))
  assert.equal(environment.KILO_CONFIG,undefined)
  assert.equal(environment.KILO_CONFIG_DIR,undefined)
  assert.equal(environment.KILO_DB,undefined)
  await core.request('runtime.modelCatalog.open',{runtimeKind:'kilo-cli',waitForRefresh:true})
  const installation=(await core.request('runtime.installations.list')).find(installation=>installation.adapterKind==='kilo-cli')
  assert.equal(installation.snapshot.authenticationStatus,'unknown','A non-generating ACP handshake does not validate credentials')
  assert(installation.snapshot.capabilities.includes('context.charter.managed_system_prompt'))
  assert(!installation.snapshot.capabilities.includes('context.charter.first_payload'))
  result.checks.authentication='unknown'
  const workspace=await core.request('workspaces.inspect',{path:project})
  const first=await createConfiguredCampAndSend(core.request.bind(core),{commandId:crypto.randomUUID(),workspace,memberAgentIds:['agent_2'],defaultLeadAgentId:'agent_2',address:{mode:'explicit',agentIds:['agent_2']},body:'CORE_FIRST_CLI',purpose:'Kilo first Run and bundled CLI'})
  threadId=(first.commandResult??first).payload.threadId
  const a=await settle(first)
  const publicMessages=a.snapshot.messages.filter(m=>m.sourceAgentRunId===a.run.id)
  assert.equal(publicMessages.length,1,'Accepted CLI send must suppress a second final message')
  assert(publicMessages[0].body.includes('KILO_CORE_CLI'))
  const command=events.findLast(event=>event.method==='runtime.action'&&event.params?.agentRunId===a.run.id&&event.params?.payload?.status==='completed'&&event.params?.payload?.output?.includes('KILO_CORE_STDOUT'))
  assert.equal(command?.params.payload.output?.split('KILO_CORE_STDOUT').length,2,'Completed command output must contain one stdout marker without repeated snapshots')
  result.checks.commandOutput={source:'runtime.action.payload.output',markerOccurrences:1}
  const firstCall=calls.find(c=>c.tools?.some(t=>t.function.name==='bash')&&JSON.stringify(c.messages).includes('CORE_FIRST_CLI'))
  assert(calls.every(call=>!call.tools?.some(tool=>tool.function.name==='question')),'Unclaimed native questionnaire must remain disabled')
  const system=firstCall.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n')
  const user=firstCall.messages.filter(m=>m.role==='user').at(-1).content
  assert(system.includes('[SESSION_CHARTER]')&&system.includes('[MEMBER_IDENTITY]'),'Full Bootstrap belongs to native system')
  const instructionsPath=system.match(/Instructions from: (.+\/bootstrap\.md)\n/)?.[1]
  assert(instructionsPath,'The native instruction source must identify the Host file')
  const bootstrap=await readFile(instructionsPath,'utf8')
  assert(system.includes('Instructions from: '+instructionsPath+'\n'+bootstrap),'The model must receive the entire Bootstrap file verbatim')
  result.checks.bootstrap={bytes:Buffer.byteLength(bootstrap),nativeSystemVerbatim:true,userDynamicOnly:true}
  assert(!JSON.stringify(user).includes('[SESSION_CHARTER]'),'Ordinary user input must contain only Dynamic Context')
  const b=await settle(await send('CORE_WARM'))
  assert.equal(a.started.hostInstanceId,b.started.hostInstanceId,'Warm input must reuse the resident Host')
  assert.equal(a.started.nativeThreadId,b.started.nativeThreadId,'Warm input must retain the exact native Session')
  result.checks.firstAndWarm={firstRun:a.run.id,warmRun:b.run.id,host:a.started.hostInstanceId,session:a.started.nativeThreadId}
  result.checks.metrics=await core.request('monitoring.execution',{campId:threadId,agentRunIds:[a.run.id,b.run.id]})
  const sampled=result.checks.metrics.runs.find(r=>r.agentRunId===a.run.id)
  assert(sampled?.promptInputTotalTokens>0&&sampled.outputTokens>0,'The shared sampler must observe native per-call counters')
  const nativeDatabase=join(root,'member-data','kilo','custom.db')
  result.checks.nativeUsageDatabase=nativeDatabase
  const metadata=new DatabaseSync(nativeDatabase,{readOnly:true})
  try {
    const variants=metadata.prepare("SELECT json_extract(data,'$.variant') AS variant FROM message WHERE session_id=? AND json_extract(data,'$.role')='assistant'").all(a.started.nativeThreadId)
    assert(variants.some(message=>message.variant==='high'),'Native Session must use the requested effort variant')
    result.checks.effort='high'
  } finally { metadata.close() }
  for(const label of ['FILE','INLINE','AGENT']) {
    const tested=await settle(await send('CORE_PERMISSION_'+label))
    assert.equal(await readFile(join(project,label.toLowerCase()+'-blocked.txt'),'utf8').catch(error=>error.code==='ENOENT'?null:Promise.reject(error)),null,'Native '+label+' deny must win over its earlier allow pattern')
    assert(events.some(event=>event.method==='runtime.action'&&event.params?.agentRunId===tested.run.id&&event.params?.payload?.input?.includes('KILO_'+label+'_BLOCKED')),'The matching native command must actually be attempted')
    result.checks['permission'+label]=tested.run.id
  }
  await core.close()
  core=await openCore();await core.request('health.check')
  const before=calls.length
  const c=await settle(await send('CORE_COLD'))
  assert.equal(c.started.nativeThreadId,a.started.nativeThreadId,'Core restart must preserve exact native ID')
  assert.notEqual(c.started.hostInstanceId,a.started.hostInstanceId,'Cold resume must create a fresh Host')
  assert(calls.slice(before).some(c=>JSON.stringify(c.messages).includes('CORE_WARM')),'Native history must survive Core restart')
  result.checks.cold={run:c.run.id,host:c.started.hostInstanceId,session:c.started.nativeThreadId}
  const startsPath=join(root,'evidence','mcp-starts.jsonl')
  const serverCode="import {appendFileSync} from 'node:fs'; appendFileSync(process.env.STARTS,JSON.stringify({pid:process.pid,cwd:process.cwd(),source:process.env.ROVAI_MCP_SMOKE_SOURCE})+'\\n'); await import("+JSON.stringify(new URL('./crates/rovai-core/tests/fixtures/mcp-smoke-server.mjs','file://'+repo+'/').href)+")"
  const definition=source=>JSON.stringify({mcpServers:{kilo_review:{command:process.execPath,args:['--input-type=module','--eval',serverCode],cwd:join(root,'service'),env:{STARTS:startsPath,ROVAI_MCP_SMOKE_SOURCE:source}}}})
  let mcp=await core.request('mcp.config.get')
  let mutation=await core.request('mcp.servers.create',{expectedConfigDigest:mcp.configDigest,definitionJson:definition('KILO_MCP_A')})
  assert.equal(mutation.status,'ok',JSON.stringify(mutation));mcp=mutation.config
  const serverId=mcp.servers.find(server=>server.name==='kilo_review').serverId
  mutation=await core.request('mcp.servers.setEnabled',{expectedConfigDigest:mcp.configDigest,serverId,enabled:true,acknowledgeHighRisk:true})
  assert.equal(mutation.status,'ok',JSON.stringify(mutation));mcp=mutation.config
  mutation=await core.request('mcp.assignments.set',{expectedConfigDigest:mcp.configDigest,serverId,agentId:'agent_2',assigned:true,acknowledgeHighRisk:true})
  assert.equal(mutation.status,'ok',JSON.stringify(mutation));mcp=mutation.config
  const starts=async()=> (await readFile(startsPath,'utf8')).trim().split('\n').map(JSON.parse)
  const alive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}}
  const dead=async pid=>{const end=Date.now()+5000;while(Date.now()<end&&alive(pid))await delay();assert(!alive(pid),'Retired MCP child must exit')}
  const aMcp=await settle(await send('CORE_MCP_A'))
  const childA=(await starts()).at(-1)
  assert.equal(childA.source,'KILO_MCP_A')
  assert.equal(childA.cwd,join(root,'service'),'MCP explicit cwd must survive ACP projection')
  mutation=await core.request('mcp.servers.update',{expectedConfigDigest:mcp.configDigest,serverId,definitionJson:definition('KILO_MCP_B')})
  assert.equal(mutation.status,'ok',JSON.stringify(mutation));mcp=mutation.config
  await dead(childA.pid)
  const bMcp=await settle(await send('CORE_MCP_B'))
  const childB=(await starts()).at(-1)
  assert.equal(childB.source,'KILO_MCP_B')
  assert.notEqual(bMcp.started.hostInstanceId,aMcp.started.hostInstanceId)
  const active=await send('CORE_MCP_BUSY')
  await Promise.race([busyEntered,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Busy MCP model gate timeout')),10000))])
  mutation=await core.request('mcp.servers.update',{expectedConfigDigest:mcp.configDigest,serverId,definitionJson:definition('KILO_MCP_A')})
  assert.equal(mutation.status,'ok',JSON.stringify(mutation))
  assert(alive(childB.pid),'Busy Host must retain its native child until Run settlement')
  releaseBusy()
  const busy=await settle(active)
  await dead(childB.pid)
  const restored=await settle(await send('CORE_MCP_A_RESTORED'))
  assert.notEqual(restored.started.hostInstanceId,aMcp.started.hostInstanceId,'A -> B -> A must not reclaim the retired A Host')
  assert.notEqual(restored.started.hostInstanceId,bMcp.started.hostInstanceId)
  assert.equal(restored.started.nativeThreadId,a.started.nativeThreadId)
  assert.equal((await starts()).at(-1).source,'KILO_MCP_A')
  result.checks.mcp={cwd:childA.cwd,idleRetiredPid:childA.pid,busyRetiredPid:childB.pid,busyRun:busy.run.id,firstHost:aMcp.started.hostInstanceId,secondHost:bMcp.started.hostInstanceId,restoredHost:restored.started.hostInstanceId}
  const setPermission=async(permission)=>{
    const current=await core.request('members.get',{agentId:'agent_2'})
    const receipt=await core.request('members.runtime.set',{commandId:crypto.randomUUID(),command:{agentId:'agent_2',expectedVersion:current.version,adapterKind:'kilo-cli',model:current.runtimeConfiguration.model,permissions:{...current.runtimeConfiguration.permissions,values:{permission}}}})
    assert.equal(receipt.status,'applied',JSON.stringify(receipt))
  }
  await setPermission('ask')
  approvalDecision='allow_once'
  const allowed=await settle(await send('CORE_WRITE_ALLOW'))
  assert.equal(await readFile(join(project,'allowed.txt'),'utf8'),'KILO_WRITE_OK')
  approvalDecision='deny'
  const denied=await settle(await send('CORE_WRITE_DENY'))
  assert.equal(await readFile(join(project,'denied.txt'),'utf8').catch(e=>e.code==='ENOENT'?null:Promise.reject(e)),null)
  assert.equal(allowed.started.nativeThreadId,c.started.nativeThreadId,'Permission Host replacement must keep native Session')
  assert.equal(denied.started.nativeThreadId,c.started.nativeThreadId)
  result.checks.approval={allowRun:allowed.run.id,denyRun:denied.run.id}
  await setPermission('deny')
  const denyOffset=calls.length
  const savedDeny=await settle(await send('CORE_WRITE_DENY_SAVED'))
  assert(calls.slice(denyOffset).filter(call=>call.tools?.length).every(call=>!call.tools.some(tool=>tool.function.name==='write')),'Saved native deny must override the inherited allow wildcard')
  assert.equal(await readFile(join(project,'denied.txt'),'utf8').catch(error=>error.code==='ENOENT'?null:Promise.reject(error)),null)
  result.checks.savedDeny=savedDeny.run.id
  await setPermission('allow')
  const cancelReceipt=await send('CORE_CANCEL')
  const cancelDeadline=Date.now()+30000
  let cancelling
  while(Date.now()<cancelDeadline){
    const snap=await core.request('camps.snapshot',{threadId})
    cancelling=snap.agentRuns.find(r=>!result.finishedRuns.includes(r.id))
    const started=await readFile(startedFile,'utf8').catch(e=>e.code==='ENOENT'?null:Promise.reject(e))
    if(cancelling&&started==='STARTED')break
    await delay()
  }
  assert(cancelling&&await readFile(startedFile,'utf8')==='STARTED','Native delayed command must start before cancel')
  const cancelled=await core.request('agentRuns.cancel',{commandId:crypto.randomUUID(),command:{threadId,agentRunId:cancelling.id,expectedVersion:cancelling.version}})
  assert.notEqual(cancelled.status,'rejected',JSON.stringify(cancelled))
  const cancelledRun=await waitForRun(threadId,(cancelReceipt.commandResult??cancelReceipt).payload.threadMessageId)
  assert.equal(cancelledRun.run.status,'cancelled')
  result.finishedRuns.push(cancelledRun.run.id)
  await new Promise(r=>setTimeout(r,5500))
  assert.equal(await readFile(lateFile,'utf8').catch(e=>e.code==='ENOENT'?null:Promise.reject(e)),null,'Cancelled tool must not leave a delayed file effect')
  const afterCancel=await settle(await send('CORE_AFTER_STOP'))
  result.checks.cancel={run:cancelledRun.run.id,status:cancelledRun.run.status,nextRun:afterCancel.run.id}
  assert(calls.every(call=>!call.tools?.some(tool=>tool.function.name==='question')),'Native question must remain disabled through warm/cold and permission changes')
  assert(!JSON.stringify(calls).includes('INHERITED_KILO_CONFIG_CANARY'),'Parent native config must not enter fixture model input')
  assert(bootstrapChecks.length>=result.finishedRuns.length-1&&bootstrapChecks.every(check=>check.verbatim),'Every ordinary model request must receive its current Host Bootstrap verbatim')
  result.checks.bootstrapRequests=bootstrapChecks
  result.checks.inheritedConfigExcluded=true
  result.status='passed'
}catch(error){result.status='failed';result.error=error.stack;throw error}
finally{
  releaseBusy()
  if(core)await core.close().catch(error=>{result.cleanupError=error.message;result.status='failed';process.exitCode=1})
  provider.closeAllConnections();await new Promise(r=>provider.close(r))
  await removeEphemeralRuntimeCampFilesRoot(data,{homeDirectory:join(root,'home')}).then(removed=>{result.checks.runtimeFilesCleaned=removed}).catch(error=>{result.cleanupError=error.message;result.status='failed';process.exitCode=1})
  await writeFile(join(root,'evidence','events.json'),JSON.stringify(events,null,2))
  await writeFile(join(root,'evidence','summary.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result,null,2))
}
