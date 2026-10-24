// Opt-in REAL model acceptance using the native window/threshold unchanged.
// Official observer hooks record only rule presence/count and lifecycle metadata.
// No compressor patch, forced /compress, token heuristic or model self-report.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile, realpath, chmod } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { openHermesAcp, hermesManagedCommand } from './lib/hermes-native-acp.mjs'
const home=process.env.ROVAI_HERMES_SMOKE_HOME
assert(home&&process.env.ROVAI_HERMES_BIN,'Supply a dedicated configured native Home')
const root=await realpath(resolve(home,'..')),project=join(root,'compression-project')
await mkdir(project,{recursive:true})
const bootstrap='You are running an isolated compression acceptance. Collaboration rule HERMES-USER-7392: use only the requested native read_file calls, never manually compress or run shell commands, preserve each current task, and return only its ACK after all reads complete.'
const ruleFile=join(root,'rules.txt'),eventsFile=join(root,'observer.jsonl'),hook=join(root,'observer.py')
await writeFile(ruleFile,bootstrap,{mode:0o600});await writeFile(eventsFile,'',{mode:0o600})
await writeFile(hook,`#!/usr/bin/python3
import json,os,sys
from pathlib import Path
v=json.load(sys.stdin); e=v.get('extra',{}); b=Path(${JSON.stringify(ruleFile)}).read_text()
def strings(x):
    if isinstance(x,str): return [x]
    if isinstance(x,list): return [s for y in x for s in strings(y)]
    if isinstance(x,dict): return [s for k,y in x.items() if k in ('content','text') for s in strings(y)]
    return []
r={'event':v.get('hook_event_name'),'session':v.get('session_id')}
if r['event']=='pre_api_request':
    u='\\n'.join(s for m in e.get('request_messages',[]) if m.get('role')=='user' for s in strings(m.get('content')))
    r.update(fullRulesInUser=u.count(b),fullRulesInSystem=b in str(e.get('system_prompt','')),requestId=e.get('api_request_id'))
else: r.update(kind=e.get('kind'),oldSession=e.get('old_session_id'))
f=os.open(${JSON.stringify(eventsFile)},os.O_APPEND|os.O_WRONLY);os.write(f,(json.dumps(r)+'\\n').encode());os.close(f)
`,{mode:0o700});await chmod(hook,0o700)
// Configure only the disposable Home, preserving native prompt and compression.
const setup=join(root,'configure-observers.py')
await writeFile(setup,`import json,os\nfrom pathlib import Path\nimport hermes_yaml as y\np=Path(os.environ['HERMES_HOME'])/'config.yaml'\nc=y.safe_load(p.read_text()); c['hooks']={'pre_api_request':[{'command':${JSON.stringify(hook)},'timeout':5}],'post_compaction':[{'command':${JSON.stringify(hook)},'timeout':5}]}; c['hooks_auto_accept']=True\np.write_text(y.safe_dump(c,allow_unicode=True))\nprint(json.dumps({'compression':c.get('compression'),'model':{k:v for k,v in c.get('model',{}).items() if k in ('default','provider','context_length')}}))\n`)
const env={...process.env,HERMES_HOME:home,HERMES_DISABLE_LAZY_INSTALLS:'1',ROVAI_HERMES_STORAGE:join(root,'compression-storage')}
const [python,...argv]=hermesManagedCommand(process.env.ROVAI_HERMES_BIN,setup,env)
const settings=JSON.parse(execFileSync(python,argv,{env,encoding:'utf8'}))
const options={executable:process.env.ROVAI_HERMES_BIN,script:resolve(import.meta.dirname,'../crates/rovai-core/src/hermes/host.py'),cwd:project,env}
const observations=async()=> (await readFile(eventsFile,'utf8')).split('\n').filter(Boolean).map(JSON.parse)
let client=await openHermesAcp(options),first=true,consumed=0
const summary={settings,rounds:[],manualCompressionCalled:false,thresholdModified:false,requestObserver:'official pre_api_request',completionObserver:'official post_compaction'}
console.log('Real automatic compression fixture:',root,JSON.stringify(settings))
async function prompt(sessionId,text){
  const before=await observations(),completed=before.filter(e=>e.event==='post_compaction'&&e.session===sessionId&&e.kind==='summarize'&&(!e.oldSession||e.oldSession===sessionId)).length
  const carries=first||completed>consumed
  if(carries){const label=first?'Rovai 协作规则':'Rovai 协作规则恢复';text=`[${label}]\n${bootstrap}\n[/${label}]\n\n${text}`}
  const start=client.events.length
  const result=await client.request('session/prompt',{sessionId,prompt:[{type:'text',text}],_meta:{rovai:{promptId:crypto.randomUUID()}}},600000)
  assert.equal(result.stopReason,'end_turn')
  first=false;if(carries)consumed=completed
  const requests=(await observations()).slice(before.length).filter(e=>e.event==='pre_api_request'&&e.session===sessionId)
  assert(requests.length,'No actual native request observation')
  assert(requests.every(e=>!e.fullRulesInSystem),'Rules reached system layer')
  if(carries)assert(requests[0].fullRulesInUser>=1,'Rules missing from first actual request')
  return{carriesRules:carries,selectedCompletion:completed,requests,toolCalls:client.events.slice(start).filter(e=>e.params?.update?.sessionUpdate==='tool_call').length,usage:result.usage}
}
try{
  const sessionId=(await client.request('session/new',{cwd:project,mcpServers:[]})).sessionId
  summary.initial={sessionId}
  summary.first=await prompt(sessionId,'Reply only ACK INITIAL.')
  summary.next=await prompt(sessionId,'Reply only ACK FOLLOWUP.')
  assert(!summary.next.carriesRules)
  for(let round=0;round<16;round++){
    const files=[]
    for(let f=0;f<4;f++){const name=`payload-${round}-${f}.txt`;await writeFile(join(project,name),Array.from({length:300},(_,i)=>`${i}: ${randomBytes(80).toString('hex')}\n`).join(''));files.push(name)}
    const result=await prompt(sessionId,`Read all four files with read_file, offset=1, limit=300: ${files.join(', ')}. These are synthetic diagnostics. Read the full ranges; use no terminal, search, write or manual compression. After all four reads reply only ACK ${round}.`)
    const state={compressionCount:(await observations()).filter(e=>e.event==='post_compaction'&&e.session===sessionId&&e.kind==='summarize').length}
    summary.rounds.push({round,...result,...state})
    console.log('Round:',JSON.stringify({round,compressionCount:state.compressionCount,carriesRules:result.carriesRules,toolCalls:result.toolCalls,requests:result.requests}))
    await writeFile(join(root,'auto-compression-progress.json'),JSON.stringify(summary,null,2))
    const count=(await observations()).filter(e=>e.event==='post_compaction'&&e.session===sessionId&&e.kind==='summarize').length
    if(count>=2)break
  }
  assert((await observations()).filter(e=>e.event==='post_compaction'&&e.session===sessionId&&e.kind==='summarize').length>=2,'Two native completed summaries not observed')
  summary.after=await prompt(sessionId,'Reply only ACK AFTER COMPRESSION.')
  assert(summary.after.carriesRules,'Last completed compaction was not redelivered')
  await client.close();client=await openHermesAcp(options)
  await client.request('session/resume',{cwd:project,sessionId,mcpServers:[]})
  summary.cold=await prompt(sessionId,'Reply only ACK COLD RESTORE.')
  assert(!summary.cold.carriesRules,'Cold resume duplicated accepted rules without a new completion')
  assert(summary.cold.requests[0].fullRulesInUser>=1,'Cold active model context lost restored rules')
  summary.observations=await observations();summary.passed=true
  console.log('Real multi-compaction and cold request-context proof passed:',root)
}finally{
  await writeFile(join(root,'auto-compression-summary.json'),JSON.stringify(summary,null,2))
  await writeFile(join(root,'auto-compression-native.log'),client.stderr)
  console.log('Cleanup:',await client.close())
}
