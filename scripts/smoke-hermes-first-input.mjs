// Production Core + unmodified installed Hermes, deterministic local Responses.
// Captures actual model requests. Compression mode changes only this disposable
// fixture's window/tail and reports synthetic usage; it is not real-model QA.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startQualificationCore, descendantsOf, processTable, waitForProcessesToExit } from './lib/qualification-core.mjs'
import { createConfiguredCampAndSend, composerDocumentForAddress } from './lib/create-configured-camp.mjs'

assert(process.env.ROVAI_HERMES_BIN)
const compression = process.argv.includes('--compression')
const availability = process.argv.includes('--availability')
const recovery = availability || process.argv.includes('--recovery')
const modelSelection = !compression && !recovery
assert(!(compression && recovery), 'Use separate fixtures for compaction and crash recovery')
const protectFirst = process.argv.includes('--unprotected') ? 0 : 3
const repository = resolve(import.meta.dirname, '..')
const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-hermes-first-input-')))
const home = join(root, 'home'), project = join(root, 'project'), data = join(root, 'data')
await mkdir(home, { mode: 0o700 }); await mkdir(project)
await writeFile(join(root, 'mcp.json'), '{}')
if (process.env.ROVAI_HERMES_DEPENDENCY_HOME) await symlink(join(process.env.ROVAI_HERMES_DEPENDENCY_HOME, 'installs'), join(home, 'installs'), 'dir')
const wire = [], results = []
let core, database, wireError, phase = 0, roundCall = 0, summaries = 0, requestCount = 0
function respond(response, body, item, inputTokens = 100) {
  const id = 'response-' + (++requestCount)
  const result = { id, object: 'response', status: 'completed', output: [item],
    usage: { input_tokens: inputTokens, output_tokens: 10, total_tokens: inputTokens + 10 } }
  if (!body.stream) { response.writeHead(200, {'content-type':'application/json'}); response.end(JSON.stringify(result)); return }
  response.writeHead(200, {'content-type':'text/event-stream'})
  let sequence = 0
  const emit = event => response.write('data: ' + JSON.stringify({...event, sequence_number: sequence++}) + '\n\n')
  emit({type:'response.created',response:{id,status:'in_progress',output:[]}})
  emit({type:'response.output_item.added',output_index:0,item})
  if (item.type === 'message') emit({type:'response.output_text.delta',output_index:0,content_index:0,item_id:item.id,delta:item.content[0].text})
  emit({type:'response.output_item.done',output_index:0,item})
  emit({type:'response.completed',response:result}); response.end()
}
const message = text => ({id:crypto.randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]})
const server = createServer(async(request,response)=>{
  try {
    if(request.method==='GET'){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({object:'list',data:['fixture-model','fixture-selected'].map(id=>({id,object:'model'}))}));return}
    const chunks=[];for await(const chunk of request)chunks.push(chunk)
    const body=JSON.parse(Buffer.concat(chunks).toString())
    if(request.url==='/api/show'){response.writeHead(200,{'content-type':'application/json'});response.end('{}');return}
    assert(Array.isArray(body.input), 'Unexpected provider protocol: '+request.url)
    const main=Array.isArray(body.tools)&&body.tools.length>0
    wire.push({phase,main,body})
    if(!main){summaries++;respond(response,body,message('The earlier isolated acceptance tasks completed. Continue with the current request.'));return}
    roundCall++
    if(roundCall===1){
      respond(response,body,{id:crypto.randomUUID(),type:'function_call',call_id:crypto.randomUUID(),name:'terminal',
        arguments:JSON.stringify({command:`rovai send --public-only --body HERMES_RULES_PHASE_${phase}`
          +(recovery&&phase===4?'; echo hit >> crash.count; echo $$ > crash.pid; sleep 120':'')}),status:'completed'},compression&&[3,4].includes(phase)?60000:100)
    }else{respond(response,body,message('Done.'))}
  }catch(error){wireError=error;response.writeHead(500);response.end()}
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
const config={model:{provider:'fixture',default:'fixture-model',...(compression?{context_length:65536}:{})},
  // Keep this loopback fixture offline during native --version's passive update check.
  updates:{check:false},
  providers:{fixture:{base_url:`http://127.0.0.1:${server.address().port}/v1`,api_key_env:'ROVAI_HERMES_FIXTURE_KEY',transport:'codex_responses',models:['fixture-model','fixture-selected']}},
  platform_toolsets:{acp:['terminal','no_mcp']},session_title:{enabled:false},agent:{max_turns:8,system_prompt:'NATIVE_CONFIG_SYSTEM_639'},
  compression:compression?{enabled:true,threshold:0.5,protect_first_n:protectFirst,protect_last_n:2}:{enabled:false}}
await writeFile(join(home,'config.yaml'),JSON.stringify(config),{mode:0o600})
const availabilityEvidence = availability ? {} : undefined
let launcherA, launcherB, changedHome
if (availability) {
  launcherA=join(root,'hermes-a');launcherB=join(root,'hermes-b');changedHome=join(root,'changed-home')
  // Wrappers only change the launch identity. Both execute the same untouched
  // official version; this is not evidence for another native version.
  const wrapper=`#!/bin/sh\nexec '${process.env.ROVAI_HERMES_BIN.replaceAll("'", "'\\''")}' "$@"\n`
  for(const path of [launcherA,launcherB])await writeFile(path,wrapper,{mode:0o700})
  await mkdir(changedHome,{mode:0o700})
  await writeFile(join(changedHome,'config.yaml'),JSON.stringify({...config,agent:{...config.agent,system_prompt:'NEW_HOME_MUST_NOT_REPLACE_ORIGINAL'}}),{mode:0o600})
  if(process.env.ROVAI_HERMES_DEPENDENCY_HOME)await symlink(join(process.env.ROVAI_HERMES_DEPENDENCY_HOME,'installs'),join(changedHome,'installs'),'dir')
}
const coreOptions={coreExecutable:join(repository,'target/debug/rovai-core'),dataDirectory:data,workingDirectory:repository,
  runtimeCacheDirectory:join(root,'cache'),mcpConfigPath:join(root,'mcp.json'),
  environmentOverrides:{HERMES_HOME:home,HERMES_DISABLE_LAZY_INSTALLS:'1',HERMES_EPHEMERAL_SYSTEM_PROMPT:'',ROVAI_HERMES_FIXTURE_KEY:'controlled-fixture',...(availability?{ROVAI_HERMES_BIN:launcherA}:{})}}
console.log('Automatic acceptance:',JSON.stringify({root,data,skillLibrary:join(data,'managed-skill-library'),home,compression,config:config.compression}))
async function waitFor(fn,timeout=120000){const until=Date.now()+timeout;while(Date.now()<until){if(wireError)throw wireError;const result=await fn();if(result)return result;await new Promise(done=>setTimeout(done,100))}throw new Error('Acceptance timed out')}
const sql=(query,...args)=>database.prepare(query).get(...args)
try{
  core=startQualificationCore(coreOptions);await core.request('health.check')
  await waitFor(async()=>!(await core.request('runtime.status.get')).runtimeAvailability.some(row=>row.runtimeKind==='hermes-cli'&&row.discovery.discoveryStatus==='detecting'))
  await core.request('runtime.product.check',{runtimeKind:'hermes-cli'})
  const installation=await waitFor(async()=>{const row=(await core.request('runtime.installations.list')).find(row=>row.adapterKind==='hermes-cli'&&row.installationClass==='managed_default');if(['probe_failed','missing_capabilities'].includes(row?.snapshot?.probeStatus))throw new Error(row.snapshot.lastError);return row?.snapshot?.probeStatus==='ready'&&row})
  let selectedInstallationId=installation.id
  let member=await core.request('members.get',{agentId:'agent_2'})
  assert.equal((await core.request('members.runtime.set',{commandId:crypto.randomUUID(),command:{agentId:'agent_2',expectedVersion:member.version,adapterKind:'hermes-cli',model:installation.memberRuntimeDefaults.model,permissions:installation.memberRuntimeDefaults.permissions}})).status,'applied')
  let thread, nativeId, previousRequested=0
  database=new DatabaseSync(join(data,'rovai.sqlite'),{readOnly:true})
  let recoveryEvidence
  for(phase=0;phase<(compression?7:recovery?6:4);phase++){
    roundCall=0
    if(modelSelection&&phase===1){
      member=await core.request('members.get',{agentId:'agent_2'})
      assert.equal((await core.request('members.runtime.set',{commandId:crypto.randomUUID(),command:{
        agentId:'agent_2',expectedVersion:member.version,adapterKind:'hermes-cli',
        model:{mode:'explicit',modelId:'custom:fixture:fixture-selected',options:{}},
        permissions:installation.memberRuntimeDefaults.permissions}})).status,'applied')
    }
    if(availability&&phase===1)await appendFile(launcherA,'# changed executable fingerprint\n')
    if(phase===2||phase===6){
      await core.stop()
      if(availability&&phase===2){coreOptions.environmentOverrides.ROVAI_HERMES_BIN=launcherB;coreOptions.environmentOverrides.HERMES_HOME=changedHome}
      if(recovery&&phase===2){
        // Disposable Core fixture only: recreate the old Ready snapshot, then
        // exercise ordinary startup discovery and dispatch refresh.
        const upgrade=new DatabaseSync(join(data,'rovai.sqlite'))
        try{const old=installation.snapshot.capabilities.filter(c=>!c.startsWith('context.charter.')&&!c.startsWith('context.compaction.'))
          old.push('context.charter.managed_system_prompt','context.compaction.native_system_prompt_preserved')
          upgrade.prepare('UPDATE adapter_capability_snapshot SET capabilities_json=? WHERE installation_id=?').run(JSON.stringify(old),installation.id)
        }finally{upgrade.close()}
      }
      core=startQualificationCore(coreOptions);await core.request('health.check')
      if(recovery&&phase===2){
        await waitFor(async()=>!(await core.request('runtime.status.get')).runtimeAvailability.some(row=>row.runtimeKind==='hermes-cli'&&row.discovery.discoveryStatus==='detecting'))
        const stale=(await core.request('runtime.installations.list')).find(row=>row.id===installation.id)
        assert.equal(stale.snapshot.probeStatus,'installed_unverified','Old Ready must be invalidated even when native program bytes are unchanged')
        assert(!stale.snapshot.capabilities.includes('context.charter.managed_system_prompt'))
        await core.request('runtime.product.check',{runtimeKind:'hermes-cli'})
        await waitFor(async()=>{const row=(await core.request('runtime.installations.list')).find(row=>row.id===installation.id);return row?.snapshot?.probeStatus==='ready'})
      }
    }
    if(phase===3){
      member=await core.request('members.get',{agentId:'agent_2'})
      assert.equal((await core.request('members.update',{commandId:crypto.randomUUID(),command:{agentId:'agent_2',expectedVersion:member.version,
        displayName:'Hermes identity updated',teamRole:member.teamRole,professionalResponsibilities:member.professionalResponsibilities,
        personalityTraits:member.personalityTraits,workingPrinciples:member.workingPrinciples,growthTopic:member.growthTopic}})).status,'applied')
    }
    const body=`Isolated task HERMES_TASK_${phase}: publish the phase marker with rovai send --public-only, then finish.`
    const sent=phase===0?await createConfiguredCampAndSend(core.request,{commandId:crypto.randomUUID(),name:'Hermes first-input acceptance',purpose:'User-layer rules and exact acceptance',body,memberAgentIds:['agent_2'],defaultLeadAgentId:'agent_2',workspace:{projectPath:project}}):await core.request('thread.messages.send',{commandId:crypto.randomUUID(),threadId:thread,
      content:composerDocumentForAddress({mode:'explicit',agentIds:['agent_2']},body),sourceAttachments:[],quotes:[],replyToThreadMessageId:null,deliveryMode:'start',execution:{taskId:null,purpose:'Rules acceptance',completionRole:'required'}})
    if(phase===0)thread=sent.payload.threadId??sent.payload.campId
    if(recovery&&phase===4){
      await waitFor(()=>readFile(join(project,'crash.pid'),'utf8').catch(()=>false))
      const crash=sql('SELECT id,status FROM agent_run WHERE camp_id=? ORDER BY rowid DESC LIMIT 1',thread)
      assert.equal(crash.status,'running')
      const owned=descendantsOf(await processTable(),core.pid), requestsBefore=wire.length
      process.kill(core.pid,'SIGKILL');await core.stop(1000)
      core=null
      if(availability){
        // Isolated Core upgrade fixture, never native SessionDB repair. Replace
        // the selected installation record while preserving old Run/binding
        // references. Startup still has to discover/probe the actual entry.
        const upgrade=new DatabaseSync(join(data,'rovai.sqlite'))
        const replacement='adapter-installation-'+crypto.randomUUID()
        try{
          upgrade.exec('BEGIN')
          const old=upgrade.prepare('SELECT * FROM adapter_installation WHERE id=?').get(selectedInstallationId)
          upgrade.prepare("UPDATE adapter_installation SET installation_class='custom',auth_scope='archived-fixture',enabled=0 WHERE id=?").run(selectedInstallationId)
          function copyRow(table,row){const columns=Object.keys(row);upgrade.prepare(`INSERT INTO ${table} (${columns.map(c=>'"'+c+'"').join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...Object.values(row))}
          copyRow('adapter_installation',{...old,id:replacement})
          for(const table of ['adapter_capability_snapshot','runtime_executable_identity','runtime_entrypoint_locator_identity']){
            const read=upgrade.prepare(`SELECT * FROM ${table} WHERE installation_id=?`)
            read.setReadBigInts(true)
            const row=read.get(selectedInstallationId)
            if(row)copyRow(table,{...row,installation_id:replacement,...(table==='adapter_capability_snapshot'?{reported_version:'0.22.3'}:{})})
          }
          upgrade.prepare('UPDATE agent_profile SET default_runtime_installation_id=?,version=version+1 WHERE default_runtime_installation_id=?').run(replacement,selectedInstallationId)
          upgrade.exec('COMMIT')
        }finally{upgrade.close()}
        selectedInstallationId=replacement
        coreOptions.environmentOverrides.ROVAI_HERMES_BIN=launcherA
        await appendFile(launcherA,'# next selected installation after interruption\n')
      }
      core=startQualificationCore(coreOptions);await core.request('health.check')
      if(availability)await waitFor(async()=>!(await core.request('runtime.status.get')).runtimeAvailability.some(row=>row.runtimeKind==='hermes-cli'&&row.discovery.discoveryStatus==='detecting'))
      assert.deepEqual(await waitForProcessesToExit(owned,30000),[])
      await waitFor(()=>sql('SELECT status FROM agent_run WHERE id=?',crash.id).status==='failed')
      assert.equal(sql('SELECT COUNT(*) AS n FROM agent_run WHERE camp_id=?',thread).n,5)
      const inspect=await core.request('agentRuns.hermesRecovery.inspect',{agentRunId:crash.id})
      assert.equal(inspect.state,'unknown');assert(inspect.warning.includes('外部效果'));assert(inspect.confirmation)
      assert.equal(inspect.scope.nativeSessionId,nativeId)
      const resolution={commandId:crypto.randomUUID(),confirmation:inspect.confirmation,acknowledgeEffects:true}
      await assert.rejects(core.request('agentRuns.hermesRecovery.resolve',{...resolution,acknowledgeEffects:false}))
      const stale=structuredClone(resolution);stale.confirmation.scope.nativeBindingGeneration++
      await assert.rejects(core.request('agentRuns.hermesRecovery.resolve',stale))
      const wrong=structuredClone(resolution);wrong.commandId=crypto.randomUUID();wrong.confirmation.executionGeneration++
      await assert.rejects(core.request('agentRuns.hermesRecovery.resolve',wrong))
      await assert.rejects(core.request('agentRuns.hermesRecovery.resolve',{...resolution,commandId:wrong.commandId}),
        'A commandId may not authorize a changed target after the first attempt')
      const again=await core.request('agentRuns.hermesRecovery.inspect',{agentRunId:crash.id})
      assert.deepEqual(again.confirmation,inspect.confirmation,'Read-only inspection or stale discard changed the unknown execution')
      if(availability){
        await core.request('thread.messages.send',{commandId:crypto.randomUUID(),threadId:thread,
          content:composerDocumentForAddress({mode:'explicit',agentIds:['agent_2']},'A new task while the previous native execution is still unknown.'),
          sourceAttachments:[],quotes:[],replyToThreadMessageId:null,deliveryMode:'start',execution:{taskId:null,purpose:'Verify restored-but-blocked state',completionRole:'required'}})
        const blocked=await waitFor(()=>{const row=sql('SELECT id,status,public_runtime_failure_json AS failure_json FROM agent_run WHERE camp_id=? ORDER BY rowid DESC LIMIT 1',thread);return row.id!==crash.id&&['succeeded','failed','cancelled'].includes(row.status)&&row})
        assert.equal(blocked.status,'failed');assert(blocked.failure_json.includes('hermes_session_unknown'),blocked.failure_json)
        assert.equal(sql('SELECT COUNT(*) AS n FROM runtime_input_delivery WHERE agent_run_id=? AND dispatch_started_at IS NOT NULL',blocked.id).n,0)
        assert.equal(sql('SELECT native_session_id FROM conversation WHERE camp_id=?',thread).native_session_id,nativeId)
        const stillUnknown=await core.request('agentRuns.hermesRecovery.inspect',{agentRunId:crash.id})
        assert.deepEqual(stillUnknown.confirmation,inspect.confirmation)
        availabilityEvidence.restoredUnknownSeparatelyBlockedInput=true
        results.push({phase,run:blocked.id,kind:'none',status:'failed',reason:'native_unknown_before_input'})
        const selected=(await core.request('runtime.installations.list')).find(row=>row.id===selectedInstallationId)
        assert.equal(selected.executablePath,launcherA)
        availabilityEvidence.replacedInstallationAndStaleVersionCacheRecovered=true
      }
      const resolved=await core.request('agentRuns.hermesRecovery.resolve',resolution)
      assert.equal(resolved.status,'applied');assert.equal(resolved.payload.nativeReceipt.status,'terminal')
      assert.equal(resolved.payload.nativeReceipt.outcome,'interrupted')
      // Simulate losing the first reply, then retry the exact user intent after
      // Core restart. Native receipts, not rerunning the task, settle uncertainty.
      await core.stop();core=startQualificationCore(coreOptions);await core.request('health.check')
      const reconciled=await core.request('agentRuns.hermesRecovery.resolve',resolution)
      assert.deepEqual(reconciled,resolved)
      assert.equal(wire.length,requestsBefore,'Maintenance invoked the model')
      assert.equal(sql('SELECT status FROM agent_run WHERE id=?',crash.id).status,'failed')
      assert.equal(sql('SELECT COUNT(*) AS n FROM agent_run WHERE camp_id=?',thread).n,availability?6:5)
      assert.equal(await readFile(join(project,'crash.count'),'utf8'),'hit\n')
      recoveryEvidence={inspectionPreservedUnknown:true,staleGenerationRejected:true,explicitResolution:true,
        originalRunFailed:true,noModelCall:true,noReplay:true,retryAfterRestart:true,processesReaped:true}
      results.push({phase,run:crash.id,kind:'none',status:'failed'})
      console.log('Explicit crash recovery:',JSON.stringify(recoveryEvidence))
      continue
    }
    const run=await waitFor(()=>{const row=sql('SELECT id,status FROM agent_run WHERE camp_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',thread);return row&&['succeeded','failed','cancelled'].includes(row.status)&&!results.some(r=>r.run===row.id)&&row})
    assert.equal(run.status,'succeeded',JSON.stringify(run))
    const usage=sql('SELECT prompt_input_total_tokens,output_tokens,cost_amount_decimal FROM runtime_usage_run_summary WHERE agent_run_id=?',run.id)
    for(const field of ['prompt_input_total_tokens','output_tokens','cost_amount_decimal'])assert.equal(usage?.[field]??null,null,'Supplementary usage missing must not fabricate consumption or prevent success')
    const delivery=sql('SELECT * FROM runtime_input_delivery WHERE agent_run_id=? AND input_kind=\'start\'',run.id)
    const binding=sql('SELECT native_session_id FROM conversation WHERE camp_id=? AND agent_id=?',thread,'agent_2')
    nativeId??=binding.native_session_id;assert.equal(binding.native_session_id,nativeId)
    assert.equal(delivery.status,'accepted')
    const expected=phase===0?'initial':phase===3?'update':previousRequested?'compaction_recovery':'none'
    assert.equal(delivery.hermes_rules_delivery_kind,expected)
    const blob=sql('SELECT storage_relative_path FROM managed_blob WHERE id=?',delivery.hermes_runtime_payload_blob_id)
    const payload=await readFile(join(data,'managed-blobs',blob.storage_relative_path),'utf8')
    assert.equal(payload.split('[MEMBER_IDENTITY]').length-1,expected==='none'?0:1)
    assert(payload.includes(`HERMES_TASK_${phase}`))
    const first=wire.find(row=>row.phase===phase&&row.main).body
    if(modelSelection)for(const request of wire.filter(row=>row.phase===phase&&row.main)){
      assert.equal(request.body.model,phase===0?'fixture-model':'fixture-selected',
        'Explicit Core model selection must change actual native requests, including cold resume')
    }
    const system=(first.instructions??'')+JSON.stringify(first.input.filter(m=>['system','developer'].includes(m.role)))
    assert(system.includes('NATIVE_CONFIG_SYSTEM_639'));assert(!system.includes('[SESSION_CHARTER]'))
    if(availability){
      assert(!system.includes('NEW_HOME_MUST_NOT_REPLACE_ORIGINAL'))
      const current=(await core.request('runtime.installations.list')).find(row=>row.id===selectedInstallationId)
      if(phase===1){assert.notEqual(current.snapshot.executableFingerprint,installation.snapshot.executableFingerprint);availabilityEvidence.fingerprintDriftResumed=true}
      if(phase===2){assert.equal(current.executablePath,launcherB);availabilityEvidence.pathDriftColdResumed=true;availabilityEvidence.originalHomePreserved=true}
    }
    // Native Gateway trims the submitted message edges before the API call.
    // Core's frozen transport text remains unchanged; all rule/task content must match.
    assert(first.input.some(m=>m.role==='user'&&m.content===payload.trim()),'Actual user request differs from native-trimmed frozen payload')
    const requirement=sql('SELECT requested_revision,acknowledged_revision FROM bootstrap_redelivery_requirement WHERE native_binding_id=?',delivery.native_binding_id)
    previousRequested=requirement&&requirement.requested_revision>requirement.acknowledged_revision?requirement.requested_revision:0
    results.push({phase,run:run.id,model:first.model,kind:expected,requested:requirement?.requested_revision??0,acknowledged:requirement?.acknowledged_revision??0,mainRequests:wire.filter(r=>r.phase===phase&&r.main).length})
    console.log('Phase:',JSON.stringify(results.at(-1)))
  }
  if(compression){assert(summaries>=2,'Two native automatic summaries not observed');assert(results.at(-1).acknowledged>=2,'Completed native hooks did not trigger accepted recovery');assert.equal(results.at(-1).kind,'none','Post-compaction cold resume duplicated accepted rules');assert.equal(previousRequested,0)}
  if(recovery){
    for(const n of [4,5])assert.equal(sql("SELECT COUNT(*) AS n FROM camp_message WHERE camp_id=? AND author_type='agent' AND body=?",thread,`HERMES_RULES_PHASE_${n}`).n,1)
    if(availability){
      // Ordinary restoration above does not require a historical Ready. Check
      // the directory separately, after the new task has already succeeded.
      await core.request('runtime.product.check',{runtimeKind:'hermes-cli'})
      await waitFor(async()=>{const row=(await core.request('runtime.installations.list')).find(row=>row.id===selectedInstallationId);return row?.snapshot?.probeStatus==='ready'})
    }
    const refreshed=JSON.parse(sql('SELECT capabilities_json FROM adapter_capability_snapshot WHERE installation_id=?',selectedInstallationId).capabilities_json)
    for(const c of ['context.charter.first_payload','context.compaction.signal_driven','context.compaction.best_effort','session.set_model','session.set_mode','structured_permission_request'])assert(refreshed.includes(c),c)
    for(const c of ['context.charter.managed_system_prompt','context.compaction.native_system_prompt_preserved'])assert(!refreshed.includes(c))
    recoveryEvidence.legacyReadySnapshotRefreshed=true;recoveryEvidence.noDuplicateSend=true
  }
  const summary={version:installation.snapshot.reportedVersion,compression,protectFirst,syntheticProvider:true,successWithoutEnhancedUsage:true,nativeSessionUnchanged:true,explicitModelSelection:modelSelection,summaries,results,recovery:recoveryEvidence,availability:availabilityEvidence}
  await writeFile(join(root,'summary.json'),JSON.stringify(summary,null,2))
  console.log('Hermes first-input acceptance passed:',root)
}catch(error){console.error(error);throw error}finally{
  await writeFile(join(root,'wire.json'),JSON.stringify(wire,null,2))
  database?.close();if(core){const stopped=await core.stop();await writeFile(join(root,'core-stderr.log'),stopped.stderrTail??'')}
  server.closeAllConnections();await new Promise(done=>server.close(done))
}
