// Real Core + official Goose; owned roots and a synthetic loopback Provider.
// ROVAI_GOOSE_BIN=/absolute/path/to/goose node scripts/smoke-goose-runtime.mjs
import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
import {createConnection} from 'node:net'
import {DatabaseSync} from 'node:sqlite'
import {createInterface} from 'node:readline'
import {copyFile,mkdtemp,mkdir,realpath,readFile,readdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,isAbsolute} from 'node:path'
import {configureProductRuntime} from './configure-product-runtime.mjs'
import {createConfiguredCampAndSend,composerDocumentForAddress} from './lib/create-configured-camp.mjs'
import {coreDataDirectoryArguments,removeEphemeralRuntimeCampFilesRoot} from './lib/runtime-camp-files-root.mjs'

assert(process.platform!=='win32','This fixture uses POSIX shell commands; it does not qualify Windows')
const executable=process.env.ROVAI_GOOSE_BIN
assert(executable&&isAbsolute(executable),'ROVAI_GOOSE_BIN must be an absolute official executable')
const repo=resolve(import.meta.dirname,'..')
const root=await realpath(await mkdtemp(join(tmpdir(),'rovai-goose-core-')))
for(const part of ['home','project','core','config','data','cache','state','evidence','service','goose-root','bundled tools'])await mkdir(join(root,part))
const project=join(root,'project'),data=join(root,'core'),binaries=join(root,'bundled tools')
for(const name of ['rovai-core','rovai'])await copyFile(join(repo,'target/debug',name),join(binaries,name))
execFileSync('git',['init','--quiet',project])
const calls=[],events=[],result={root,platform:process.platform+'-'+process.arch,provider:'synthetic-loopback',checks:{}}
let gate,approvalDecision='allow_once',compactInjected=false,overflowInjected=false,newLease
function hold(marker){let enter,release;const entered=new Promise(r=>enter=r),wait=new Promise(r=>release=r);return gate={marker,enter,entered,release,wait,held:false}}
const provider=createServer(async(req,res)=>{
 try{
  if(req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({object:'list',data:['gpt-4o-mini','gpt-5','gpt-6.1-sol'].map(id=>({id,object:'model',owned_by:'fixture'}))}));return}
  let raw='';for await(const part of req)raw+=part
  const body=JSON.parse(raw);calls.push(body)
  const messages=body.messages??body.input??[]
  const userIndex=messages.findLastIndex(m=>m.role==='user')
  const user=messages[userIndex],text=typeof user?.content==='string'?user.content:JSON.stringify(user?.content)
  const marker=text?.match(/CORE_GOOSE_[A-Z0-9_]+/g)?.at(-1)
  const names=(body.tools??[]).map(t=>t.function?.name??t.name)
  const child=names.includes('recipe__final_output')
  const used=messages.slice(userIndex+1).flatMap(m=>m.tool_calls?.map(t=>t.function.name)??(m.type==='function_call'?[m.name]:[]))
  if(names.length&&marker==='CORE_GOOSE_OVERFLOW'&&!overflowInjected){overflowInjected=true;res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'maximum context length exceeded',type:'invalid_request_error',code:'context_length_exceeded'}}));return}
  const cliUsed=messages.slice(userIndex+1).some(m=>(m.tool_calls??[]).some(t=>t.function.name==='shell'&&JSON.parse(t.function.arguments).command?.includes('rovai send'))||(m.type==='function_call'&&m.name==='shell'&&JSON.parse(m.arguments).command?.includes('rovai send')))
  if(names.length&&!child&&gate&&marker===gate.marker&&!gate.held){const current=gate;current.held=true;current.enter();await current.wait}
  if(res.destroyed)return
  if(marker==='CORE_GOOSE_AFTER_CANCEL'&&!newLease)newLease=await cliContext()
  let call
  if(child&&!used.includes('recipe__final_output'))call={name:'recipe__final_output',args:{summary:'GOOSE_CHILD_REPORT'}}
  else if(marker==='CORE_GOOSE_FILES'&&!used.includes('write'))call={name:'write',args:{path:'测试 空格.txt',content:'第一行\n保留行\n'}}
  else if(marker==='CORE_GOOSE_FILES'&&!used.includes('edit'))call={name:'edit',args:{path:'测试 空格.txt',before:'第一行',after:'第一行（编辑）'}}
  else if(marker==='CORE_GOOSE_APPROVAL'&&!used.includes('write'))call={name:'write',args:{path:'approved.txt',content:'GOOSE_NATIVE_APPROVAL\n'}}
  else if(marker==='CORE_GOOSE_LARGE'&&!used.includes('shell'))call={name:'shell',args:{command:"printf 'GOOSE_LONG_START'; printf '%09000d' 0; printf 'GOOSE_LONG_DISCARDED'"}}
  else if(marker?.startsWith('CORE_GOOSE_MCP_')&&!used.some(n=>n.endsWith('__echo'))&&names.some(n=>n.endsWith('__echo')))call={name:names.find(n=>n.endsWith('__echo')),args:{text:marker}}
  else if(marker==='CORE_GOOSE_DELEGATE'&&!used.includes('delegate'))call={name:'delegate',args:{instructions:'GOOSE_CHILD_REPORT',max_turns:2}}
  else if(marker==='CORE_GOOSE_SKILL'&&!used.includes('load_skill'))call={name:'load_skill',args:{name:'rovai-goose-core-smoke'}}
  else if(names.length&&!child&&!cliUsed)call={name:'shell',args:{command:'rovai send --public-only --body GOOSE_CORE_PUBLIC; printf GOOSE_STDOUT; printf GOOSE_STDERR >&2'}}
  const content='GOOSE_CORE_FIXTURE_OK'
  const usage={prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:10}}
  if(names.length&&marker==='CORE_GOOSE_COMPACT'&&!compactInjected){compactInjected=true;usage.prompt_tokens=120000;usage.total_tokens=120020}
  const id='fixture_'+calls.length
  if(body.input){
   const item=call?{id:'fc_'+id,type:'function_call',call_id:'call_'+id,name:call.name,arguments:JSON.stringify(call.args),status:'completed'}:{id:'msg_'+id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:content,annotations:[]}]}
   const response={id:'resp_'+id,object:'response',created_at:1,model:body.model,status:'completed',output:[item],usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:10},output_tokens_details:{reasoning_tokens:0}}}
   if(body.stream){
    res.writeHead(200,{'content-type':'text/event-stream'})
    const added=call?{...item,arguments:'',status:'in_progress'}:{...item,status:'in_progress',content:[]}
    const frames=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:added}]
    if(call)frames.push({type:'response.function_call_arguments.delta',item_id:item.id,output_index:0,delta:item.arguments},{type:'response.function_call_arguments.done',item_id:item.id,output_index:0,arguments:item.arguments})
    else frames.push({type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:content},{type:'response.output_text.done',item_id:item.id,output_index:0,content_index:0,text:content})
    frames.push({type:'response.output_item.done',output_index:0,item},{type:'response.completed',response})
    frames.forEach((frame,sequence_number)=>res.write('event: '+frame.type+'\ndata: '+JSON.stringify({...frame,sequence_number})+'\n\n'));res.end()
   }else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response))}
  }else if(body.stream){
   res.writeHead(200,{'content-type':'text/event-stream'})
   const base={id,object:'chat.completion.chunk',created:1,model:body.model}
   const delta=call?{role:'assistant',tool_calls:[{index:0,id:'call_'+id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{role:'assistant',content}
   res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta,finish_reason:null}]})+'\n\n')
   res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}],usage})+'\n\n');res.end('data: [DONE]\n\n')
  }else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id,object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage}))}
 }catch(error){console.error(error);res.destroy(error)}
})
await new Promise(r=>provider.listen(0,'127.0.0.1',r))
const environment={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:join(root,'home'),XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),XDG_STATE_HOME:join(root,'state'),GOOSE_PATH_ROOT:join(root,'goose-root'),GOOSE_DISABLE_KEYRING:'1',GOOSE_PROVIDER:'openai',GOOSE_MODEL:'gpt-4o-mini',GOOSE_MODE:'auto',GOOSE_AUTO_COMPACT_THRESHOLD:'0.5',OPENAI_API_KEY:'fixture-key',OPENAI_HOST:'http://127.0.0.1:'+provider.address().port,OPENAI_BASE_PATH:'v1/chat/completions',TERM:'dumb',NO_COLOR:'1',TMPDIR:root,ROVAI_GOOSE_BIN:executable}
assert.throws(()=>execFileSync('node',['--version'],{env:environment,stdio:'pipe'}),e=>e.code==='ENOENT');result.checks.noImplicitNode=true
let core, index=0
async function openCore(){
  const child=spawn(join(binaries,'rovai-core'),[...coreDataDirectoryArguments(data,{homeDirectory:join(root,'home')}),'--skill-library-root',join(data,'managed-skill-library'),'--mcp-config-path',join(data,'mcp.json')],{cwd:repo,env:environment,stdio:['pipe','pipe','pipe']})
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
const delay=()=>new Promise(r=>setTimeout(r,100))
async function until(test,label){const end=Date.now()+30000;while(!(await test())){assert(Date.now()<end,label);await delay()}}
let threadId
async function waitForRun(messageId){
 const end=Date.now()+90000,resolved=new Set()
 while(Date.now()<end){
  const snapshot=await core.request('camps.snapshot',{threadId})
  for(const approval of snapshot.approvals.filter(a=>a.status==='pending'&&!resolved.has(a.id))){
   const option=approval.options.find(o=>o.kind===approvalDecision);assert(option)
   const receipt=await core.request('action.approvals.resolve',{commandId:crypto.randomUUID(),threadId,approvalId:approval.id,expectedVersion:approval.version,optionId:option.optionId,reason:'Goose native approval acceptance'})
   assert.notEqual(receipt.status,'rejected');resolved.add(approval.id)
  }
  const run=snapshot.agentRuns.find(r=>r.anchorMessageId===messageId||r.triggerThreadMessageId===messageId||r.triggerCampMessageId===messageId)
    ??snapshot.agentRuns.find(r=>r.id===events.findLast(e=>e.method==='agent_run.created'&&(e.params?.triggerThreadMessageId===messageId||e.params?.triggerCampMessageId===messageId))?.params.agentRunId)
  if(run&&['succeeded','failed','cancelled'].includes(run.status))return {run,snapshot,approvals:resolved.size}
  await delay()
 }
 throw Error('Run deadline '+messageId)
}
const send=body=>core.request('thread.messages.send',{commandId:crypto.randomUUID(),threadId,content:composerDocumentForAddress({mode:'explicit',agentIds:['agent_2']},body),sourceAttachments:[],quotes:[],replyToThreadMessageId:null,execution:{taskId:null,purpose:'Goose acceptance',completionRole:'required'}})
async function settle(sent){
 const receipt=sent.commandResult??sent;assert.equal(receipt.status,'accepted',JSON.stringify(receipt))
 const done=await waitForRun(receipt.payload.threadMessageId)
 assert.equal(done.run.status,'succeeded',JSON.stringify(done.run))
 const started=events.find(e=>e.method==='agent_run.started'&&e.params?.agentRunId===done.run.id)?.params
 assert(started,'Native dispatch must be acknowledged')
 console.log(JSON.stringify({run:done.run.id,status:done.run.status,host:started.hostInstanceId}))
 return {...done,started}
}
async function setMember(modelId='openai/gpt-4o-mini',options={},mode='auto'){
 const profile=await core.request('members.get',{agentId:'agent_2'})
 const changed=await core.request('members.runtime.set',{commandId:crypto.randomUUID(),command:{agentId:'agent_2',expectedVersion:profile.version,adapterKind:'goose-cli',model:{mode:'explicit',modelId,options},permissions:{...profile.runtimeConfiguration.permissions,values:{mode}}}})
 assert.equal(changed.status,'applied',JSON.stringify(changed))
}
async function active(){
 let found;await until(async()=>{const snapshot=await core.request('camps.snapshot',{threadId});found=snapshot.agentRuns.find(r=>r.status==='running');return !!found},'Active Run deadline');return found
}
async function cliContext(){
 const contexts=[];for(const id of await readdir(join(data,'runtime','builtin-tools'))){const context=await readFile(join(data,'runtime','builtin-tools',id,'context.json'),'utf8').then(JSON.parse).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));if(context?.lease)contexts.push(context)}
 assert.equal(contexts.length,1);return contexts[0]
}
const owner=async run=>JSON.parse(await readFile(join(data,'runtime-fleet','owners',run.started.hostInstanceId+'.json'),'utf8'))
try{
 console.log(JSON.stringify({channel:'automatic-acceptance',root,dataDir:data,skillRoot:join(data,'managed-skill-library'),project}))
 core=await openCore();await core.request('health.check')
 await configureProductRuntime(core.request.bind(core),'goose-cli',['agent_2'])
 await setMember()
 const offset=calls.length
 const catalog=await core.request('runtime.modelCatalog.open',{runtimeKind:'goose-cli',waitForRefresh:true})
 assert.equal(catalog.cache.status,'fresh',JSON.stringify(catalog))
 assert(catalog.models.some(m=>m.id==='openai/gpt-6.1-sol'))
 assert.equal(calls.length,offset,'Model discovery must not generate a response')
 result.checks.catalog={models:catalog.models.map(m=>({id:m.id,options:m.options})),modelCalls:0}
 const workspace=await core.request('workspaces.inspect',{path:project})
 const first=await createConfiguredCampAndSend(core.request.bind(core),{commandId:crypto.randomUUID(),workspace,memberAgentIds:['agent_2'],defaultLeadAgentId:'agent_2',address:{mode:'explicit',agentIds:['agent_2']},body:'CORE_GOOSE_FIRST',purpose:'Goose native integration'})
 threadId=(first.commandResult??first).payload.threadId
 const a=await settle(first),b=await settle(await send('CORE_GOOSE_WARM'))
 assert.equal(a.started.hostInstanceId,b.started.hostInstanceId)
 assert.equal(a.started.nativeThreadId,b.started.nativeThreadId)
 const firstOwner=await owner(a),secondOwner=await owner(b);assert.equal(firstOwner.pid,secondOwner.pid)
 const native=new DatabaseSync(join(root,'goose-root','data','sessions','sessions.db'),{readOnly:true})
 try{
  const session=native.prepare('SELECT system_prompt_extras_json FROM sessions WHERE id=?').get(a.started.nativeThreadId)
  const bootstrap=JSON.parse(session.system_prompt_extras_json)['rovai-session-bootstrap']
  assert(bootstrap.includes('[SESSION_CHARTER]')&&bootstrap.includes('[MEMBER_IDENTITY]'))
  const rootCalls=calls.filter(c=>(c.tools??[]).length&&JSON.stringify(c.messages??c.input).includes('CORE_GOOSE_FIRST'))
  assert(rootCalls.length)
  assert(rootCalls.every(c=>(c.messages??[]).some(m=>['system','developer'].includes(m.role)&&typeof m.content==='string'&&m.content.includes(bootstrap))))
  assert(rootCalls.every(c=>!(c.messages??[]).filter(m=>m.role==='user').some(m=>JSON.stringify(m.content).includes('[SESSION_CHARTER]'))))
  result.checks.bootstrap={nativeKey:'rovai-session-bootstrap',bytes:Buffer.byteLength(bootstrap),verbatim:true,dynamicOnly:true}
 }finally{native.close()}
 assert.equal(a.snapshot.messages.filter(m=>m.sourceAgentRunId===a.run.id).length,1)
 const stdout=events.findLast(e=>e.method==='runtime.action'&&e.params?.agentRunId===a.run.id&&e.params?.payload?.status==='completed'&&e.params?.payload?.output?.includes('GOOSE_STDOUT'))
 assert.equal(stdout?.params.payload.output.split('GOOSE_STDOUT').length,2,'A terminal snapshot must not duplicate stdout')
 result.checks.commandOutput={markerOccurrences:1}
 result.checks.warm={host:a.started.hostInstanceId,pid:firstOwner.pid,session:a.started.nativeThreadId}
 const files=await settle(await send('CORE_GOOSE_FILES'))
 assert.equal(await readFile(join(project,'测试 空格.txt'),'utf8'),'第一行（编辑）\n保留行\n')
 const skillRoot=join(project,'.goose','skills','rovai-goose-core-smoke');await mkdir(skillRoot,{recursive:true})
 await writeFile(join(skillRoot,'SKILL.md'),'---\nname: rovai-goose-core-smoke\ndescription: Isolated Core acceptance skill.\n---\nGOOSE_CORE_SKILL_BODY\n')
 const skill=await settle(await send('CORE_GOOSE_SKILL'))
 assert(calls.some(c=>JSON.stringify(c.messages??c.input).includes('GOOSE_CORE_SKILL_BODY')))
 result.checks.skills={nativeRead:true,projectGroup:'.goose/skills'}
 const large=await settle(await send('CORE_GOOSE_LARGE'))
 const largeActions=events.filter(e=>e.method==='runtime.action'&&e.params?.agentRunId===large.run.id&&e.params?.payload?.output?.includes('GOOSE_LONG_START'))
 assert(largeActions.length)
 assert(largeActions.every(e=>Buffer.byteLength(e.params.payload.output,'utf8')<=7680&&!e.params.payload.output.includes('GOOSE_LONG_DISCARDED')),'Shared persistent output budget must apply before publishing evidence')
 result.checks.outputBudget={bytes:7680,discardedTailAbsent:true}
 const child=await settle(await send('CORE_GOOSE_DELEGATE'))
 const agentTools=events.filter(e=>e.method==='runtime.action'&&e.params?.agentRunId===child.run.id&&e.params?.payload?.runtimeToolType==='agent')
 assert(agentTools.some(e=>e.params.payload.toolName==='delegate'),'Native delegate must keep agent-tool provenance')
 result.checks.subagent={nativeDelegate:true,parentWaitsForNativeCompletion:true}
 for(const marker of ['CORE_GOOSE_COMPACT','CORE_GOOSE_OVERFLOW']){
  const compactOffset=calls.length
  await settle(await send(marker))
  assert(calls.slice(compactOffset).some(c=>!c.tools?.length&&(c.messages??[]).some(m=>m.role==='system'&&String(m.content).includes('## Task Context'))),'Native automatic compaction must actually summarize')
 }
 result.checks.compaction={automaticThreshold:true,overflowRecovery:true}
 const target=await core.request('runtime.modelCatalog.open',{runtimeKind:'goose-cli',modelId:'openai/gpt-6.1-sol',forceRefresh:true})
 const targetModel=target.models.find(m=>m.id==='openai/gpt-6.1-sol')
 assert.equal(targetModel.runtimeMetadata.modelOptionsResolved,true,JSON.stringify(target))
 assert(targetModel.options.some(o=>o.key==='thinking_effort'&&o.values.some(v=>v.value==='high')))
 await setMember('openai/gpt-6.1-sol',{thinking_effort:'high'})
 const reasoningOffset=calls.length
 await settle(await send('CORE_GOOSE_REASONING'))
 assert(calls.slice(reasoningOffset).some(c=>c.model==='gpt-6.1-sol'&&c.reasoning?.effort==='high'))
 result.checks.effort={targetModel:'openai/gpt-6.1-sol',nativeKey:'thinking_effort',providerEffort:'high',onDemand:true}
 const defaultsProfile=await core.request('members.get',{agentId:'agent_2'})
 assert.equal((await core.request('members.runtime.set',{commandId:crypto.randomUUID(),command:{agentId:'agent_2',expectedVersion:defaultsProfile.version,adapterKind:'goose-cli',model:{mode:'runtime_default'},permissions:defaultsProfile.runtimeConfiguration.permissions}})).status,'applied')
 const defaultOffset=calls.length
 await settle(await send('CORE_GOOSE_NATIVE_DEFAULT'))
 assert(calls.slice(defaultOffset).filter(c=>c.tools?.length).every(c=>c.model==='gpt-4o-mini'),'Clearing an override must restore the native default on the same Session')
 result.checks.nativeDefaultRestored=true
 await setMember()
 await setMember('openai/gpt-4o-mini',{},'approve')
 const approved=await settle(await send('CORE_GOOSE_APPROVAL'))
 assert(approved.approvals>0,'Native approve mode must cross shared Approval')
 assert.equal(await readFile(join(project,'approved.txt'),'utf8'),'GOOSE_NATIVE_APPROVAL\n')
 result.checks.approval={nativeMode:'approve',resolved:approved.approvals}
 await setMember()
 const steering=hold('CORE_GOOSE_STEER'),steerFirst=await send('CORE_GOOSE_STEER')
 await until(()=>steering.held,'Steer Provider entry deadline');const steeringRun=await active()
 const steerReceipt=await core.request('thread.messages.send',{commandId:crypto.randomUUID(),threadId,content:composerDocumentForAddress({mode:'explicit',agentIds:['agent_2']},'CORE_GOOSE_CORRECTION'),sourceAttachments:[],quotes:[],replyToThreadMessageId:null,deliveryMode:'steer',steerTargets:[{agentRunId:steeringRun.id,executionEpoch:steeringRun.executionEpoch}],execution:{taskId:null,purpose:'Goose native steer acknowledgement',completionRole:'required'}})
 assert.equal(steerReceipt.commandResult.status,'accepted',JSON.stringify(steerReceipt))
 const ledger=new DatabaseSync(join(data,'rovai.sqlite'),{readOnly:true})
 try{await until(()=>ledger.prepare("SELECT count(*) AS n FROM runtime_input_delivery WHERE agent_run_id=? AND input_kind='steer' AND status='accepted'").get(steeringRun.id).n===1,'Native Steer receipt must arrive before original response');assert.equal((await core.request('camps.snapshot',{threadId})).agentRuns.find(r=>r.id===steeringRun.id).status,'running')}
 finally{ledger.close()}
 steering.release();gate=null;const steered=await settle(steerFirst)
 assert(calls.some(c=>JSON.stringify(c.messages??c.input).includes('CORE_GOOSE_CORRECTION')))
 const afterSteer=await settle(await send('CORE_GOOSE_AFTER_STEER'))
 assert.equal(afterSteer.started.hostInstanceId,steered.started.hostInstanceId)
 result.checks.steer={nativeReceiptBeforeCompletion:true,sameRun:true,warmSuccessor:true}
 const cancelling=hold('CORE_GOOSE_CANCEL'),cancelFirst=await send('CORE_GOOSE_CANCEL')
 await until(()=>cancelling.held,'Cancellation Provider entry deadline');const cancelRun=await active()
 const oldLease=await cliContext()
 const cancelStarted=events.find(e=>e.method==='agent_run.started'&&e.params?.agentRunId===cancelRun.id)?.params;assert(cancelStarted)
 const oldOwner=await owner({started:cancelStarted})
 const cancelReceipt=await core.request('agentRuns.cancel',{commandId:crypto.randomUUID(),command:{threadId,agentRunId:cancelRun.id,expectedVersion:cancelRun.version}})
 assert.notEqual(cancelReceipt.status,'rejected',JSON.stringify(cancelReceipt));cancelling.release();gate=null
 const cancelled=await waitForRun((cancelFirst.commandResult??cancelFirst).payload.threadMessageId);assert.equal(cancelled.run.status,'cancelled')
 await until(()=>events.some(e=>e.method==='agent_run.runtime_cleanup_completed'&&e.params?.agentRunId===cancelRun.id),'Cancellation cleanup deadline')
 const afterCancel=await settle(await send('CORE_GOOSE_AFTER_CANCEL'))
 assert.equal(afterCancel.started.hostInstanceId,cancelStarted.hostInstanceId)
 const newOwner=await owner(afterCancel);assert.equal(oldOwner.pid,newOwner.pid)
 const cleanup=events.find(e=>e.method==='agent_run.runtime_cleanup_completed'&&e.params?.agentRunId===cancelRun.id)
 assert.equal(cleanup.params.hostDisposition,'reusable')
 assert(newLease);assert.equal(oldLease.processId,newLease.processId);assert.notEqual(oldLease.lease.leaseId,newLease.lease.leaseId);assert(newLease.lease.leaseGeneration>oldLease.lease.leaseGeneration)
 const stale=await new Promise((resolve,reject)=>{
  const socket=createConnection(oldLease.coreEndpoint.path);socket.setTimeout(10000,()=>socket.destroy(Error('Old lease deadline')));socket.once('error',reject)
  socket.once('connect',()=>socket.write(JSON.stringify({ipcProtocolVersion:oldLease.ipcProtocolVersion,processId:oldLease.processId,processToken:oldLease.processToken,leaseId:oldLease.lease.leaseId,leaseGeneration:oldLease.lease.leaseGeneration,leaseToken:oldLease.lease.leaseToken,kind:'invoke',request_id:crypto.randomUUID(),operation:'thread.message.send',input:{body:'GOOSE_OLD_LEASE_MUST_NOT_PUBLISH',publicOnly:true}})+'\n'))
  createInterface({input:socket}).once('line',line=>{socket.destroy();resolve(JSON.parse(line))})
 })
 assert.equal(stale.error?.code,'builtin_tool.run_not_bound')
 result.checks.cancel={sameHost:true,samePid:true,newRun:true,newLease:true,oldLeaseRejected:true,cleanup:'reusable'}
 const mcpServer=join(root,'service','mcp.mjs'),starts=join(root,'evidence','mcp-starts.jsonl')
 await writeFile(mcpServer,"import {appendFileSync} from 'node:fs'; appendFileSync("+JSON.stringify(starts)+",JSON.stringify({cwd:process.cwd(),pid:process.pid,ppid:process.ppid,argv:process.argv.slice(2),source:process.env.ROVAI_MCP_SMOKE_SOURCE})+'\\n'); await import("+JSON.stringify(new URL('../crates/rovai-core/tests/fixtures/mcp-smoke-server.mjs',import.meta.url).href)+");")
 const literalArgs=['two words','中文 & 空格','$() `literal`','--flag=value','']
 const definition=source=>JSON.stringify({mcpServers:{goose_review:{command:process.execPath,args:[mcpServer,...literalArgs],cwd:join(root,'service'),env:{ROVAI_MCP_SMOKE_SOURCE:source}}}})
 let mcp=await core.request('mcp.config.get')
 let mutation=await core.request('mcp.servers.create',{expectedConfigDigest:mcp.configDigest,definitionJson:definition('GOOSE_MCP_A')});assert.equal(mutation.status,'ok',JSON.stringify(mutation));mcp=mutation.config
 const serverId=mcp.servers.find(s=>s.name==='goose_review').serverId
 mutation=await core.request('mcp.servers.setEnabled',{expectedConfigDigest:mcp.configDigest,serverId,enabled:true,acknowledgeHighRisk:true});assert.equal(mutation.status,'ok');mcp=mutation.config
 mutation=await core.request('mcp.assignments.set',{expectedConfigDigest:mcp.configDigest,serverId,agentId:'agent_2',assigned:true,acknowledgeHighRisk:true});assert.equal(mutation.status,'ok');mcp=mutation.config
 const mcpA=await settle(await send('CORE_GOOSE_MCP_A'))
 const startup=JSON.parse((await readFile(starts,'utf8')).trim().split('\n').at(-1));assert.equal(startup.cwd,join(root,'service'));assert.deepEqual(startup.argv,literalArgs)
 const beforeSave=await owner(mcpA)
 mutation=await core.request('mcp.servers.update',{expectedConfigDigest:mcp.configDigest,serverId,definitionJson:definition('GOOSE_MCP_B')});assert.equal(mutation.status,'ok');mcp=mutation.config
 process.kill(beforeSave.pid,0) // Saving cannot kill the idle managed Host.
 const mcpB=await settle(await send('CORE_GOOSE_MCP_B'));assert.equal(mcpA.started.nativeThreadId,mcpB.started.nativeThreadId)
 assert.throws(()=>process.kill(beforeSave.pid,0),e=>e.code==='ESRCH','An incompatible Binding Host must be reaped, not parked for later reuse')
 mutation=await core.request('mcp.assignments.set',{expectedConfigDigest:mcp.configDigest,serverId,agentId:'agent_2',assigned:false});assert.equal(mutation.status,'ok');mcp=mutation.config
 const removalOffset=calls.length
 const mcpEmpty=await settle(await send('CORE_GOOSE_MCP_EMPTY'))
 assert(calls.slice(removalOffset).filter(c=>c.tools?.length).every(c=>!c.tools.some(t=>(t.function?.name??t.name).includes('rovai_assigned_'))),'Removed MCP tools must not survive additive native load')
 assert.equal(mcpEmpty.started.nativeThreadId,mcpB.started.nativeThreadId)
 assert.notEqual(mcpEmpty.started.hostInstanceId,a.started.hostInstanceId,'Configuration reversal must not resurrect an obsolete Host')
 result.checks.mcp={differentCwd:true,argvVerbatim:true,saveKeepsHost:true,replacementSameSession:true,deletedToolAbsent:true}
 let metrics;await until(async()=>{metrics=await core.request('monitoring.execution',{campId:threadId,agentRunIds:[a.run.id,b.run.id,files.run.id]});await writeFile(join(root,'evidence','metrics.json'),JSON.stringify(metrics,null,2));return metrics.runs.every(r=>r.promptInputTotalTokens>0&&r.outputTokens>0)},'Numeric settlement deadline')
 result.checks.metrics=metrics
 assert(metrics.sessions.some(s=>s.usedTokens>=0),'Native context Gauge must be visible in shared monitoring')
 const numericDb=new DatabaseSync(join(data,'rovai.sqlite'),{readOnly:true})
 try{const costs=[a,b].map(done=>numericDb.prepare('SELECT cost_amount_decimal AS amount FROM runtime_usage_run_summary WHERE agent_run_id=?').get(done.run.id).amount);assert.equal(Number(costs[0]),Number(costs[1]),'Identical first/warm calls must both include the first native cost');result.checks.cost={firstWarmEqual:true,quality:'runtime_estimate',currency:'USD'}}finally{numericDb.close()}
 assert(metrics.runs.every(r=>r.promptInputTotalTokens>0&&r.outputTokens>0),'Every Run needs fresh numeric deltas')
 // Exercise the real Core and Session reload using only this fixture's roots.
 await core.close();core=await openCore()
 const cold=await settle(await send('CORE_GOOSE_COLD'))
 assert.notEqual(cold.started.hostInstanceId,b.started.hostInstanceId)
 assert.equal(cold.started.nativeThreadId,b.started.nativeThreadId,'Cold restore must load the exact native Session')
 result.checks.cold={sameSession:true,newHost:true}
 result.checks.files={writeAndEdit:true,fullDiff:'unsupported-native-metadata'}
 await writeFile(join(root,'evidence','core-events.json'),JSON.stringify(events,null,2))
 await writeFile(join(root,'evidence','checks.json'),JSON.stringify(result,null,2))
 console.log(JSON.stringify({passed:true,root,checks:result.checks}))
}catch(error){
 await writeFile(join(root,'evidence','core-events.json'),JSON.stringify(events,null,2))
 await writeFile(join(root,'evidence','failure.json'),JSON.stringify({message:error.message,stack:error.stack},null,2))
 await writeFile(join(root,'evidence','partial-checks.json'),JSON.stringify(result,null,2))
 throw error
}finally{
 gate?.release();await core?.close();provider.closeAllConnections();await new Promise(r=>provider.close(r))
 await writeFile(join(root,'evidence','provider-requests.json'),JSON.stringify(calls,null,2))
 await removeEphemeralRuntimeCampFilesRoot(data,{homeDirectory:join(root,'home')})
}
