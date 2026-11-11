// Real Runtime acceptance; all Core, Skills, MCP, cache and workspace writes are isolated.
// node scripts/smoke-steer.mjs <new-empty-absolute-root> <absolute-core-executable> [target-adapter] [full|cancel-only|steer-only|mixed-only] [absolute-native-executable]
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { access, chmod, cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { composerDocumentForAddress } from './lib/create-configured-camp.mjs'
const [fixture, executable, targetAdapter = 'codex-cli', scenario = 'full', nativeExecutable] = process.argv.slice(2)
assert.ok(['full','cancel-only','steer-only','mixed-only'].includes(scenario))
assert.ok(['codex-cli','claude-code-cli','pi','codebuddy-cli','qwen-code','grok-build','kiro-cli','zcode-app','trae-cn-cli','minimax-code-cli','opencode-cli'].includes(targetAdapter))
assert.ok(isAbsolute(fixture) && isAbsolute(executable))
assert.ok(!nativeExecutable || isAbsolute(nativeExecutable))
await access(join(dirname(executable), process.platform === 'win32' ? 'rovai.exe' : 'rovai'))
assert.deepEqual(await readdir(fixture), [])
const data = join(fixture, 'core'), project = join(fixture, 'project')
await mkdir(data); await mkdir(project)
const report = { startedAt: new Date().toISOString(), coreExecutable: executable, coreSha256: createHash('sha256').update(await readFile(executable)).digest('hex'), fixture, targetAdapter, scenario, cases: [], runtimes: [], runtimeChecks: [] }
if(nativeExecutable) {
  report.nativeExecutable=nativeExecutable
  report.nativeSha256=createHash('sha256').update(await readFile(nativeExecutable)).digest('hex')
}
console.error(`Automatic acceptance: data=${data}; skills=${join(data,'managed-skill-library')}; MCP=${join(data,'mcp.json')}; project=${project}`)
// Native credentials are copied only into this private acceptance directory.
// The report contains no credential values or native configuration contents.
const nativeSpec = {
  'minimax-code-cli':['MINIMAX_DATA_DIR','.minimax',['config.yaml','auth']],
  'codex-cli':['CODEX_HOME','.codex',['auth.json','config.toml']],
  'trae-cn-cli':['TRAE_HOME','.trae',['traecli.toml','cli/auth.json']],
  'claude-code-cli':['CLAUDE_CONFIG_DIR','.claude',['settings.json','settings.local.json','config.json','.credentials.json']],
  pi:['PI_CODING_AGENT_DIR','.pi/agent',['auth.json','models.json','models-store.json','settings.json']],
  'codebuddy-cli':['CODEBUDDY_CONFIG_DIR','.codebuddy',['settings.json','user-state.json']],
  'qwen-code':['QWEN_HOME','.qwen',['settings.json','oauth_creds.json','installation_id']],
  'grok-build':['GROK_HOME','.grok',['config.toml','managed_config.toml','requirements.toml','.env','agent_id']],
  'kiro-cli':['KIRO_HOME','.kiro',['settings','agents']],
  'zcode-app':['ZCODE_DATA_BASE_DIR','',['.zcode/v2/provider_config.json']],
}[targetAdapter]
if(nativeSpec) {
  const [key, directory, files] = nativeSpec
  const source=process.env[key]??join(homedir(),directory), native=join(fixture,'native')
  await mkdir(native,{mode:0o700}); await chmod(fixture,0o700)
  for(const name of files) { try { await access(join(source,name)) } catch { continue }
    await cp(join(source,name),join(native,name),{recursive:true,dereference:true}); }
  if(targetAdapter==='claude-code-cli') {
    const settings=JSON.parse(await readFile(join(native,'settings.json'),'utf8'))
    const baseURL=settings.env?.ANTHROPIC_BASE_URL
    assert.ok(baseURL,'Claude smoke requires the explicitly selected native API configuration')
    report.connection={source:'Claude native settings (sub2api)',baseURL,model:settings.env?.ANTHROPIC_MODEL??settings.model}
    delete settings.hooks; delete settings.enabledPlugins
    await writeFile(join(native,'settings.json'),JSON.stringify(settings),{mode:0o600})
    delete process.env.CLAUDECODE
  }
  process.env[key]=native
  if(targetAdapter==='qwen-code')process.env.QWEN_RUNTIME_DIR=native
  if(targetAdapter==='zcode-app') {
    process.env.ZCODE_STORAGE_DIR=join(native,'storage')
    process.env.ZCODE_SESSION_DB_PATH=join(native,'sessions.sqlite')
  }
}
// The busy peer (and optional target) is a real OpenCode Runtime. Copy only its
// authentication/configuration/selection, never daily Sessions or databases.
for(const [key,directory,files] of [
  ['XDG_CONFIG_HOME','.config',['opencode/opencode.json','opencode/opencode.jsonc','opencode/config.json']],
  ['XDG_DATA_HOME','.local/share',['opencode/auth.json']],
  ['XDG_STATE_HOME','.local/state',['opencode/model.json']],
  ['XDG_CACHE_HOME','.cache',[]],
]) {
  const source=process.env[key]??join(homedir(),directory)
  const destination=join(fixture,'opencode',key.toLowerCase())
  await mkdir(destination,{recursive:true,mode:0o700})
  for(const name of files) {
    try { await access(join(source,name)) } catch { continue }
    await cp(join(source,name),join(destination,name),{recursive:true,dereference:true})
  }
  process.env[key]=destination
}
delete process.env.OPENCODE_DB
let core, db, threadId, failedExecution = () => null
async function wait(check, label, timeout=600_000) {
  const deadline = Date.now()+timeout
  while(Date.now()<deadline) { const value=await check();if(value){console.error('Passed boundary:',label);return value;}const failure=failedExecution();if(failure)throw new Error(`Execution failed while waiting for ${label}: ${JSON.stringify(failure)}`);await new Promise(r=>setTimeout(r,200)) }
  throw new Error(`Timed out: ${label}`)
}
const exists = async name => { try { await access(join(project,name));return true } catch { return false } }
try {
  core = startQualificationCore({coreExecutable:executable,dataDirectory:data,workingDirectory:project,runtimeCacheDirectory:join(fixture,'cache'),mcpConfigPath:join(data,'mcp.json')})
  await core.request('health.check')
  if(nativeExecutable) {
    const startup=await core.request('runtime.startup.get',{runtimeKind:targetAdapter})
    await core.request('runtime.startup.save',{runtimeKind:targetAdapter,expectedRevision:startup.revision,configuration:{programPath:nativeExecutable,environment:[]}})
  }
  await core.request('runtime.discovery.rescan',{interactiveShell:false})
  for(const adapter of [targetAdapter,'opencode-cli']) report.runtimeChecks.push({adapter,result:await core.request('runtime.product.check',{runtimeKind:adapter},120_000)})
  const installations = await core.request('runtime.installations.list')
  for(const [agentId,adapter] of [['agent_1',targetAdapter],['agent_2','opencode-cli'],['agent_3',targetAdapter]]) {
    const installation=installations.find(i=>i.adapterKind===adapter&&i.installationClass==='managed_default'&&i.authScope==='default'&&i.memberRuntimeDefaults)
    assert.ok(installation,`${adapter} requires saved defaults`)
    if(adapter===targetAdapter&&nativeExecutable)assert.equal(await realpath(installation.executablePath),await realpath(nativeExecutable),'historical binary selection must never fall back to the installed version')
    const current=await core.request('members.get',{agentId})
    const result=await core.request('members.runtime.set',{commandId:randomUUID(),command:{agentId,expectedVersion:current.version,adapterKind:adapter,model:installation.memberRuntimeDefaults.model,permissions:installation.memberRuntimeDefaults.permissions}})
    assert.equal(result.status,'applied')
    report.runtimes.push({agentId,adapter,version:installation.snapshot?.reportedVersion ?? null,model:installation.memberRuntimeDefaults.model})
  }
  const created=await core.request('threads.create',{commandId:randomUUID(),name:'Steer isolated acceptance',workspace:{projectPath:project},memberAgentIds:['agent_1','agent_2','agent_3'],defaultLeadAgentId:'agent_1',collaborationMode:'peer'})
  assert.equal(created.status,'applied');threadId=created.payload.threadId
  db=new DatabaseSync(join(data,'rovai.sqlite'),{readOnly:true})
  failedExecution=()=>db.prepare("SELECT id,status,last_error_code,public_runtime_failure_json FROM agent_run WHERE camp_id=? AND status IN ('failed','cancelled') LIMIT 1").get(threadId)
  const runs=()=>db.prepare('SELECT r.id,c.agent_id,r.status,r.execution_epoch,r.last_error_code FROM agent_run r JOIN conversation c ON c.id=r.conversation_id WHERE r.camp_id=? ORDER BY r.created_at,r.id').all(threadId)
  const deliveries=messageId=>db.prepare('SELECT id,recipient_agent_id,status,requested_mode,claimed_agent_run_id,failure_code FROM camp_message_delivery WHERE message_id=? ORDER BY recipient_agent_id').all(messageId)
  const inputs=run=>db.prepare('SELECT i.id,i.status,i.dispatch_started_at,i.native_input_id,i.input_kind,i.input_sequence,m.id AS manifest_id,m.source_delivery_id,m.raw_message_refs_json,m.attachment_refs_json,m.run_fact_payload_json FROM runtime_input_delivery i JOIN context_manifest m ON m.id=i.context_manifest_id WHERE i.agent_run_id=? ORDER BY input_sequence').all(run)
  const send=async (ids,body,mode='start',sourceAttachments=[])=>{
    const result=await core.request('thread.messages.send',{commandId:randomUUID(),threadId,content:composerDocumentForAddress({mode:'explicit',agentIds:ids},body),sourceAttachments,quotes:[],replyToThreadMessageId:null,deliveryMode:mode,steerTargets:runs().filter(r=>ids.includes(r.agent_id)&&r.status==='running').map(r=>({agentRunId:r.id,executionEpoch:r.execution_epoch})),execution:{taskId:null,purpose:'Steer isolated acceptance',completionRole:'required'}})
    assert.equal(result.commandResult.status,'accepted',JSON.stringify(result));return result.commandResult.payload.threadMessageId
  }
  await writeFile(join(project,'hold.mjs'),`import {access,writeFile} from 'node:fs/promises';const id=process.argv[2];await writeFile(id+'.ready','ready');while(true){try{await access(id+'.release');break}catch{await new Promise(r=>setTimeout(r,100))}}console.log('HOLD_COMPLETE');\n`)
  if(scenario==='cancel-only') {
    await send(['agent_1'],'执行 node ./hold.mjs cancel，不修改脚本。工具结束后才处理后续用户要求，最后公开报告并给出最终回复。')
    await wait(()=>exists('cancel.ready'),'cancel tool boundary')
    const target=runs().find(r=>r.agent_id==='agent_1'&&r.status==='running')
    const supplement=await send(['agent_1'],'当前工具完成后把 SHOULD_NOT_EXIST 写入 cancelled-side-effect.txt。','steer')
    await wait(()=>inputs(target.id).some(i=>i.input_kind==='steer'&&i.dispatch_started_at),'cancel input dispatched')
    const snapshot=await core.request('camps.open',{threadId,traceId:randomUUID()})
    const row=snapshot.agentRuns.find(r=>r.id===target.id)
    const cancelled=await core.request('agentRuns.cancel',{commandId:randomUUID(),command:{threadId,agentRunId:target.id,expectedVersion:row.version}})
    assert.notEqual(cancelled.status,'rejected',JSON.stringify(cancelled))
    await wait(()=>runs().find(r=>r.id===target.id&&r.status==='cancelled'),'cancel terminal',60_000)
    await new Promise(resolve=>setTimeout(resolve,2000))
    assert.equal(await exists('cancelled-side-effect.txt'),false)
    assert.equal(runs().length,1,'cancel must not start a replacement Run')
    assert.notEqual(deliveries(supplement)[0].status,'waiting')
    report.cases.push({name:'cancel with in-flight steer: no later side effect or successor',status:'passed',inputs:inputs(target.id),delivery:deliveries(supplement)})
  } else if(scenario!=='mixed-only') {
  await send(['agent_1'],'隔离验收：依次执行 node ./hold.mjs codex 和 node ./hold.mjs second（分成两次工具调用），不修改脚本。按本轮后续用户输入写文件；两次工具结束后用 rovai send --public-only 公开结果，并在最终回复中再次输出结果，不联系其他队员。')
  await wait(()=>exists('codex.ready'),'Codex tool boundary')
  const codexRun=runs().find(r=>r.agent_id==='agent_1').id
  await wait(()=>inputs(codexRun)[0]?.status==='accepted','initial native input accepted',60_000)
  const initial=inputs(codexRun);assert.equal(initial.length,1)
  const steeredSession=targetAdapter==='opencode-cli'?db.prepare('SELECT native_session_id FROM conversation WHERE camp_id=? AND agent_id=?').get(threadId,'agent_1')?.native_session_id:null
  const ordinary=scenario==='steer-only' ? null : await send(['agent_1'],'请把 ORDINARY_QUEUE 写入 ordinary.txt，然后用 rovai send --public-only 报告。')
  const text=await send(['agent_1'],'补充要求：工具结束后把 STEER_TEXT_成功 写入 text-result.txt。保留后续附件要求。','steer')
  await wait(()=>inputs(codexRun).find(i=>i.source_delivery_id===deliveries(text)[0].id&&i.dispatch_started_at),'text dispatch prepared',60_000)
  await writeFile(join(project,'codex.release'),'release')
  await wait(()=>exists('second.ready'),'second tool boundary')
  await wait(()=>inputs(codexRun).find(i=>i.source_delivery_id===deliveries(text)[0].id&&i.status==='accepted'),'text input accepted',60_000)
  const attachmentPath=join(project,'steer-attachment.txt')
  await writeFile(attachmentPath,'这是本轮补充要求：把 ATTACHMENT_成功 写入 attachment-result.txt，完成后用 rovai send --public-only 报告 STEER_TEXT_成功 ATTACHMENT_成功。')
  const attachment=await send(['agent_1'],'','steer',[{id:randomUUID(),sourcePath:attachmentPath,displayName:'steer-attachment.txt',kind:'file',mediaType:'text/plain',observedByteSize:Buffer.byteLength(await readFile(attachmentPath))}])
  await wait(()=>inputs(codexRun).find(i=>i.source_delivery_id===deliveries(attachment)[0].id&&i.dispatch_started_at),'attachment dispatch prepared',60_000)
  await writeFile(join(project,'second.release'),'release')
  await wait(()=>inputs(codexRun).find(i=>i.source_delivery_id===deliveries(attachment)[0].id&&i.status==='accepted'),'attachment-only accepted',60_000)
  if(ordinary)assert.equal(deliveries(ordinary)[0].status,'waiting')
  const three=inputs(codexRun);assert.equal(three.length,3);if(targetAdapter==='codex-cli')assert.equal(new Set(three.map(i=>i.native_input_id)).size,1)
  for(const [i,id] of [[three[1],text],[three[2],attachment]]) assert.deepEqual(JSON.parse(i.raw_message_refs_json).map(r=>r.entityId),[id])
  assert.ok(JSON.parse(three[2].attachment_refs_json).some(a=>a.path===attachmentPath))
  await writeFile(join(project,'codex.release'),'release')
  await wait(()=>runs().find(r=>r.id===codexRun&&['succeeded','failed','cancelled'].includes(r.status)),'Codex terminal')
  assert.equal(runs().find(r=>r.id===codexRun).status,'succeeded')
  assert.equal((await readFile(join(project,'text-result.txt'),'utf8')).trim(),'STEER_TEXT_成功')
  assert.equal((await readFile(join(project,'attachment-result.txt'),'utf8')).trim(),'ATTACHMENT_成功')
  report.cases.push({name:'same-run text + attachment-only',status:'passed',inputs:three})
  if(ordinary) {
  await wait(()=>runs().filter(r=>r.agent_id==='agent_1').length===2&&runs().every(r=>!['queued','running','waiting'].includes(r.status)),'ordinary completion')
  assert.equal((await readFile(join(project,'ordinary.txt'),'utf8')).trim(),'ORDINARY_QUEUE')
  assert.equal(runs().filter(r=>r.agent_id==='agent_1').length,2)
  if(targetAdapter==='opencode-cli') {
    const nextSession=db.prepare('SELECT native_session_id FROM conversation WHERE camp_id=? AND agent_id=?').get(threadId,'agent_1')?.native_session_id
    assert.ok(steeredSession&&nextSession);assert.notEqual(nextSession,steeredSession,'successful original Run does not clear persistent inbox risk')
  }
  report.cases.push({name:'ordinary queue separation',status:'passed'})
  }
  }
  if(scenario==='full'||scenario==='mixed-only') {
  const runsBeforeMixed=runs().length
  await send(['agent_1'],'执行 node ./hold.mjs mixed-codex，不修改脚本。结束后把后续用户要求写入 mixed-codex.txt 并用 rovai send --public-only 报告；无后续要求写 ORIGINAL。')
  await send(['agent_2'],'执行 node ./hold.mjs mixed-opencode，不修改脚本。结束后用 rovai send --public-only 报告 ORIGINAL，并在最终回复中再次输出 ORIGINAL。')
  await wait(()=>exists('mixed-codex.ready'),'mixed Codex boundary');await wait(()=>exists('mixed-opencode.ready'),'mixed OpenCode boundary')
  const mixedTarget=runs().find(r=>r.agent_id==='agent_1'&&r.status==='running')
  await wait(()=>inputs(mixedTarget.id)[0]?.status==='accepted','mixed initial input accepted',60_000)
  const mixedSnapshot=await core.request('camps.open',{threadId,traceId:randomUUID()})
  const busyPeer=mixedSnapshot.agentRuns.find(r=>r.agentId==='agent_2'&&r.status==='running')
  assert.ok(busyPeer,'mixed OpenCode peer must still be running')
  const multi=await send(['agent_1','agent_2','agent_3'],'隔离多队员要求：每人把文本 MIXED_成功 原样写入自己的文件。agent_1 的文件是 mixed-codex.txt；agent_2 是 mixed-opencode.txt；agent_3 是 mixed-idle.txt。文件正文只包含 MIXED_成功，不写姓名或说明。各自只写自己的文件，用 rovai send --public-only 报告，并在最终回复中再次输出 MIXED_成功。','steer')
  await wait(()=>inputs(runs().find(r=>r.agent_id==='agent_1'&&r.status==='running').id).some(i=>i.input_kind==='steer'&&i.dispatch_started_at),'mixed steer dispatched')
  const route=deliveries(multi)
  assert.equal(route[0].requested_mode,'steer');assert.equal(route[1].requested_mode,busyPeer.canSteer?'steer':'start');assert.equal(route[1].status,busyPeer.canSteer?'claimed':'waiting');assert.equal(route[2].requested_mode,'start')
  await wait(()=>exists('mixed-idle.txt'),'idle independent start')
  await writeFile(join(project,'mixed-codex.release'),'release');await writeFile(join(project,'mixed-opencode.release'),'release')
  for(const name of ['mixed-codex.txt','mixed-opencode.txt'])await wait(()=>exists(name),name)
  await wait(()=>runs().length===runsBeforeMixed+(busyPeer.canSteer?3:4)&&runs().every(r=>!['queued','running','waiting'].includes(r.status)),'mixed terminal')
  for(const name of ['mixed-codex.txt','mixed-opencode.txt','mixed-idle.txt'])assert.ok((await readFile(join(project,name),'utf8')).includes('MIXED_成功'))
  report.cases.push({name:'one public multi-mention: capable busy / version-gated busy / idle',status:'passed',busyPeerCanSteer:busyPeer.canSteer,routes:route})
  }
  report.runs=runs();report.status='passed'
} catch(error) {report.status='failed';report.error=error.stack;process.exitCode=1}
finally {
  for(const name of ['codex','second','mixed-codex','mixed-opencode','cancel'])await writeFile(join(project,`${name}.release`),'release')
  if(db) {
    report.finalRuns=db.prepare('SELECT r.id,c.agent_id,r.status,r.execution_epoch,r.last_error_code FROM agent_run r JOIN conversation c ON c.id=r.conversation_id WHERE r.camp_id=? ORDER BY r.created_at,r.id').all(threadId)
    report.finalInputs=db.prepare('SELECT i.id,i.agent_run_id,i.status,i.input_kind,i.native_input_id,i.last_error FROM runtime_input_delivery i JOIN agent_run r ON r.id=i.agent_run_id WHERE r.camp_id=? ORDER BY i.prepared_at').all(threadId)
  }
  db?.close();if(core)report.coreExit=await core.stop()
  report.finishedAt=new Date().toISOString();await writeFile(join(fixture,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}
