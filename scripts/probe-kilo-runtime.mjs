// Research probe: real official Kilo ACP, fake local Provider, fresh XDG roots.
// Usage: ROVAI_KILO_BIN=/absolute/path/to/kilo node scripts/probe-kilo-runtime.mjs
// No native account credentials or daily Rovai data are read or changed.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { isAbsolute, join, resolve } from 'node:path'
import { isolatedKiloEnvironment } from './lib/isolated-kilo-environment.mjs'

// Native Kilo with a local deterministic model; this does not grant platform qualification.
const configuredExecutable = process.env.ROVAI_KILO_BIN || process.argv[2]
assert(configuredExecutable && isAbsolute(configuredExecutable), 'Pass an absolute official Kilo executable through ROVAI_KILO_BIN or argv')
const executable = resolve(configuredExecutable)
const root = process.env.ROVAI_KILO_PROBE_ROOT ?? await mkdtemp(join(tmpdir(), 'rovai-kilo-native-'))
const repo = resolve(import.meta.dirname, '..')
for (const dir of ['home','workspace','config','data','cache','state','evidence','skills']) await mkdir(join(root,dir))
const project = join(root, 'workspace')
execFileSync('git',['init','--quiet',project])
const bootstrap = join(root, 'bootstrap.txt')
await writeFile(bootstrap, '[SESSION_CHARTER]\nBOOTSTRAP_A_92c1\n[/SESSION_CHARTER]\n')
const calls = [], hosts = [], evidence = { platform:process.platform+'-'+process.arch, checks:{} }
let enterSteer, releaseSteer
let enterCancel, releaseCancel
let overflowInjected=false
const steerEntered = new Promise(resolve => { enterSteer = resolve })
const steerGate = new Promise(resolve => { releaseSteer = resolve })
const cancelEntered = new Promise(resolve => { enterCancel = resolve })
const cancelGate = new Promise(resolve => { releaseCancel = resolve })
const provider = createServer(async (req,res)=>{
  let text=''
  for await (const chunk of req) text+=chunk
  if (req.method!=='POST') {res.writeHead(404);res.end();return}
  const body=JSON.parse(text)
  calls.push(body)
  await writeFile(join(root,'evidence','model-requests.json'),JSON.stringify(calls,null,2))
  const last=body.messages.at(-1)
  const user=[...body.messages].reverse().find(m=>m.role==='user')
  const content=typeof user?.content==='string'?user.content:JSON.stringify(user?.content)
  if(body.tools?.length&&content?.includes('PROBE_AUTO_OVERFLOW')&&!overflowInjected){
    overflowInjected=true
    res.writeHead(400,{'content-type':'application/json'})
    res.end(JSON.stringify({error:{message:"This model's maximum context length is 200000 tokens. However, you requested 200001 tokens.",type:'invalid_request_error',code:'context_length_exceeded',param:'messages'}}))
    return
  }
  let delta={role:'assistant',content:'KILO_FIXTURE_OK'},finish='stop'
  if(!body.tools?.length&&JSON.stringify(body.messages).includes('PROBE_AUTO_'))delta.content='KILO_AUTOMATIC_SUMMARY'
  if(content?.includes('PROBE_FILES')&&body.tools?.length){
    const history=body.messages.slice(body.messages.findLastIndex(m=>m.role==='user')+1)
    const used=history.flatMap(m=>m.tool_calls?.map(t=>t.function.name)??[])
    const file=join(project,'文件 空格.txt')
    const name=!used.includes('write')?'write':!used.includes('read')?'read':!used.includes('edit')?'edit':null
    const args=name==='write'?{filePath:file,content:'第一行\n保留行\n'}:name==='read'?{filePath:file}:{filePath:file,oldString:'第一行',newString:'第一行（已编辑）'}
    if(name){delta={role:'assistant',tool_calls:[{index:0,id:'call_files_'+calls.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]};finish='tool_calls'}
  }else if(content?.includes('PROBE_TASK_')&&last?.role!=='tool'&&body.tools?.length){
    delta={role:'assistant',tool_calls:[{index:0,id:'call_task_'+calls.length,type:'function',function:{name:'task',arguments:JSON.stringify({description:'Native foreground check',subagent_type:'general',prompt:'Return KILO_NATIVE_CHILD.',...(content.includes('PROBE_TASK_BACKGROUND')?{background:true}:{})})}}]};finish='tool_calls'
  }else if(content?.includes('PROBE_BASH')&&last?.role!=='tool'&&body.tools?.some(t=>t.function.name==='bash')){
    delta={role:'assistant',tool_calls:[{index:0,id:'call_kilo_bash_'+calls.length,type:'function',function:{name:'bash',arguments:JSON.stringify({command:"printf 'KILO_STDOUT'; printf 'KILO_STDERR' >&2",description:'Check native command output'})}}]}
    finish='tool_calls'
  }else if(content?.includes('PROBE_MCP')&&last?.role!=='tool'){
    const tool=body.tools?.find(t=>t.function.name.includes('parity')&&t.function.name.endsWith('echo'))
    if(tool){delta={role:'assistant',tool_calls:[{index:0,id:'call_kilo_mcp_'+calls.length,type:'function',function:{name:tool.function.name,arguments:'{"text":"NATIVE_MCP_MARKER"}'}}]};finish='tool_calls'}
  }
  if (content?.includes('STEER_ACTIVE') && body.tools?.length) { enterSteer(); await steerGate }
  if (content?.includes('STEER_CANCEL_ACTIVE') && body.tools?.length) { enterCancel(); await cancelGate }
  if (res.destroyed) return
  const base={id:'chatcmpl-fixture-'+calls.length,object:'chat.completion.chunk',created:1,model:'local-model'}
  res.writeHead(200,{'content-type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta,finish_reason:null}]})+'\n\n')
  const input=body.tools?.length&&content?.includes('PROBE_AUTO_SEED')?110000:100
  res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:input,completion_tokens:20,total_tokens:input+20,prompt_tokens_details:{cached_tokens:25}}})+'\n\n')
  res.end('data: [DONE]\n\n')
})
await new Promise(r=>provider.listen(0,'127.0.0.1',r))
const port=provider.address().port
const config={
  autoupdate:false,share:'disabled',enabled_providers:['local'],
  model:'local/local-model',small_model:'local/local-model',compaction:{auto:true,threshold_percent:50},
  provider:{local:{name:'Local probe',npm:'@ai-sdk/openai-compatible',env:[],options:{apiKey:'fixture-key',baseURL:'http://127.0.0.1:'+port+'/v1'},
    models:{
      'local-model':{name:'Local model',tool_call:true,limit:{context:200000,output:2048},variants:{low:{temperature:0.1},high:{temperature:0.8}}},
      'local-other':{name:'Other model',tool_call:true,limit:{context:200000,output:2048},variants:{medium:{temperature:0.3},max:{temperature:0.9}}}
    }}},
  permission:{'*':'allow',question:'deny'},instructions:[bootstrap]
}
const environment=isolatedKiloEnvironment(root)
Object.assign(environment,{
  XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),XDG_STATE_HOME:join(root,'state'),
  KILO_CONFIG_CONTENT:JSON.stringify(config),KILO_CLIENT:'acp',KILO_DISABLE_AUTOUPDATE:'1',
  KILO_EXPERIMENTAL_BACKGROUND_SUBAGENTS:'false',
  KILO_DISABLE_MODELS_FETCH:'1',KILO_DISABLE_EXTERNAL_SKILLS:'1',KILO_DISABLE_CLAUDE_CODE:'1',
  KILO_DISABLE_DEFAULT_PLUGINS:'1',KILO_DISABLE_LSP_DOWNLOAD:'1',KILO_EXPERIMENTAL_DISABLE_FILEWATCHER:'1'
})
async function open(){
  const index=hosts.length+1
  const child=spawn(executable,['acp','--cwd',project,'--log-level','ERROR'],{cwd:project,env:environment,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'})
  const pending=new Map(),frames=[];let id=0,stderr=''
  let exited=false,closed=false,closePromise
  const closure=new Promise(r=>child.once('close',()=>{closed=true;r()}))
  child.stderr.on('data',b=>stderr=(stderr+b).slice(-32768))
  const reject=error=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(error)}pending.clear()}
  child.once('error',reject)
  child.once('exit',(code,signal)=>{exited=true;reject(new Error('Kilo exit '+code+'/'+signal+' '+stderr.slice(-1500)))})
  createInterface({input:child.stdout}).on('line',line=>{
    let m
    try{m=JSON.parse(line)}catch{reject(new Error('Non-JSON stdout: '+line.slice(0,300)));return}
    frames.push(m)
    if(m.method&&m.id!==undefined){
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:m.id,...(m.method==='session/request_permission'?{result:{outcome:{outcome:'selected',optionId:(m.params.options.find(o=>o.kind==='allow_once')??m.params.options[0]).optionId}}}:{error:{code:-32601,message:'Probe client does not provide this method'}})})+'\n')
      return
    }
    const p=!m.method&&pending.get(m.id)
    if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Object.assign(new Error(m.error.message),{rpcError:m.error})):p.resolve(m.result)}
  })
  const kill=()=>{
    try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}
  }
  const host={pid:child.pid,frames,
    notify(method,params){child.stdin.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n')},
    rpc(method,params={}){
      return new Promise((resolve,reject)=>{
        const rid=++id,timer=setTimeout(()=>{pending.delete(rid);reject(new Error('Timeout '+method+' '+stderr.slice(-1500)))},45000)
        pending.set(rid,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:rid,method,params})+'\n')
      })
    },
    async prompt(sessionId,text){
      const offset=frames.length
      const result=await this.rpc('session/prompt',{sessionId,prompt:[{type:'text',text}]})
      return {result,frames:frames.slice(offset)}
    },
    close(){
      return closePromise ??= (async()=>{
      if(!exited)child.stdin.end()
      const timer=setTimeout(kill,3000)
      await closure;clearTimeout(timer);kill()
      await writeFile(join(root,'evidence','host-'+index+'-frames.json'),JSON.stringify(frames,null,2))
      await writeFile(join(root,'evidence','host-'+index+'-stderr.log'),stderr)
      return {closed}
      })()
    }
  }
  hosts.push(host)
  host.initialize=await host.rpc('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'rovai-kilo-research',version:'1'}})
  return host
}
const system=request=>request.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n')
const mcp=[{name:'parity',command:process.execPath,args:[join(repo,'crates/rovai-core/tests/fixtures/mcp-smoke-server.mjs')],env:[
  {name:'ROVAI_MCP_SMOKE_SOURCE',value:'KILO_MCP_A'},{name:'ROVAI_MCP_SMOKE_CALL_MARKER',value:join(root,'evidence','mcp-calls.txt')}]}]
try{
  evidence.version=execFileSync(executable,['--version'],{cwd:project,env:environment,encoding:'utf8',timeout:30000}).trim()
  assert.equal(evidence.version,'7.8.27','This research probe targets official Kilo 7.8.27')
  let host=await open()
  evidence.initialize=host.initialize
  const a=await host.rpc('session/new',{cwd:project,mcpServers:mcp})
  evidence.session=a
  const catalog=await host.rpc('session/new',{cwd:project,mcpServers:[]})
  const effort=result=>result.configOptions.find(option=>option.id==='effort')
  const selected=result=>result.configOptions.find(option=>option.id==='model').currentValue
  const beforeCatalog=calls.length
  assert.deepEqual(effort(catalog).options.map(option=>option.value),['low','high'])
  const other=await host.rpc('session/set_config_option',{sessionId:catalog.sessionId,configId:'model',value:'local/local-other'})
  assert.equal(selected(other),'local/local-other')
  assert.deepEqual(effort(other).options.map(option=>option.value),['medium','max'])
  const maximum=await host.rpc('session/set_config_option',{sessionId:catalog.sessionId,configId:'effort',value:'max'})
  assert.equal(effort(maximum).currentValue,'max')
  const restored=await host.rpc('session/set_config_option',{sessionId:catalog.sessionId,configId:'model',value:'local/local-model'})
  assert.deepEqual(effort(restored).options.map(option=>option.value),['low','high'])
  assert.equal(calls.length,beforeCatalog,'Model option queries must not generate model requests')
  evidence.checks.modelOptions={initial:effort(catalog),other:effort(other),selectedMaximum:effort(maximum).currentValue,restored:effort(restored),modelCalls:0}
  const first=await host.prompt(a.sessionId,'PROBE_BASH FIRST_DYNAMIC_MARKER')
  assert.equal(first.result.stopReason,'end_turn')
  assert(calls.length>=2,'Expected bash followed by a second model step')
  assert(system(calls[0]).includes('BOOTSTRAP_A_92c1'),'Instructions missing from system')
  assert(!system(calls[0]).includes('FIRST_DYNAMIC_MARKER'),'Dynamic prompt leaked to system')
  const database=new DatabaseSync(join(root,'data','kilo','kilo.db'),{readOnly:true})
  let usageRows
  try { usageRows=database.prepare("SELECT id,json_extract(data,'$.tokens.input') AS input,json_extract(data,'$.tokens.output') AS output,json_extract(data,'$.tokens.cache.read') AS cacheRead FROM message WHERE session_id=? AND json_extract(data,'$.role')='assistant'").all(a.sessionId) } finally { database.close() }
  assert.equal(usageRows.length,2,'Both model steps must be present in native storage')
  assert.deepEqual(usageRows.map(r=>[r.input,r.output,r.cacheRead]),[[75,20,25],[75,20,25]])
  const output=first.frames.filter(f=>f.params?.update?.rawOutput?.output).at(-1)?.params.update.rawOutput.output
  assert.equal(output,'KILO_STDOUTKILO_STDERR')
  evidence.checks.first={calls:calls.length,result:first.result,nativeUsage:usageRows,commandOutput:output}
  evidence.checks.questionDisabled=!calls[0].tools?.some(t=>t.function.name==='question')
  assert(evidence.checks.questionDisabled,'Question tool must be absent from the tested ACP launch')
  await writeFile(bootstrap,'[SESSION_CHARTER]\nBOOTSTRAP_A_UPDATED_92c1\n[/SESSION_CHARTER]\n')
  let before=calls.length
  await host.prompt(a.sessionId,'PROBE_MCP')
  assert(system(calls[before]).includes('BOOTSTRAP_A_UPDATED_92c1'))
  assert(!system(calls[before]).includes('BOOTSTRAP_A_92c1'))
  assert((await readFile(join(root,'evidence','mcp-calls.txt'),'utf8')).includes('called'))
  evidence.checks.warmInstructionsAndMcp=true
  const compactDatabase=new DatabaseSync(join(root,'data','kilo','kilo.db'),{readOnly:true})
  try {
    const parts=()=>compactDatabase.prepare("SELECT json_extract(data,'$.auto') AS automatic,json_extract(data,'$.overflow') AS overflow FROM part WHERE session_id=? AND json_extract(data,'$.type')='compaction'").all(a.sessionId)
    const summaries=()=>compactDatabase.prepare("SELECT count(*) AS n FROM message WHERE session_id=? AND json_extract(data,'$.summary')=1 AND json_extract(data,'$.role')='assistant'").get(a.sessionId).n
    await host.prompt(a.sessionId,'PROBE_AUTO_SEED')
    const baseline=summaries();before=calls.length
    const automatic=await host.prompt(a.sessionId,'PROBE_AUTO_THRESHOLD')
    assert.equal(automatic.result.stopReason,'end_turn')
    const resumed=calls.slice(before).filter(request=>request.tools?.length)
    assert(summaries()>baseline&&parts().some(part=>part.automatic===1&&part.overflow!==1),'Native threshold must create an automatic non-overflow compaction')
    assert(resumed.length>0&&resumed.every(request=>system(request).includes('BOOTSTRAP_A_UPDATED_92c1')))
    assert(resumed.some(request=>JSON.stringify(request.messages).includes('KILO_AUTOMATIC_SUMMARY')),'Normal generation must consume the actual summary')
    evidence.checks.automaticThreshold={stopReason:automatic.result.stopReason,nativeSummaries:summaries()-baseline,reportedInput:110000,contextWindow:200000,thresholdPercent:50,systemPreserved:true,summaryConsumed:true}
    const overflowBaseline=summaries();before=calls.length
    const recovered=await host.prompt(a.sessionId,'PROBE_AUTO_OVERFLOW')
    const retried=calls.slice(before).filter(request=>request.tools?.length)
    assert.equal(recovered.result.stopReason,'end_turn')
    assert(overflowInjected&&summaries()>overflowBaseline&&parts().some(part=>part.automatic===1&&part.overflow===1),'Provider overflow must trigger native automatic recovery')
    assert(retried.length>=2&&retried.every(request=>system(request).includes('BOOTSTRAP_A_UPDATED_92c1')))
    evidence.checks.automaticOverflow={stopReason:recovered.result.stopReason,nativeSummaries:summaries()-overflowBaseline,providerRejectedOnce:true,systemPreserved:true}
    assert(parts().every(part=>part.automatic===1),'No manual compaction is part of this acceptance')
  } finally {compactDatabase.close()}
  const b=await host.rpc('session/new',{cwd:project,mcpServers:[]})
  before=calls.length
  await host.prompt(b.sessionId,'NEIGHBOR_WITHOUT_MCP')
  evidence.checks.sameHostEmptyMcpRetainsA=calls[before].tools.some(t=>t.function.name.includes('parity'))
  assert(evidence.checks.sameHostEmptyMcpRetainsA,'Recheck Host scope if upstream gains Session MCP isolation')
  await host.close()
  host=await open()
  await host.rpc('session/resume',{sessionId:a.sessionId,cwd:project,mcpServers:[]})
  before=calls.length
  await host.prompt(a.sessionId,'COLD_RESUME_MARKER')
  assert(system(calls[before]).includes('BOOTSTRAP_A_UPDATED_92c1'))
  evidence.checks.coldResume={sessionId:a.sessionId,historyMessages:calls[before].messages.length,mcpToolsPresent:calls[before].tools.some(t=>t.function.name.includes('parity'))}
  assert(JSON.stringify(calls[before].messages).includes('KILO_AUTOMATIC_SUMMARY'),'Cold resume must preserve the native automatic summary')
  assert(!evidence.checks.coldResume.mcpToolsPresent,'Process-local MCP must disappear on a fresh Host')
  const steering=await host.rpc('session/new',{cwd:project,mcpServers:[]})
  const offset=hosts.at(-1).frames.length, callOffset=calls.length
  const firstSteer=host.prompt(steering.sessionId,'STEER_ACTIVE original request')
  firstSteer.catch(()=>{})
  await Promise.race([steerEntered,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Steer provider entry timeout')),10000))])
  const correction=host.prompt(steering.sessionId,'STEER_CORRECTION corrected request')
  correction.catch(()=>{})
  const intakeDeadline=Date.now()+5000
  let intake=false
  const steeringDb=new DatabaseSync(join(root,'data','kilo','kilo.db'),{readOnly:true})
  try {
    while(Date.now()<intakeDeadline) {
      intake=steeringDb.prepare("SELECT EXISTS(SELECT 1 FROM part WHERE session_id=? AND json_extract(data,'$.text') LIKE '%STEER_CORRECTION%') AS found").get(steering.sessionId).found===1
      if(intake)break
      await new Promise(resolve=>setTimeout(resolve,50))
    }
  } finally { steeringDb.close() }
  releaseSteer()
  const outcomes=await Promise.allSettled([firstSteer,correction])
  const requests=calls.slice(callOffset)
  evidence.checks.concurrentPrompt={sessionId:steering.sessionId,acceptedWhileFirstModelPending:intake,
    outcomes:outcomes.map(outcome=>outcome.status==='fulfilled'?{status:'fulfilled',result:outcome.value.result}:{status:'rejected',error:outcome.reason.message,rpcError:outcome.reason.rpcError}),
    modelCalls:requests.length,correctionReachedModel:requests.some(request=>JSON.stringify(request.messages).includes('STEER_CORRECTION')),
    frames:hosts.at(-1).frames.slice(offset).map(frame=>({id:frame.id,method:frame.method,stopReason:frame.result?.stopReason,sessionId:frame.params?.sessionId,update:frame.params?.update?.sessionUpdate}))}
  const cancelling=await host.rpc('session/new',{cwd:project,mcpServers:[]})
  const originalCancel=host.prompt(cancelling.sessionId,'STEER_CANCEL_ACTIVE original request')
  originalCancel.catch(()=>{})
  await Promise.race([cancelEntered,new Promise((_,reject)=>setTimeout(()=>reject(Error('Cancel provider entry deadline')),10000))])
  const supplements=[1,2,3].map(index=>host.prompt(cancelling.sessionId,'STEER_CANCEL_CORRECTION_'+index))
  for(const supplement of supplements)supplement.catch(()=>{})
  const cancelDb=new DatabaseSync(join(root,'data','kilo','kilo.db'),{readOnly:true})
  try {
    const deadline=Date.now()+5000
    while(Date.now()<deadline&&cancelDb.prepare("SELECT count(*) AS n FROM part WHERE session_id=? AND json_extract(data,'$.text') LIKE 'STEER_CANCEL_CORRECTION_%'").get(cancelling.sessionId).n<3)await new Promise(resolve=>setTimeout(resolve,25))
    assert.equal(cancelDb.prepare("SELECT count(*) AS n FROM part WHERE session_id=? AND json_extract(data,'$.text') LIKE 'STEER_CANCEL_CORRECTION_%'").get(cancelling.sessionId).n,3,'All three native supplements must actually enter the same Session before cancellation')
  } finally {cancelDb.close()}
  const cancelStarted=Date.now()
  host.notify('session/cancel',{sessionId:cancelling.sessionId});releaseCancel()
  const cancelled=await Promise.all([originalCancel,...supplements])
  assert(cancelled.every(outcome=>['end_turn','cancelled'].includes(outcome.result.stopReason)))
  const elapsedMs=Date.now()-cancelStarted
  assert(elapsedMs<2000,'Native prompt finalizers must fit the unchanged Core interrupt window')
  const successor=await host.prompt(cancelling.sessionId,'AFTER_CANCEL_MULTI')
  assert.equal(successor.result.stopReason,'end_turn')
  evidence.checks.cancelledMultiplePrompts={sessionId:cancelling.sessionId,pid:host.pid,submittedSupplements:3,settledRequests:cancelled.length,stopReasons:cancelled.map(outcome=>outcome.result.stopReason),elapsedMs,sameHostSuccessor:true}
  try{await host.rpc('session/resume',{sessionId:'ses_missing_0123456789',cwd:project,mcpServers:[]});evidence.checks.unknownSessionRejected=false}catch(e){assert(e.rpcError,'Missing Session must return a native RPC error');evidence.checks.unknownSessionRejected={message:e.message,error:e.rpcError}}
  assert(evidence.checks.unknownSessionRejected!==false,'Unknown Session must not silently become a new one')
  const files=await host.rpc('session/new',{cwd:project,mcpServers:[]})
  const fileResult=await host.prompt(files.sessionId,'PROBE_FILES')
  assert.equal(await readFile(join(project,'文件 空格.txt'),'utf8'),'第一行（已编辑）\n保留行\n')
  evidence.checks.files={stopReason:fileResult.result.stopReason,updates:fileResult.frames.filter(f=>f.params?.update?.toolCallId).map(f=>f.params.update)}
  const tasks=await host.rpc('session/new',{cwd:project,mcpServers:[]})
  const taskDb=new DatabaseSync(join(root,'data','kilo','kilo.db'),{readOnly:true})
  const children=()=>taskDb.prepare('SELECT count(*) AS n FROM session WHERE parent_id=?').get(tasks.sessionId).n
  try {
    const blocked=await host.prompt(tasks.sessionId,'PROBE_TASK_BACKGROUND')
    assert.equal(children(),0,'Background opt-out must not start a child Session')
    assert(JSON.stringify(blocked.frames).includes('Background subagents require'),'Native tool must reject explicit background=true')
    const foreground=await host.prompt(tasks.sessionId,'PROBE_TASK_FOREGROUND')
    assert.equal(children(),1,'Foreground subagent remains available')
    assert.equal(foreground.result.stopReason,'end_turn')
    const schemas=calls.flatMap(call=>call.tools?.filter(t=>t.function.name==='task').map(t=>t.function.parameters)??[])
    assert(schemas.length>0&&schemas.every(schema=>!Object.hasOwn(schema.properties??{},'background')))
    evidence.checks.backgroundPolicy={taskVisible:true,backgroundParameterAbsent:true,explicitBackgroundRejected:true,foregroundChildSessions:children()}
  } finally {taskDb.close()}
  await host.close()
  evidence.modelCalls=calls.length
  evidence.status='passed'
}catch(error){
  evidence.status='failed';evidence.error=error.stack
  throw error
}finally{
  releaseSteer()
  releaseCancel()
  evidence.hostPids=hosts.map(h=>h.pid)
  evidence.cleanup=await Promise.allSettled(hosts.map(h=>h.close()))
  provider.closeAllConnections();await new Promise(r=>provider.close(r))
  await writeFile(join(root,'evidence','summary.json'),JSON.stringify(evidence,null,2))
  console.log(JSON.stringify({root,version:evidence.version,status:evidence.status,checks:evidence.checks},null,2))
}
