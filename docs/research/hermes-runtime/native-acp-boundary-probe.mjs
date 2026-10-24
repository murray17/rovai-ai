// Diagnostic only: unmodified official ACP, loopback Responses, isolated native storage.
// Does not create Core Runs or qualify built-in collaboration. Expected CLI result: failure.
// Usage: node <this-file> /path/to/hermes /path/to/prepared-hermes-home /path/to/rovai
// The prepared Home is used only for its installs/ dependency cache, never config or credentials.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
const [executable, dependencyHome, cli] = process.argv.slice(2)
assert([executable, dependencyHome, cli].every(p => p && isAbsolute(p)), 'Provide three absolute paths; see usage')
const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-native-acp-boundary-')))
const nativeHome = join(root, '.hermes'), project = join(root, 'project')
await mkdir(nativeHome, {mode:0o700}); await mkdir(project)
await symlink(join(dependencyHome, 'installs'), join(nativeHome,'installs'))
const sh = s => "'" + s.replaceAll("'", "'\\''") + "'"
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('ROVAI_')&&!k.startsWith('HERMES_')))
Object.assign(env,{HERMES_HOME:nativeHome,HERMES_DISABLE_LAZY_INSTALLS:'1',HERMES_NATIVE_PROBE_KEY:'loopback-only',PATH:'/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'})
const plans=new Map(), calls=new Map(), wire=[], clients=[], processes=[]
let fault
const message=text=>({id:crypto.randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]})
const server=createServer(async(req,res)=>{
 try {
  if(req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({object:'list',data:[{id:'native-probe',object:'model'}]}));return}
  const parts=[];for await(const p of req)parts.push(p)
  const body=JSON.parse(Buffer.concat(parts).toString());wire.push(body)
  if(!Array.isArray(body.input)){res.writeHead(200,{'content-type':'application/json'});res.end('{}');return}
  const name=[...JSON.stringify(body.input).matchAll(/NATIVE_PROBE:([a-z0-9_-]+)/g)].at(-1)?.[1]
  const nth=(calls.get(name)??0)+1;calls.set(name,nth)
  const command=plans.get(name)
  let item=message('Probe completed.')
  if(command&&nth===1)item={id:crypto.randomUUID(),type:'function_call',call_id:crypto.randomUUID(),name:'terminal',arguments:JSON.stringify({command}),status:'completed'}
  const id='response-'+crypto.randomUUID(), output={id,object:'response',status:'completed',output:[item],usage:{input_tokens:50,output_tokens:10,total_tokens:60}}
  if(!body.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(output));return}
  res.writeHead(200,{'content-type':'text/event-stream'});let sequence=0
  const emit=e=>res.write('data: '+JSON.stringify({...e,sequence_number:sequence++})+'\n\n')
  emit({type:'response.created',response:{id,status:'in_progress',output:[]}})
  emit({type:'response.output_item.added',output_index:0,item})
  if(item.type==='message')emit({type:'response.output_text.delta',output_index:0,content_index:0,item_id:item.id,delta:item.content[0].text})
  emit({type:'response.output_item.done',output_index:0,item});emit({type:'response.completed',response:output});res.end()
 }catch(e){fault=e;res.writeHead(500);res.end()}
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const config={model:{provider:'fixture',default:'native-probe'},providers:{fixture:{base_url:`http://127.0.0.1:${server.address().port}/v1`,api_key_env:'HERMES_NATIVE_PROBE_KEY',transport:'codex_responses',models:['native-probe']}},updates:{check:false},platform_toolsets:{acp:['terminal','skills','memory','no_mcp']},agent:{max_turns:5},session_title:{enabled:false},compression:{enabled:false}}
await writeFile(join(nativeHome,'config.yaml'),JSON.stringify(config),{mode:0o600})
await writeFile(join(nativeHome,'.env'),'NATIVE_PROBE_SETTING=unchanged\n',{mode:0o600})
const configBefore=await readFile(join(nativeHome,'config.yaml'))
const hash=b=>createHash('sha256').update(b).digest('hex')
const exists=async path=>{try{await readFile(path);return true}catch{return false}}
async function until(fn,ms=60000){const deadline=Date.now()+ms;while(Date.now()<deadline){if(fault)throw fault;const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,100))}throw Error('Timed out waiting for fixture')}
function alive(pid){try{process.kill(pid,0);return true}catch{return false}}
async function acp(label){
 const child=spawn(executable,['--profile','default','acp'],{cwd:project,env:{...env,PATH:join(cli,'..')+':'+env.PATH,ROVAI_CLI_CONTEXT:join(root,label+'-context.json'),ROVAI_AGENT_CLI:cli,ROVAI_PROBE_RUN:label},detached:true,stdio:['pipe','pipe','pipe']})
 processes.push(child);let id=0,stderr='';const pending=new Map(),events=[]
 child.stderr.on('data',d=>stderr+=d)
 const closed=new Promise(r=>child.once('close',(code,signal)=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('ACP closed'))}pending.clear();r({code,signal})}))
 createInterface({input:child.stdout}).on('line',line=>{
  let m;try{m=JSON.parse(line)}catch{return}events.push(m)
  if(m.method&&m.id!==undefined){child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:m.id,...(m.method==='session/request_permission'?{result:{outcome:{outcome:'selected',optionId:m.params.options.find(o=>o.kind==='allow_once')?.optionId}}}:{error:{code:-32601,message:'Unsupported fixture request'}})})+'\n');return}
  const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)
 })
 const client={child,events,get stderr(){return stderr},request(method,params={}){return new Promise((resolve,reject)=>{const next=++id,timer=setTimeout(()=>{pending.delete(next);reject(Error('ACP timeout '+method))},120000);pending.set(next,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n')})},notify(method,params){child.stdin.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n')},async close(){child.stdin.end();const timer=setTimeout(()=>child.kill('SIGTERM'),3000);const result=await closed;clearTimeout(timer);return result}}
 clients.push(client);await client.request('initialize',{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'rovai-native-boundary-probe',version:'1'}});return client
}
const report={fixture:root,official:execFileSync(executable, ['--version'], {env, encoding:'utf8'}).trim(),sessions:{},checks:{},limitations:[]}
let gateway, autoGatewayPid
try {
 gateway=spawn(executable,['--profile','default','gateway','run','--quiet'],{cwd:project,env,detached:true,stdio:['ignore','pipe','pipe']});processes.push(gateway)
 let gatewayErrors='';gateway.stderr.on('data',d=>gatewayErrors+=d);gateway.stdout.resume()
 await until(async()=>{try{const l=JSON.parse(await readFile(join(nativeHome,'gateway.lock'),'utf8'));return l.pid===gateway.pid}catch{return false}})
 await new Promise(r=>setTimeout(r,1000))
 report.gatewayPid=gateway.pid
 const a=await acp('member-a-run-1'),b=await acp('member-b-run-1')
 const sa=(await a.request('session/new',{cwd:project,mcpServers:[]})).sessionId,sb=(await b.request('session/new',{cwd:project,mcpServers:[]})).sessionId
 assert.notEqual(sa,sb);report.sessions={a:sa,b:sb}
 for(const [client,sid] of [[a,sa],[b,sb]])await client.request('session/set_mode',{sessionId:sid,modeId:'dont_ask'})
 const prompt=(client,sid,name)=>client.request('session/prompt',{sessionId:sid,prompt:[{type:'text',text:'NATIVE_PROBE:'+name}]})
 function identity(name){const file=join(root,name+'.json');plans.set(name,`python3 -c ${sh('import os,json,subprocess; assert not os.environ.get("ROVAI_CLI_CONTEXT"), "Unexpected live CLI context in isolated Gateway"; d={k:os.environ.get(k) for k in ["ROVAI_CLI_CONTEXT","ROVAI_AGENT_CLI","ROVAI_PROBE_RUN"]}; d["version"]=subprocess.run("rovai --version",shell=True,capture_output=True,text=True).__dict__.get("stdout"); p=subprocess.run(['+JSON.stringify(cli)+',"send","--public-only","--body","NATIVE_ISOLATED_PROBE"],capture_output=True,text=True); d["send_exit"]=p.returncode; d["send_stdout"]=p.stdout; d["send_stderr"]=p.stderr; open('+JSON.stringify(file)+',"w").write(json.dumps(d))')}`);return file}
 const ia=identity('identity-a'),ib=identity('identity-b')
 await Promise.all([prompt(a,sa,'identity-a'),prompt(b,sb,'identity-b')])
 report.identity=[JSON.parse(await readFile(ia)),JSON.parse(await readFile(ib))]
 assert(report.identity.every(x=>x.ROVAI_CLI_CONTEXT===null&&x.ROVAI_AGENT_CLI===null&&x.ROVAI_PROBE_RUN===null&&x.send_exit!==0))
 report.checks.acpEnvironmentNotForwarded=true;report.limitations.push('No successful built-in Send; these are ACP session labels, not validated Core member/Run/lease attribution.')
 await a.close();assert(alive(gateway.pid))
 const a2=await acp('member-a-run-2');await a2.request('session/load',{sessionId:sa,cwd:project,mcpServers:[]})
 const ia2=identity('identity-a2');await prompt(a2,sa,'identity-a2');report.identity.push(JSON.parse(await readFile(ia2)))
 assert(report.identity[2].ROVAI_CLI_CONTEXT===null);report.checks.originalSessionResumed=true
 plans.set('cancel-a',`printf started > ${sh(join(root,'cancel-started'))}; sleep 20; printf late > ${sh(join(root,'cancel-late'))}`)
 const pa=prompt(a2,sa,'cancel-a');pa.catch(()=>{})
 await until(()=>exists(join(root,'cancel-started')))
 plans.set('peer-b',`printf sibling > ${sh(join(root,'peer-b'))}`)
 const pb=prompt(b,sb,'peer-b');a2.notify('session/cancel',{sessionId:sa})
 report.cancel=await pa;report.peer=await pb
 assert.equal(report.cancel.stopReason,'cancelled');assert.equal(report.peer.stopReason,'end_turn');assert(alive(gateway.pid));assert.equal(await readFile(join(root,'peer-b'),'utf8'),'sibling')
 report.checks.cancelKeptSiblingAndGateway=true
 plans.set('disconnect-a',`printf started > ${sh(join(root,'disconnect-started'))}; sleep 2; printf completed > ${sh(join(root,'disconnect-completed'))}`)
 const disconnected=prompt(a2,sa,'disconnect-a');disconnected.catch(()=>{})
 await until(()=>exists(join(root,'disconnect-started')));await a2.close()
 await until(()=>exists(join(root,'disconnect-completed')),10000)
 report.checks.executionContinuedAfterAcpDisconnect=true;assert(alive(gateway.pid))
 await b.close();assert(alive(gateway.pid));report.checks.acpExitKeptGateway=true
 const crash=await acp('member-a-run-3');await crash.request('session/load',{sessionId:sa,cwd:project,mcpServers:[]})
 plans.set('crash-a',`printf started > ${sh(join(root,'crash-started'))}; sleep 2; printf completed > ${sh(join(root,'crash-completed'))}`)
 const crashed=prompt(crash,sa,'crash-a');crashed.catch(()=>{})
 await until(()=>exists(join(root,'crash-started')));crash.child.kill('SIGKILL');await until(()=>exists(join(root,'crash-completed')),10000)
 report.checks.executionContinuedAfterAcpKill=true;assert(alive(gateway.pid))
 const oldPid=gateway.pid
 gateway.kill('SIGTERM');await until(()=>!alive(oldPid),15000)
 const auto=await acp('native-auto-start')
 await auto.request('session/new',{cwd:project,mcpServers:[]})
 const autoLock=JSON.parse(await readFile(join(nativeHome,'gateway.lock'),'utf8'));const autoPid=autoLock.pid
 assert.equal(await realpath(autoLock.hermes_home), nativeHome);autoGatewayPid=autoPid
 assert.notEqual(autoPid,oldPid);assert(alive(autoPid))
 const ps=await new Promise((resolve,reject)=>{const child=spawn('/bin/ps',['-p',String(autoPid),'-o','ppid=','-o','pgid=']);let text='';child.stdout.on('data',d=>text+=d);child.on('error',reject);child.on('close',()=>resolve(text.trim()))})
 report.autoGateway={pid:autoPid,acpPid:auto.child.pid,ppid:Number(ps.split(/\s+/)[0]),pgid:Number(ps.split(/\s+/)[1])}
 await auto.close();assert(alive(autoPid));report.checks.nativeAutoStartedGatewaySurvivedAcpExit=true
 process.kill(autoPid,'SIGTERM');await until(()=>!alive(autoPid),15000)
 report.checks.configUnchanged=hash(configBefore)===hash(await readFile(join(nativeHome,'config.yaml')))
 report.checks.dotenvUnchanged=(await readFile(join(nativeHome,'.env'),'utf8'))==='NATIVE_PROBE_SETTING=unchanged\n'
 assert(report.checks.configUnchanged&&report.checks.dotenvUnchanged)
 console.log(JSON.stringify(report,null,2))
 await writeFile(join(root,'report.json'),JSON.stringify(report,null,2))
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error),report,clients:clients.map(c=>({stderr:c.stderr,events:c.events.slice(-8)}))},null,2));throw error}
finally{for(const c of clients)if(c.child.exitCode===null&&c.child.signalCode===null)await c.close().catch(()=>{});if(gateway&&alive(gateway.pid))gateway.kill('SIGTERM');if(autoGatewayPid&&alive(autoGatewayPid))process.kill(autoGatewayPid,'SIGTERM');server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(join(root,'wire.json'),JSON.stringify(wire));console.log('Isolated evidence:',root)}
