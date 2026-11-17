// Official Goose ACP, isolated native roots, synthetic loopback Provider only.
// Usage: ROVAI_GOOSE_BIN=/absolute/path/to/goose node scripts/probe-goose-runtime.mjs
// POSIX shell fixtures; no real account, daily Rovai data or product qualification.
import assert from 'node:assert/strict'
import {spawn, execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
import {createInterface} from 'node:readline'
import {mkdir, mkdtemp, readFile, writeFile, unlink, access} from 'node:fs/promises'
import {join, isAbsolute, resolve} from 'node:path'
import {performance} from 'node:perf_hooks'
import {tmpdir} from 'node:os'
import {DatabaseSync} from 'node:sqlite'

assert(process.platform!=='win32','This research probe uses POSIX shell fixtures; Windows needs target-specific acceptance')
const configuredExecutable=process.env.ROVAI_GOOSE_BIN??process.argv[2]
assert(configuredExecutable&&isAbsolute(configuredExecutable),'Pass an absolute official Goose executable through ROVAI_GOOSE_BIN or argv')
const executable=resolve(configuredExecutable),repo=resolve(import.meta.dirname,'..')
const parent=process.env.ROVAI_GOOSE_PROBE_ROOT??tmpdir()
assert(isAbsolute(parent),'ROVAI_GOOSE_PROBE_ROOT must be absolute')
await mkdir(parent,{recursive:true})
const fixture=await mkdtemp(join(parent,'rovai-goose-native-'))
console.log(JSON.stringify({fixture}))
for(const dir of ['home','config','data','cache','state','workspace','goose-root','evidence'])await mkdir(join(fixture,dir),{recursive:true})
const skillDir=join(fixture,'workspace','.agents','skills','rovai-native-probe')
await mkdir(skillDir,{recursive:true})
const skillFile=join(skillDir,'SKILL.md')
const skillText=marker=>'---\nname: rovai-native-probe\ndescription: Native local research fixture.\n---\n'+marker+'\n'
await writeFile(skillFile,skillText('GOOSE_SKILL_A'))
const requests=[],frames=[],timings=[],checks={}
let steerEntered=false,cancelEntered=false,childEntered=false,childCancelEntered=false,childCancelDisconnected=false,compactInjected=false,overflowInjected=false,releaseSteer,releaseCancel,releaseChild,releaseChildCancel
const steerGate=new Promise(r=>{releaseSteer=r}),cancelGate=new Promise(r=>{releaseCancel=r}),childGate=new Promise(r=>{releaseChild=r}),childCancelGate=new Promise(r=>{releaseChildCancel=r})
const provider=createServer(async(req,res)=>{
  if(req.method==='GET'){
    res.writeHead(200,{'content-type':'application/json'})
    res.end(JSON.stringify({object:'list',data:['gpt-4o-mini','gpt-5','gpt-6.1-sol'].map(id=>({id,object:'model',owned_by:'fixture'}))}))
    return
  }
  let raw='';for await(const b of req)raw+=b
  const body=JSON.parse(raw);requests.push(body)
  const lastUser=[...(body.messages??[])].reverse().find(m=>m.role==='user')
  const text=typeof lastUser?.content==='string'?lastUser.content:JSON.stringify(lastUser?.content)
  if(body.tools?.length&&text?.includes('PROBE_OVERFLOW')&&!overflowInjected){
    overflowInjected=true
    res.writeHead(400,{'content-type':'application/json'})
    res.end(JSON.stringify({error:{message:'maximum context length exceeded',type:'invalid_request_error',code:'context_length_exceeded'}}))
    return
  }
  if(body.tools?.length&&text?.includes('PROBE_STEER_ACTIVE')&&!steerEntered){steerEntered=true;await steerGate}
  if(body.tools?.length&&text?.includes('PROBE_CANCEL_ACTIVE')&&!cancelEntered){cancelEntered=true;await cancelGate}
  if(body.tools?.some(t=>t.function?.name==='recipe__final_output')){
    if(text?.includes('GOOSE_NATIVE_CHILD_CANCEL')&&!childCancelEntered){
      childCancelEntered=true
      res.once('close',()=>{childCancelDisconnected=!res.writableEnded})
      await childCancelGate
    }
    else if(!childEntered){childEntered=true;await childGate}
  }
  if(res.destroyed)return
  const content=text?.includes('PROBE_STEER_CORRECTION')?'GOOSE_CORRECTION_SEEN':'GOOSE_NATIVE_FIXTURE_OK'
  let call
  const messages=body.messages??[]
  const userIndex=messages.findLastIndex(m=>m.role==='user')
  const used=messages.slice(userIndex+1).flatMap(m=>m.tool_calls?.map(c=>c.function.name)??[])
  if(body.tools?.length&&text?.includes('PROBE_FILES')){
    const name=!used.includes('write')?'write':!used.includes('shell')?'shell':!used.includes('edit')?'edit':null
    if(name)call={name,args:name==='write'?{path:'测试 空格.txt',content:'第一行\n保留行\n'}:name==='shell'?{command:"cat '测试 空格.txt'"}:{path:'测试 空格.txt',before:'第一行',after:'第一行（编辑）'}}
  }else if(body.tools?.length&&text?.includes('PROBE_PERMISSION')&&!used.includes('write')){
    call={name:'write',args:{path:text.includes('DENY')?'denied.txt':'allowed.txt',content:'GOOSE_PERMISSION_EFFECT\n'}}
  }else if(body.tools?.length&&text?.includes('PROBE_SHELL')&&!used.includes('shell')){
    const command=text.includes('EMPTY')?':':text.includes('LARGE')?"printf '%09000d' 0":"printf 'GOOSE_STDOUT'; printf 'GOOSE_STDERR' >&2; exit 7"
    call={name:'shell',args:{command}}
  }else if(body.tools?.length&&text?.includes('PROBE_SKILL')&&!used.includes('load_skill')){
    call={name:'load_skill',args:{name:'rovai-native-probe'}}
  }else if(body.tools?.length&&text?.includes('PROBE_DELEGATE')&&!used.includes('delegate')){
    call={name:'delegate',args:{instructions:text.includes('CANCEL')?'GOOSE_NATIVE_CHILD_CANCEL':'GOOSE_NATIVE_CHILD',max_turns:2}}
  }else if(body.tools?.some(t=>t.function?.name==='recipe__final_output')&&!used.includes('recipe__final_output')){
    call={name:'recipe__final_output',args:{summary:'GOOSE_NATIVE_CHILD_SUCCESS'}}
  }else if(body.tools?.length&&text?.includes('PROBE_MCP')&&!used.some(name=>name.includes('parity_'))){
    const tool=body.tools.find(t=>t.function?.name?.includes('parity_a')&&t.function.name.endsWith('echo'))
    if(tool)call={name:tool.function.name,args:{text:'GOOSE_MCP_MARKER'}}
  }else if(body.tools?.length&&text?.includes('PROBE_ELICITATION')&&!used.some(name=>name.endsWith('__ask'))){
    const tool=body.tools.find(t=>t.function?.name?.endsWith('__ask'))
    assert(tool,'Synthetic elicitation tool must be available')
    call={name:tool.function.name,args:{}}
  }
  const usage={prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:10}}
  if(body.tools?.length&&text?.includes('PROBE_AUTO_COMPACT')&&!compactInjected){
    compactInjected=true;usage.prompt_tokens=120000;usage.total_tokens=120020
  }
  const base={id:'goose-fixture-'+requests.length,created:1,model:body.model}
  if(body.input){
    const item={id:'msg_fixture_'+requests.length,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:content,annotations:[]}]}
    const response={id:'resp_fixture_'+requests.length,object:'response',created_at:1,model:body.model,status:'completed',output:[item],usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:10},output_tokens_details:{reasoning_tokens:0}}}
    if(body.stream){
      res.writeHead(200,{'content-type':'text/event-stream'})
      const events=[
        {type:'response.created',response:{...response,status:'in_progress',output:[]}},
        {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},
        {type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},
        {type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:content},
        {type:'response.output_text.done',item_id:item.id,output_index:0,content_index:0,text:content},
        {type:'response.output_item.done',output_index:0,item},
        {type:'response.completed',response}
      ]
      events.forEach((event,sequence_number)=>res.write('event: '+event.type+'\ndata: '+JSON.stringify({...event,sequence_number})+'\n\n'))
      res.end()
    }else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response))}
    return
  }
  if(body.stream){
    res.writeHead(200,{'content-type':'text/event-stream'})
    const delta=call?{role:'assistant',tool_calls:[{index:0,id:'goose_call_'+requests.length,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{role:'assistant',content}
    res.write('data: '+JSON.stringify({...base,object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason:null}]})+'\n\n')
    res.write('data: '+JSON.stringify({...base,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}],usage})+'\n\n')
    res.end('data: [DONE]\n\n')
  }else{
    res.writeHead(200,{'content-type':'application/json'})
    res.end(JSON.stringify({...base,object:'chat.completion',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage}))
  }
})
await new Promise(r=>provider.listen(0,'127.0.0.1',r))
const environment={
 PATH:process.env.PATH,HOME:join(fixture,'home'),XDG_CONFIG_HOME:join(fixture,'config'),XDG_DATA_HOME:join(fixture,'data'),
 XDG_CACHE_HOME:join(fixture,'cache'),XDG_STATE_HOME:join(fixture,'state'),GOOSE_PATH_ROOT:join(fixture,'goose-root'),
 GOOSE_DISABLE_KEYRING:'1',GOOSE_PROVIDER:'openai',GOOSE_MODEL:'gpt-4o-mini',GOOSE_MODE:'auto',
 GOOSE_AUTO_COMPACT_THRESHOLD:'0.5',
 OPENAI_API_KEY:'fixture-key',OPENAI_HOST:'http://127.0.0.1:'+provider.address().port,
 OPENAI_BASE_PATH:'v1/chat/completions',TERM:'dumb',NO_COLOR:'1',TMPDIR:fixture
}
const hosts=[]
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function until(test){const end=performance.now()+15000;while(!test()){assert(performance.now()<end,'Native observation deadline');await sleep(10)}}
function activeRun(sessionId){
 const update=[...frames].reverse().find(m=>m.method==='session/update'&&m.params?.sessionId===sessionId&&m.params.update?.sessionUpdate==='session_info_update'&&Object.hasOwn(m.params.update?._meta?.goose??{},'activeRunId'))
 return update?.params.update._meta.goose.activeRunId
}
const bootstrap=marker=>'[SESSION_CHARTER]\n'+marker+'\n[/SESSION_CHARTER]\n[MEMBER_IDENTITY]\n{"name":"原生探测"}\n[/MEMBER_IDENTITY]\n'
async function setBootstrap(host,sessionId,marker){return host.rpc('_goose/unstable/session/system-prompt/set',{sessionId,mode:'append',key:'rovai-session-bootstrap',text:bootstrap(marker)})}
const prompt=(host,sessionId,text)=>host.rpc('session/prompt',{sessionId,prompt:[{type:'text',text}]})
function checkBootstrap(start,marker,excluded){
 const ordinary=requests.slice(start).filter(r=>r.tools?.length>0)
 assert(ordinary.length>0)
 assert(ordinary.every(r=>r.messages.some(m=>['system','developer'].includes(m.role)&&typeof m.content==='string'&&m.content.includes(bootstrap(marker))&&(!excluded||!m.content.includes(excluded)))))
 return ordinary.length
}
async function open(overrides={}){
 const child=spawn(executable,['acp'],{cwd:join(fixture,'workspace'),env:{...environment,...overrides},stdio:['pipe','pipe','pipe'],detached:true})
 const pending=new Map();let nextId=0,stderr='',exited=false,closePromise
 const closed=new Promise(r=>child.once('close',(code,signal)=>{exited=true;r({code,signal})}))
 const rejectAll=error=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(error)}pending.clear()}
 child.stderr.on('data',b=>{stderr=(stderr+b).slice(-50000)})
 child.once('error',rejectAll);child.once('exit',code=>rejectAll(new Error('Goose exited '+code+' '+stderr.slice(-1200))))
 createInterface({input:child.stdout}).on('line',line=>{
   let m;try{m=JSON.parse(line)}catch{rejectAll(new Error('Non-JSON stdout '+line.slice(0,200)));return}
   frames.push(m)
   if(m.method&&m.id!==undefined){
     let response={error:{code:-32601,message:'Research client does not implement method'}}
     if(m.method==='session/request_permission'){
       if(host.permissionChoice==='allow'||host.permissionChoice==='deny'){
         const kind=host.permissionChoice==='allow'?'allow_once':'reject_once'
         const option=m.params.options.find(o=>o.kind===kind)
         assert(option,'Native permission must offer '+kind)
         response={result:{outcome:{outcome:'selected',optionId:option.optionId}}}
       }else response={result:{outcome:{outcome:'cancelled'}}}
     }
     child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:m.id,...response})+'\n')
     return
   }
   const p=pending.get(m.id);if(!p||m.method)return
   pending.delete(m.id);clearTimeout(p.timer)
   timings.push({method:p.method,ms:performance.now()-p.start})
   m.error?p.reject(Object.assign(new Error(m.error.message),{rpcError:m.error})):p.resolve(m.result)
 })
 const host={child,pid:child.pid,get stderr(){return stderr},get pendingCount(){return pending.size},rpc(method,params={},timeoutMs=30000){
   return new Promise((resolve,reject)=>{
     const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Timeout '+method+' '+stderr.slice(-1500)))},timeoutMs)
     pending.set(id,{resolve,reject,timer,method,start:performance.now()})
     child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')
   })
 },notify(method,params={}){child.stdin.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n')},
 close(){return closePromise??=(async()=>{
   child.stdin.end()
   const kill=()=>{try{process.kill(-child.pid,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error}}
   const timer=setTimeout(kill,3000)
   const result=await closed;clearTimeout(timer);kill()
   rejectAll(new Error('Research client closed'))
   return result
 })()}}
 hosts.push(host)
 const initialization=await host.rpc('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false,_meta:{goose:{customNotifications:true}}},clientInfo:{name:'rovai-goose-research',version:'1'}})
 host.initialization=initialization
 return host
}
async function checkOfflineMcpLoads(){
 const switchFile=join(fixture,'extension-state'),switchMcp=join(fixture,'switch-mcp.mjs'),pidFile=join(fixture,'extension-pid')
 await writeFile(switchFile,'ready')
 await writeFile(switchMcp,"import {readFileSync,writeFileSync} from 'node:fs'; writeFileSync("+JSON.stringify(pidFile)+",String(process.pid)); const mode=readFileSync("+JSON.stringify(switchFile)+",'utf8'); if(mode==='exit')process.exit(7); if(mode==='silent'){process.stdin.resume();setInterval(()=>{},1000)}else await import("+JSON.stringify(new URL('../crates/rovai-core/tests/fixtures/mcp-smoke-server.mjs',import.meta.url).href)+");")
 const original=await open()
 const session=await original.rpc('session/new',{cwd:join(fixture,'workspace'),mcpServers:[{name:'rovai_parity_switch',command:process.execPath,args:[switchMcp],env:[],_meta:{timeout:1}}]})
 await original.close()
 checks.offlineMcpLoads=[]
 for(const mode of ['exit','silent']){
  await writeFile(switchFile,mode)
  const host=await open(),started=performance.now()
  try{
   const loaded=await host.rpc('session/load',{sessionId:session.sessionId,cwd:join(fixture,'workspace'),mcpServers:[],_meta:{replayTail:1}},4000)
   const ms=performance.now()-started
   if(mode==='silent'){
    await sleep(50)
    const pid=Number(await readFile(pidFile,'utf8'))
    assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH','Timed-out extension must not remain as an unmanaged subprocess')
   }
   await setBootstrap(host,session.sessionId,'GOOSE_OFFLINE_MCP_'+mode)
   const completion=await prompt(host,session.sessionId,'GOOSE_SESSION_ISOLATION')
   assert.equal(completion.stopReason,'end_turn')
   checks.offlineMcpLoads.push({mode,ms,loadCompleted:true,promptCompleted:true,unresponsiveChildReaped:mode==='silent'?true:undefined,extensionResults:loaded._meta?.extensionResults??null})
  }catch(error){
   if(mode!=='silent'||!error.message.startsWith('Timeout session/load')||process.env.ROVAI_GOOSE_EXPECT_BOUNDED_MCP_LOAD==='1')throw error
   checks.offlineMcpLoads.push({mode,ms:performance.now()-started,configuredExtensionTimeoutSec:1,loadCompleted:false,promptCompleted:false,knownNativeIssue:'silent MCP initialization outlives configured timeout'})
  }finally{await host.close()}
 }
}
async function checkModelOptionsWithoutExtensions(){
 const configRoot=join(fixture,'goose-root','config'),mode=join(fixture,'probe-mcp-mode'),starts=join(fixture,'probe-mcp-starts'),mcp=join(fixture,'probe-mcp.mjs')
 await mkdir(configRoot,{recursive:true})
 await writeFile(mode,'silent');await writeFile(starts,'')
 await writeFile(mcp,"import {appendFileSync,readFileSync} from 'node:fs';appendFileSync("+JSON.stringify(starts)+",String(process.pid)+'\\n');if(readFileSync("+JSON.stringify(mode)+",'utf8')==='silent'){process.stdin.resume();setInterval(()=>{},1000)}else await import("+JSON.stringify(new URL('../crates/rovai-core/tests/fixtures/mcp-smoke-server.mjs',import.meta.url).href)+");")
 await writeFile(join(configRoot,'config.yaml'),JSON.stringify({extensions:{native_probe_fixture:{enabled:true,type:'stdio',name:'native_probe_fixture',cmd:process.execPath,args:[mcp],envs:{},timeout:1}}}))
 const baseline=await open()
 try{
  await assert.rejects(baseline.rpc('session/new',{cwd:join(fixture,'workspace'),mcpServers:[],_meta:{provider:'openai'}},4000),error=>error.message.startsWith('Timeout session/new'))
 }finally{await baseline.close()}
 const startedBefore=(await readFile(starts,'utf8')).trim().split('\n').filter(Boolean)
 assert.equal(startedBefore.length,1,'The failing comparison must actually start the native MCP')
 const probe=await open(),offset=requests.length,start=performance.now()
 const session=await probe.rpc('session/new',{cwd:join(fixture,'workspace'),mcpServers:[],_meta:{provider:'openai',enabledExtensions:[]}},4000)
 assert.deepEqual(session._meta.extensionResults,[])
 const selected=await probe.rpc('session/set_config_option',{sessionId:session.sessionId,configId:'model',value:'gpt-6.1-sol'})
 assert(selected.configOptions.find(c=>c.id==='thinking_effort').options.some(v=>v.value==='high'))
 assert.equal((await probe.rpc('_goose/unstable/tools/list',{sessionId:session.sessionId})).tools.length,0)
 assert.equal(requests.length,offset,'Reading model options must not generate a model response')
 assert.equal((await readFile(starts,'utf8')).trim().split('\n').filter(Boolean).length,1,'The parameter Session must not start the configured MCP')
 const queryMs=performance.now()-start
 await probe.rpc('session/delete',{sessionId:session.sessionId});await probe.close()
 await writeFile(mode,'ready')
 const business=await open()
 const normal=await business.rpc('session/new',{cwd:join(fixture,'workspace'),mcpServers:[],_meta:{provider:'openai'}})
 const tools=(await business.rpc('_goose/unstable/tools/list',{sessionId:normal.sessionId})).tools.map(t=>t.name)
 for(const name of ['write','edit','shell'])assert(tools.includes(name))
 assert(tools.some(name=>name.endsWith('__echo')),'A normal Session must still inherit native MCP tools')
 await business.rpc('session/delete',{sessionId:normal.sessionId});await business.close()
 checks.modelOptionsProbe={configuredSilentMcpStartedInComparison:true,comparisonTimedOut:true,emptyExtensionToolCount:0,effortResolved:true,modelGenerations:0,queryMs,businessNativeToolsRetained:true}
}
try{
 const version=execFileSync(executable,['--version'],{encoding:'utf8',env:environment,cwd:join(fixture,'workspace'),timeout:10000}).trim()
 assert.equal(version,'1.59.0','Recheck official protocol/source before changing this pinned research fixture')
 checks.native={version,platform:process.platform+'-'+process.arch,command:['goose','acp'],provider:'synthetic-loopback',qualification:false}
 if(process.env.ROVAI_GOOSE_PROBE_SCOPE==='mcp-startup'){
  await checkOfflineMcpLoads()
 }else if(process.env.ROVAI_GOOSE_PROBE_SCOPE==='model-options'){
  await checkModelOptionsWithoutExtensions()
 }else if(process.env.ROVAI_GOOSE_PROBE_SCOPE==='model-default'){
  const host=await open({GOOSE_THINKING_EFFORT:'medium'})
  const session=await host.rpc('session/new',{cwd:join(fixture,'workspace'),mcpServers:[],_meta:{provider:'openai',enabledExtensions:[]}})
  const select=()=>host.rpc('session/set_config_option',{sessionId:session.sessionId,configId:'model',value:'gpt-6.1-sol'})
  const effort=result=>result.configOptions.find(option=>option.id==='thinking_effort')?.currentValue
  const initial=effort(await select())
  const explicit=effort(await host.rpc('session/set_config_option',{sessionId:session.sessionId,configId:'thinking_effort',value:'high'}))
  const reselected=effort(await select())
  assert.equal(initial,'medium');assert.equal(explicit,'high');assert.equal(reselected,'high')
  let resetErrorCode
  await assert.rejects(host.rpc('session/set_config_option',{sessionId:session.sessionId,configId:'thinking_effort',value:'default'}),error=>{
   resetErrorCode=error.rpcError?.code
   return resetErrorCode===-32602
  })
  const explicitMedium=effort(await host.rpc('session/set_config_option',{sessionId:session.sessionId,configId:'thinking_effort',value:'medium'}))
  assert.equal(explicitMedium,'medium')
  assert.equal(requests.length,0,'Model configuration research must not generate model responses')
  checks.modelDefault={initial,explicit,reselected,resetErrorCode,explicitMedium,modelGenerations:requests.length}
  await host.rpc('session/delete',{sessionId:session.sessionId})
 }else if(process.env.ROVAI_GOOSE_PROBE_SCOPE==='session-availability'){
  const host=await open({GOOSE_PROVIDER:undefined})
  await assert.rejects(host.rpc('session/new',{cwd:join(fixture,'workspace'),mcpServers:[]}),error=>!!error.rpcError)
  const session=await host.rpc('session/new',{cwd:join(fixture,'workspace'),mcpServers:[],_meta:{provider:'openai'}})
  assert.equal(session.configOptions.find(c=>c.id==='provider').currentValue,'openai')
  const options=await host.rpc('session/set_config_option',{sessionId:session.sessionId,configId:'model',value:'gpt-6.1-sol'})
  assert(options.configOptions.find(c=>c.id==='thinking_effort').options.some(v=>v.value==='high'))
  assert.equal((await prompt(host,session.sessionId,'PROBE_EXPLICIT_PROVIDER')).stopReason,'end_turn')
  await host.rpc('session/delete',{sessionId:session.sessionId})
  checks.sessionAvailability={unconfiguredDefaultRejected:true,explicitProviderCreatesSession:true,effortAvailable:true,promptCompleted:true,deleted:true}
 }else{
 const host=await open()
 assert.equal(host.initialization.agentInfo.version,version)
 console.log(JSON.stringify({initialize:host.initialization}))
 const directory=await host.rpc('_goose/unstable/providers/list',{providerIds:[]})
 const defaults=await host.rpc('_goose/unstable/defaults/read',{})
 assert(directory.entries.some(p=>p.providerId==='openai'&&p.configured&&p.available))
 assert.equal(defaults.providerId,'openai');assert.equal(defaults.modelId,'gpt-4o-mini')
 assert.equal(requests.length,0,'Directory/default reads must not generate a model response')
 const sessionDatabase=join(fixture,'goose-root','data','sessions','sessions.db')
 let nativeSessionRows=0
 try {
   await access(sessionDatabase)
   const db=new DatabaseSync(sessionDatabase,{readOnly:true})
   try { nativeSessionRows=db.prepare('SELECT count(*) AS n FROM sessions').get().n } finally { db.close() }
 } catch(error) { if(error.code!=='ENOENT')throw error }
 assert.equal(nativeSessionRows,0,'Directory/default reads must not create native Sessions')
 checks.directory={beforeAnySession:true,nativeDefaults:true,nativeSessionRows,modelGenerations:0}
 const session=await host.rpc('session/new',{cwd:join(fixture,'workspace'),mcpServers:[]})
 console.log(JSON.stringify({newSession:{sessionId:session.sessionId,modes:session.modes,configOptions:session.configOptions.map(c=>({id:c.id,currentValue:c.currentValue,optionCount:c.options?.length,...(c.id==='thinking_effort'?{options:c.options}:{})}))}}))
 const tools=await host.rpc('_goose/unstable/tools/list',{sessionId:session.sessionId})
 console.log(JSON.stringify({tools:tools.tools.map(t=>t.name)}))
 await writeFile(join(fixture,'evidence','tools.json'),JSON.stringify(tools,null,2))
 await setBootstrap(host,session.sessionId,'ROVAI_GOOSE_BOOTSTRAP_A')
 checks.questionTools={modes:{}}
 for(const mode of ['auto','approve','smart_approve']){
   await host.rpc('session/set_mode',{sessionId:session.sessionId,modeId:mode})
   const native=await host.rpc('_goose/unstable/tools/list',{sessionId:session.sessionId})
   const offset=requests.length
   await prompt(host,session.sessionId,'PROBE_TOOLSET_'+mode)
   const advertised=[...new Set(requests.slice(offset).flatMap(r=>(r.tools??[]).map(t=>t.function?.name??t.name)))].sort()
   assert(advertised.length>0,'Inspect the tools actually sent to the Provider')
   const names=native.tools.map(t=>t.name).sort()
   const questions=[...names,...advertised].filter(name=>/askuser|requestuserinput|askquestion/.test(name.toLowerCase().replace(/[^a-z0-9]/g,'')))
   assert.deepEqual(questions,[],mode+' must not advertise ask_user-style tools')
   checks.questionTools.modes[mode]={native:names,provider:advertised,askUserTools:questions}
 }
 await host.rpc('session/set_mode',{sessionId:session.sessionId,modeId:'auto'})
 const inventory=await host.rpc('_goose/unstable/providers/list',{providerIds:['openai']})
 checks.catalog={providers:inventory.entries.map(p=>({id:p.providerId,configured:p.configured,available:p.available,modelCount:p.models.length})),providerOptions:session.configOptions.find(c=>c.id==='provider').options.length}
 const first=await prompt(host,session.sessionId,'GOOSE_FIRST_INPUT')
 assert.equal(first.stopReason,'end_turn')
 checks.first={stopReason:first.stopReason,ordinary:checkBootstrap(0,'ROVAI_GOOSE_BOOTSTRAP_A'),auxiliary:requests.filter(r=>!r.tools?.length).length}
 let start=requests.length
 await setBootstrap(host,session.sessionId,'ROVAI_GOOSE_BOOTSTRAP_B')
 const warm=await prompt(host,session.sessionId,'GOOSE_WARM_INPUT')
 assert.equal(warm.stopReason,'end_turn')
 checks.warm={pid:host.pid,ordinary:checkBootstrap(start,'ROVAI_GOOSE_BOOTSTRAP_B','ROVAI_GOOSE_BOOTSTRAP_A')}
 await host.close()
 const cold=await open()
 const replayOffset=frames.length
 await cold.rpc('session/load',{sessionId:session.sessionId,cwd:join(fixture,'workspace'),mcpServers:[],_meta:{replayTail:1}})
 const replayText=frames.slice(replayOffset).flatMap(m=>m.params?.update?.content?.text??[]).join('\n')
 assert(!replayText.includes('GOOSE_FIRST_INPUT'),'Client replay must omit older turns')
 start=requests.length
 await setBootstrap(cold,session.sessionId,'ROVAI_GOOSE_BOOTSTRAP_C')
 const resumed=await prompt(cold,session.sessionId,'GOOSE_COLD_INPUT')
 assert.equal(resumed.stopReason,'end_turn')
 checks.cold={pid:cold.pid,sameSession:session.sessionId,ordinary:checkBootstrap(start,'ROVAI_GOOSE_BOOTSTRAP_C','ROVAI_GOOSE_BOOTSTRAP_B')}
 assert(requests.slice(start).some(r=>r.tools?.length&&JSON.stringify(r.messages).includes('GOOSE_FIRST_INPUT')),'Trimming client replay must retain native model history')
 checks.clientReplay={tail:1,oldClientTurnOmitted:true,nativeModelHistoryPreserved:true}
 try{await cold.rpc('session/load',{sessionId:'rovai-does-not-exist',cwd:join(fixture,'workspace'),mcpServers:[]});assert.fail('Missing native Session must fail')}catch(error){assert(error.rpcError);checks.missingSession={code:error.rpcError.code,data:error.rpcError.data}}
 const model=await cold.rpc('session/set_config_option',{sessionId:session.sessionId,configId:'model',value:'gpt-6.1-sol'})
 const effort=model.configOptions.find(c=>c.id==='thinking_effort')
 assert(effort.options.some(o=>o.value==='high'))
 await cold.rpc('session/set_config_option',{sessionId:session.sessionId,configId:'thinking_effort',value:'high'})
 start=requests.length
 const modelFramesStart=frames.length
 await prompt(cold,session.sessionId,'GOOSE_REASONING_INPUT')
 const modelRequest=requests.slice(start).find(r=>r.tools?.length)
 const reasoning=modelRequest.reasoning_effort??modelRequest.reasoning?.effort
 assert.equal(modelRequest.model,'gpt-6.1-sol');assert.equal(reasoning,'high')
 assert(frames.slice(modelFramesStart).some(m=>m.params?.update?.sessionUpdate==='agent_message_chunk'&&m.params.update.content?.text?.includes('GOOSE_NATIVE_FIXTURE_OK')))
 checks.model={model:modelRequest.model,reasoning,encoding:modelRequest.input?'responses':'chat',choices:effort.options.map(o=>o.value)}
 await cold.rpc('session/set_config_option',{sessionId:session.sessionId,configId:'model',value:'gpt-4o-mini'})
 start=requests.length
 const largeMarker='ROVAI_LARGE_BOOTSTRAP_'.repeat(4000)
 await setBootstrap(cold,session.sessionId,largeMarker)
 await prompt(cold,session.sessionId,'GOOSE_LARGE_BOOTSTRAP')
 checkBootstrap(start,largeMarker)
 checks.largeBootstrap={bytes:Buffer.byteLength(bootstrap(largeMarker)),verbatim:true}
 await setBootstrap(cold,session.sessionId,'ROVAI_GOOSE_BOOTSTRAP_C')
 let finished=false
 const running=prompt(cold,session.sessionId,'PROBE_STEER_ACTIVE').then(r=>{finished=true;return r})
 running.catch(()=>{})
 await until(()=>steerEntered&&activeRun(session.sessionId))
 const runId=activeRun(session.sessionId),submitted=performance.now()
 const steer=await cold.rpc('_goose/unstable/session/steer',{sessionId:session.sessionId,expectedRunId:runId,prompt:[{type:'text',text:'PROBE_STEER_CORRECTION_A'}]})
 const receiptMs=performance.now()-submitted
 assert.equal(steer.runId,runId);assert.equal(typeof steer.messageId,'string');assert.equal(finished,false)
 const steer2=await cold.rpc('_goose/unstable/session/steer',{sessionId:session.sessionId,expectedRunId:runId,prompt:[{type:'text',text:'PROBE_STEER_CORRECTION_B'}]})
 assert.notEqual(steer.messageId,steer2.messageId);assert.equal(finished,false)
 try{await cold.rpc('_goose/unstable/session/steer',{sessionId:session.sessionId,expectedRunId:'wrong-run',prompt:[{type:'text',text:'NEVER_ADMIT'}]});assert.fail('Wrong native Run must fail')}catch(error){assert.equal(error.rpcError?.code,-32602)}
 releaseSteer()
 const steered=await running
 assert.equal(steered.stopReason,'end_turn')
 assert(requests.some(r=>r.tools?.length&&JSON.stringify(r.messages??r.input??[]).includes('PROBE_STEER_CORRECTION_A')))
 assert(requests.some(r=>r.tools?.length&&JSON.stringify(r.messages??r.input??[]).includes('PROBE_STEER_CORRECTION_B')))
 checks.steer={receiptMs,receiptBeforeCompletion:true,messageIds:[steer.messageId,steer2.messageId],wrongRunRejected:true,stopReason:steered.stopReason}
 const cancelling=prompt(cold,session.sessionId,'PROBE_CANCEL_ACTIVE')
 cancelling.catch(()=>{})
 await until(()=>cancelEntered)
 const cancelStart=performance.now()
 cold.notify('session/cancel',{sessionId:session.sessionId})
 const cancelled=await cancelling
 assert.equal(cancelled.stopReason,'cancelled')
 const cancelMs=performance.now()-cancelStart
 releaseCancel()
 const next=await prompt(cold,session.sessionId,'GOOSE_AFTER_CANCEL')
 assert.equal(next.stopReason,'end_turn')
 checks.cancel={ms:cancelMs,stopReason:cancelled.stopReason,samePidSuccessor:cold.pid,next:next.stopReason}
 let offset=frames.length
 const files=await prompt(cold,session.sessionId,'PROBE_FILES')
 assert.equal(files.stopReason,'end_turn')
 assert.equal(await readFile(join(fixture,'workspace','测试 空格.txt'),'utf8'),'第一行（编辑）\n保留行\n')
 const fileFrames=frames.slice(offset).filter(m=>['tool_call','tool_call_update'].includes(m.params?.update?.sessionUpdate))
 assert(!fileFrames.some(m=>m.params.update.status==='failed'))
 checks.files={calls:fileFrames.map(m=>({id:m.params.update.toolCallId,title:m.params.update.title,status:m.params.update.status,kind:m.params.update.kind,contentTypes:m.params.update.content?.map(c=>c.type),rawOutputKeys:Object.keys(m.params.update.rawOutput??{}),metaKeys:Object.keys(m.params.update._meta??{})}))}
 offset=frames.length
 await prompt(cold,session.sessionId,'PROBE_SHELL')
 const shellFrames=frames.slice(offset).filter(m=>m.params?.update?.sessionUpdate==='tool_call_update')
 checks.shell=shellFrames.map(m=>({status:m.params.update.status,rawOutput:m.params.update.rawOutput,content:m.params.update.content}))
 assert(JSON.stringify(shellFrames).includes('GOOSE_STDOUT'));assert(JSON.stringify(shellFrames).includes('GOOSE_STDERR'))
 for(const kind of ['EMPTY','LARGE']){
   offset=frames.length
   await prompt(cold,session.sessionId,'PROBE_SHELL_'+kind)
   const terminal=frames.slice(offset).map(m=>m.params?.update).find(u=>u?.sessionUpdate==='tool_call_update'&&u.status==='completed'&&u.rawOutput)
   assert(terminal)
   if(kind==='EMPTY'){assert.equal(terminal.rawOutput.stdout,'');assert.equal(terminal.rawOutput.stderr,'')}
   else assert.equal(terminal.rawOutput.stdout.length,9000)
   checks['shell'+kind]={stdoutBytes:Buffer.byteLength(terminal.rawOutput.stdout),stderrBytes:Buffer.byteLength(terminal.rawOutput.stderr),exitCode:terminal.rawOutput.exit_code}
 }
 await cold.rpc('session/set_mode',{sessionId:session.sessionId,modeId:'approve'})
 cold.permissionChoice='deny'
 const denied=await prompt(cold,session.sessionId,'PROBE_PERMISSION_DENY')
 try{await access(join(fixture,'workspace','denied.txt'));assert.fail('Denied native write executed')}catch(error){assert.equal(error.code,'ENOENT')}
 cold.permissionChoice='allow'
 const allowed=await prompt(cold,session.sessionId,'PROBE_PERMISSION_ALLOW')
 assert.equal(await readFile(join(fixture,'workspace','allowed.txt'),'utf8'),'GOOSE_PERMISSION_EFFECT\n')
 checks.permissions={deny:denied.stopReason,allow:allowed.stopReason,denyEffect:false,allowEffect:true}
 await cold.rpc('session/set_mode',{sessionId:session.sessionId,modeId:'auto'})
 offset=frames.length
 await prompt(cold,session.sessionId,'PROBE_SKILL_A')
 assert(JSON.stringify(frames.slice(offset)).includes('GOOSE_SKILL_A'))
 await writeFile(skillFile,skillText('GOOSE_SKILL_B'))
 offset=frames.length
 await prompt(cold,session.sessionId,'PROBE_SKILL_B')
 assert(frames.slice(offset).some(m=>m.params?.update?.sessionUpdate==='tool_call_update'&&JSON.stringify(m.params.update.content).includes('GOOSE_SKILL_B')))
 await unlink(skillFile)
 offset=frames.length
 await prompt(cold,session.sessionId,'PROBE_SKILL_DELETED')
 assert(frames.slice(offset).some(m=>m.params?.update?.sessionUpdate==='tool_call_update'&&m.params.update.status==='failed'))
 checks.skills={read:true,updatedInSameHost:true,deletedRejected:true}
 offset=frames.length
 let parentFinished=false
 const delegatedRun=prompt(cold,session.sessionId,'PROBE_DELEGATE').then(value=>{parentFinished=true;return value})
 delegatedRun.catch(()=>{})
 await until(()=>childEntered)
 assert.equal(parentFinished,false,'Parent prompt must wait for its native foreground child')
 releaseChild()
 await delegatedRun
 const delegated=frames.slice(offset).filter(m=>m.params?.update?.sessionUpdate==='tool_call_update')
 assert(delegated.some(m=>m.params.update.status==='completed'))
 assert(requests.some(r=>r.messages?.some(m=>m.role==='user'&&String(m.content).includes('completed: {"summary":"GOOSE_NATIVE_CHILD_SUCCESS"}'))))
 const childRequests=requests.filter(r=>r.tools?.some(t=>t.function?.name==='recipe__final_output'))
 assert(childRequests.length>0)
 assert(childRequests.every(r=>r.messages.filter(m=>['system','developer'].includes(m.role)).every(m=>!String(m.content).includes('ROVAI_GOOSE_BOOTSTRAP_'))))
 checks.delegate={completed:true,parentWaitsForChild:true,nativeReportReachedParent:true,childInheritsParentBootstrap:false,updates:delegated.map(m=>({id:m.params.update.toolCallId,status:m.params.update.status}))}
 const cancelChildRun=prompt(cold,session.sessionId,'PROBE_DELEGATE_CANCEL')
 cancelChildRun.catch(()=>{})
 await until(()=>childCancelEntered)
 cold.notify('session/cancel',{sessionId:session.sessionId})
 const cancelledChild=await cancelChildRun
 assert.equal(cancelledChild.stopReason,'cancelled')
 await until(()=>childCancelDisconnected)
 releaseChildCancel()
 const afterChildCancel=await prompt(cold,session.sessionId,'GOOSE_AFTER_CHILD_CANCEL')
 assert.equal(afterChildCancel.stopReason,'end_turn')
 checks.delegateCancel={stopReason:cancelledChild.stopReason,childProviderDisconnectedBeforeRelease:true,samePidSuccessor:cold.pid,next:afterChildCancel.stopReason}
 offset=frames.length
 await prompt(cold,session.sessionId,'PROBE_AUTO_COMPACT')
 start=requests.length
 await prompt(cold,session.sessionId,'GOOSE_AFTER_AUTO_COMPACT')
 const compaction=frames.slice(offset).filter(m=>m.params?.update?.sessionUpdate==='status_message'&&/Performing auto-compaction|Compaction complete/.test(m.params.update.status?.message??''))
 assert(compaction.some(m=>m.params.update.status.message.includes('Performing auto-compaction')),'Native threshold compaction must actually start')
 assert(compaction.some(m=>m.params.update.status.message==='Compaction complete'),'Native threshold compaction must actually finish')
 assert(requests.some(r=>!r.tools?.length&&r.messages?.[0]?.content?.startsWith('## Task Context')),'Native summarization must reach the provider')
 checkBootstrap(start,'ROVAI_GOOSE_BOOTSTRAP_C')
 checks.automaticCompaction={nativeStatuses:compaction.map(m=>m.params.update.status.message),bootstrapPreserved:true,messageUsageObserved:frames.slice(offset).some(m=>m.params?.update?.sessionUpdate==='message_usage'&&m.params.update.usage?.isCompaction)}
 offset=frames.length
 const overflow=await prompt(cold,session.sessionId,'PROBE_OVERFLOW')
 assert.equal(overflow.stopReason,'end_turn')
 assert(frames.slice(offset).some(m=>m.params?.update?.sessionUpdate==='status_message'&&m.params.update.status?.message==='Compaction complete'))
 checks.overflow={injected:overflowInjected,compacted:true,stopReason:overflow.stopReason}
 const mcp=(name,source)=>({name,command:process.execPath,args:[join(repo,'crates/rovai-core/tests/fixtures/mcp-smoke-server.mjs')],env:[{name:'ROVAI_MCP_SMOKE_SOURCE',value:source}]})
 const mcpSession=await cold.rpc('session/new',{cwd:join(fixture,'workspace'),mcpServers:[mcp('rovai_parity_a','GOOSE_MCP_A')]})
 const toolsBefore=await cold.rpc('_goose/unstable/tools/list',{sessionId:mcpSession.sessionId})
 assert(toolsBefore.tools.some(t=>t.name.includes('parity_a')))
 offset=frames.length
 await prompt(cold,mcpSession.sessionId,'PROBE_MCP_A')
 assert(JSON.stringify(frames.slice(offset)).includes('GOOSE_MCP_A:GOOSE_MCP_MARKER'))
 await cold.close()
 const restored=await open()
 await restored.rpc('session/load',{sessionId:mcpSession.sessionId,cwd:join(fixture,'workspace'),mcpServers:[mcp('rovai_parity_b','GOOSE_MCP_B')]})
 await restored.rpc('session/load',{sessionId:mcpSession.sessionId,cwd:join(fixture,'workspace'),mcpServers:[]})
 const additive=await restored.rpc('_goose/unstable/tools/list',{sessionId:mcpSession.sessionId})
 assert(additive.tools.some(t=>t.name.includes('parity_a')));assert(additive.tools.some(t=>t.name.includes('parity_b')))
 const extensions=await restored.rpc('_goose/unstable/session/extensions/list',{sessionId:mcpSession.sessionId})
 assert(extensions.extensions.some(e=>e.extensionKey==='rovai_parity_a'))
 assert(extensions.extensions.some(e=>e.extensionKey==='rovai_parity_b'))
 await restored.rpc('_goose/unstable/session/extensions/remove',{sessionId:mcpSession.sessionId,extensionKey:'rovai_parity_a'})
 await restored.rpc('_goose/unstable/session/extensions/remove',{sessionId:mcpSession.sessionId,extensionKey:'rovai_parity_b'})
 const removed=await restored.rpc('_goose/unstable/tools/list',{sessionId:mcpSession.sessionId})
 assert(!removed.tools.some(t=>t.name.includes('parity_')))
 // A local response deadline does not cancel a native database mutation.
 const lateMcp={...mcp('rovai_parity_late','GOOSE_MCP_LATE'),env:[]}
 await restored.rpc('_goose/unstable/session/extensions/add',{sessionId:mcpSession.sessionId,extension:{type:'mcp',server:lateMcp}})
 const nativeDb=new DatabaseSync(join(fixture,'goose-root','data','sessions','sessions.db'))
 try{
  nativeDb.exec('BEGIN IMMEDIATE')
  await assert.rejects(restored.rpc('_goose/unstable/session/extensions/remove',{sessionId:mcpSession.sessionId,extensionKey:lateMcp.name},50),/Timeout/)
  assert.equal(restored.pendingCount,0)
  nativeDb.exec('ROLLBACK')
  await sleep(100)
  const afterLate=await restored.rpc('_goose/unstable/session/extensions/list',{sessionId:mcpSession.sessionId})
  assert(!afterLate.extensions.some(e=>e.extensionKey===lateMcp.name),'Native removal can complete after the client has stopped waiting')
  await restored.rpc('session/load',{sessionId:mcpSession.sessionId,cwd:join(fixture,'workspace'),mcpServers:[lateMcp],_meta:{replayTail:1}})
  await sleep(100)
  const reassigned=await restored.rpc('_goose/unstable/tools/list',{sessionId:mcpSession.sessionId})
  assert(reassigned.tools.some(t=>t.name.includes('parity_late')))
  checks.lateRemoval={clientWaiterReleased:true,nativeEffectAfterTimeout:true,reassignmentAfterCompletionRetained:true}
  await restored.rpc('_goose/unstable/session/extensions/remove',{sessionId:mcpSession.sessionId,extensionKey:lateMcp.name})
 }finally{if(nativeDb.isTransaction)nativeDb.exec('ROLLBACK');nativeDb.close()}
 await restored.close()
 await checkOfflineMcpLoads()
 const afterMcp=await open()
 start=requests.length
 await afterMcp.rpc('session/load',{sessionId:mcpSession.sessionId,cwd:join(fixture,'workspace'),mcpServers:[],_meta:{replayTail:1}})
 await prompt(afterMcp,mcpSession.sessionId,'GOOSE_SESSION_ISOLATION')
 assert(requests.slice(start).filter(r=>r.tools?.length).every(r=>!JSON.stringify(r.messages).includes('ROVAI_GOOSE_BOOTSTRAP_C')))
 await afterMcp.rpc('session/load',{sessionId:session.sessionId,cwd:join(fixture,'workspace'),mcpServers:[]})
 start=requests.length
 await setBootstrap(afterMcp,session.sessionId,'ROVAI_GOOSE_BOOTSTRAP_D')
 await prompt(afterMcp,session.sessionId,'GOOSE_COLD_AFTER_COMPACTION')
 checkBootstrap(start,'ROVAI_GOOSE_BOOTSTRAP_D','ROVAI_GOOSE_BOOTSTRAP_C')
 checks.coldAfterCompaction={sameSession:session.sessionId,bootstrapPreserved:true}
 await afterMcp.close()
 const finalHost=await open()
 await finalHost.rpc('session/load',{sessionId:mcpSession.sessionId,cwd:join(fixture,'workspace'),mcpServers:[]})
 const removedAfterCold=await finalHost.rpc('_goose/unstable/tools/list',{sessionId:mcpSession.sessionId})
 assert(!removedAfterCold.tools.some(t=>t.name.includes('parity_')))
 checks.mcp={modelCalledServer:true,restoreIsAdditive:true,emptyListKeepsOldServers:true,nativeListKeys:true,nativeRemoveWorks:true,coldRemovePersists:true,sessionBootstrapIsolated:true,remainingBuiltinTools:removed.tools.length}
 const nativeUsage=frames.filter(m=>m.method==='_goose/unstable/session/update').map(m=>m.params.update)
 const messageUsage=nativeUsage.find(u=>u.sessionUpdate==='message_usage'&&u.usage.inputTokens===100&&u.usage.outputTokens===20&&u.usage.cacheReadTokens===10)
 assert(messageUsage)
 assert.equal(messageUsage.usage.costSource,'estimated')
 assert(nativeUsage.some(u=>u.sessionUpdate==='usage_update'&&u.accumulatedInputTokens>120000))
 checks.usage={messageUsage:messageUsage.usage,cumulativeIncludesCompaction:true,compactionMessageUsageObserved:checks.automaticCompaction.messageUsageObserved,inputSemantics:'cache_inclusive_total'}
 const elicitationMarker=join(fixture,'evidence','elicitation.json')
 const elicitationSession=await finalHost.rpc('session/new',{cwd:join(fixture,'workspace'),mcpServers:[{
   name:'rovai_elicitation',command:process.execPath,args:[join(repo,'scripts/fixtures/goose-mcp-elicitation.mjs')],
   env:[{name:'ROVAI_GOOSE_ELICITATION_MARKER',value:elicitationMarker}]
 }]})
 offset=frames.length
 const elicited=await prompt(finalHost,elicitationSession.sessionId,'PROBE_ELICITATION')
 assert.equal(elicited.stopReason,'end_turn')
 const elicitationResult=JSON.parse(await readFile(elicitationMarker,'utf8'))
 assert.equal(elicitationResult.result.action,'cancel')
 assert.equal(elicitationResult.result.content,undefined,'Cancelled form must not synthesize user answers')
 assert(!frames.slice(offset).some(m=>m.method==='elicitation/create'),'Client did not advertise form support')
 const afterElicitation=await prompt(finalHost,elicitationSession.sessionId,'GOOSE_AFTER_ELICITATION')
 assert.equal(afterElicitation.stopReason,'end_turn')
 checks.elicitation={withoutClientCapability:'native_cancel',noSyntheticAnswers:true,next:afterElicitation.stopReason}
 await writeFile(join(fixture,'evidence','session.json'),JSON.stringify(session,null,2))
 }
 await writeFile(join(fixture,'evidence','checks.json'),JSON.stringify(checks,null,2))
 console.log(JSON.stringify({checks,requestCount:requests.length,timings}))
}catch(error){
 await writeFile(join(fixture,'evidence','partial-checks.json'),JSON.stringify({checks,error:error.message},null,2))
 console.error(JSON.stringify({error:error.message,stack:error.stack?.split('\n').slice(0,4),rpcError:error.rpcError,stderr:hosts.map(h=>h.stderr.slice(-4000))}))
 process.exitCode=1
}finally{
 releaseSteer();releaseCancel();releaseChild();releaseChildCancel()
 for(const h of hosts)await h.close()
 await writeFile(join(fixture,'evidence','provider-requests.json'),JSON.stringify(requests,null,2))
 await writeFile(join(fixture,'evidence','frames.json'),JSON.stringify(frames,null,2))
 await writeFile(join(fixture,'evidence','stderr.log'),hosts.map(h=>h.stderr).join('\n'))
 await new Promise(r=>provider.close(r))
}
