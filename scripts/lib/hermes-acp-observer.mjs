// Acceptance-only, transparent stdio observation. Never used by the Runtime adapter.
// Keep numeric/protocol metadata, not prompts, tool arguments, credentials or output text.
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'

export async function createHermesAcpObserver(root) {
  const script = join(root, 'acp-observer.mjs'), log = join(root, 'acp.jsonl')
  await writeFile(script, `import {spawn} from 'node:child_process';
import {appendFileSync} from 'node:fs';
const child=spawn(process.argv[2],process.argv.slice(3),{stdio:['pipe','pipe','inherit']});
const buffers={out:'',in:''}, requests=new Map(), permissions=new Map();
const numeric=(value)=>Object.fromEntries(Object.entries(value||{}).filter(([key,v])=>
  ['inputTokens','outputTokens','totalTokens','thoughtTokens','cachedReadTokens','cachedWriteTokens'].includes(key)&&Number.isSafeInteger(v)&&v>=0));
function observe(direction,bytes){
  buffers[direction]+=bytes;let end;
  while((end=buffers[direction].indexOf('\\n'))>=0){
    const line=buffers[direction].slice(0,end);buffers[direction]=buffers[direction].slice(end+1);
    try{
      const m=JSON.parse(line),p=m.params||{},r=m.result||{},u=p.update||{};
      if(direction==='in'&&m.method)requests.set(m.id,{method:m.method,sessionId:p.sessionId,
        label:JSON.stringify(p.prompt||[]).match(/(?:SESSION|REAL)_PROBE:([ABQ][0-9]+)/)?.[1]});
      if(direction==='out'&&m.method==='session/request_permission')permissions.set(m.id,{sessionId:p.sessionId});
      const permission=direction==='in'&&!m.method?permissions.get(m.id):undefined;
      const request=requests.get(m.id),method=m.method||(permission?'session/request_permission':request?.method);
      if(!['initialize','session/new','session/resume','session/load','session/set_model','session/set_mode','session/set_config_option','session/prompt','session/update','session/request_permission'].includes(method))continue;
      const meta=r._meta||u._meta||{},native=meta.hermes||{},provenance=native.sessionProvenance;
      const record={pid:process.pid,direction,id:m.id,method,label:request?.label,
        sessionId:p.sessionId||r.sessionId||permission?.sessionId||request?.sessionId,modelId:p.modelId,modeId:p.modeId,
        configId:method==='session/set_config_option'?p.configId:undefined,
        configValue:method==='session/set_config_option'&&p.configId==='reasoning_effort'?p.value:undefined,
        reasoningOptions:r.configOptions?.filter(o=>o.id==='reasoning_effort').map(o=>({currentValue:o.currentValue,category:o.category,values:o.options?.map(v=>v.value)})),
        permissionToolId:method==='session/request_permission'?p.toolCall?.toolCallId:undefined,
        permissionOptions:p.options?.map(o=>({optionId:o.optionId,kind:o.kind})),
        permissionOutcome:r.outcome?{outcome:r.outcome.outcome,optionId:r.outcome.optionId}:undefined,
        currentModelId:r.models?.currentModelId,currentModeId:r.modes?.currentModeId,
        catalog:r.models?.availableModels?.map(v=>v.modelId),errorCode:m.error?.code,
        compactionOptIn:method==='initialize'&&direction==='in'?p.clientCapabilities?.session?.compaction:undefined,
        resultKeys:Object.keys(r),sessionUpdate:u.sessionUpdate,updateKeys:Object.keys(u),metaKeys:Object.keys(meta),
        hermesMetaKeys:Object.keys(native),usage:r.usage?numeric(r.usage):undefined,
        used:typeof u.used==='number'?u.used:undefined,size:typeof u.size==='number'?u.size:undefined,
        compactionSummary:native.compactionSummary===true||native.containsCompactionSummary===true,
        provenance:provenance?Object.fromEntries(Object.entries(provenance).filter(([key])=>
          ['acpSessionId','currentHermesSessionId','rootHermesSessionId','parentHermesSessionId',
           'previousHermesSessionId','sessionKind','compressionDepth','reason','creatorKind'].includes(key))):undefined};
      appendFileSync(${JSON.stringify(log)},JSON.stringify(record)+'\\n');
    }catch{}
  }
}
process.stdin.on('data',b=>observe('in',b));child.stdout.on('data',b=>observe('out',b));
process.stdin.pipe(child.stdin);child.stdout.pipe(process.stdout);child.stdin.on('error',()=>{});
child.on('exit',(code)=>process.exit(code??1));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
`)
  return {script, log}
}

// A second native viewer exercises the shared-Gateway case. It grants no
// approval; only the fixture may explicitly submit a native maintenance command.
export async function holdHermesSession(launcher, env, project, sessionId) {
  const child = spawn(launcher, ['--profile', 'default', 'acp'], {cwd: project, env, stdio: ['pipe', 'pipe', 'ignore']})
  let serial = 0
  const pending = new Map(), exited = new Promise(done => child.once('exit', done))
  createInterface({input: child.stdout}).on('line', line => {
    let message
    try {message = JSON.parse(line)} catch {return}
    if (!('result' in message || 'error' in message)) return
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id); clearTimeout(waiter.timer)
    if (message.error) waiter.reject(new Error(`ACP viewer error ${message.error.code}`))
    else waiter.resolve(message.result)
  })
  child.once('exit', () => {
    for (const waiter of pending.values()) {clearTimeout(waiter.timer); waiter.reject(new Error('ACP viewer exited'))}
    pending.clear()
  })
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => {pending.delete(id); reject(new Error(`ACP viewer timeout: ${method}`))}, 90000)
    pending.set(id, {resolve, reject, timer})
    child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n')
  })
  const pause = ms => new Promise(done => setTimeout(done, ms))
  const close = async () => {
    child.stdin.end()
    await Promise.race([exited, pause(1500)])
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await Promise.race([exited, pause(5000)])
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  }
  try {
    await request('initialize', {protocolVersion: 1, clientCapabilities: {session: {compaction: {}}}})
    await request('session/load', {sessionId, cwd: project, mcpServers: []})
    return {close, request}
  } catch (error) {await close(); throw error}
}
