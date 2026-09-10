import assert from 'node:assert/strict'
import test from 'node:test'
import { directExecWrapper, nativeCommandCorePayload, nativeOutputProjection, extractNativeWitnesses } from './qualification-native-witness.mjs'
import { supplementEvaluationContext } from './qualification-evaluation-context.mjs'
import { digestJson } from './qualification-common.mjs'

// Synthetic protocol fixtures: never reported as actual task executions.
function fixture() {
  const cmd = 'node check.mjs; git status --short', workspace = '/isolated/trial'
  const item = { id: 'cmd-1', type: 'commandExecution', command: cmd, cwd: workspace, status: 'completed', exitCode: 0, durationMs: 12, aggregatedOutput: '?? report.json\n', commandActions: [] }
  const core = { id: 'core-1', kind: 'command', payloadDigest: digestJson(nativeCommandCorePayload(item)) }
  const rows = [
    { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'call-1', input: `const r = await tools.exec_command(${JSON.stringify({cmd,workdir:workspace})}); text(r.output);` } },
    { type: 'event_msg', payload: { type: 'item_completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { type: 'CommandExecution', id: item.id, command: ['sh','-c',cmd], exit_code: 0 } } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'call-1', output: [{type:'text',text:'Script completed\nWall time: 1'}, {type:'text',text:'CHECK_OK\n?? report.json\n'}] } }
  ]
  return { rows, item, core, workspace }
}

test('direct native wrappers admit only unchanged result data flow', () => {
  for (const [tail,mode] of [['text(r.output)','text'],['text(r)','json'],['text(JSON.stringify(r))','json'],['text(JSON.stringify({exit_code:r.exit_code,output:r.output}))','json'],['text(r.output); text(`exit_code=${r.exit_code}`)','text_exit']]) {
    assert.equal(directExecWrapper(`const cwd='/trial'; const r=await tools.exec_command({cmd:'node check.mjs',workdir:cwd}); ${tail}`)?.mode,mode)
  }
  for (const input of [
    `const r=await tools.exec_command({cmd:'node x',workdir:'/t'}); text('CHECK_OK')`,
    `const r=await tools.exec_command({cmd:'node x',workdir:'/t'}); r.output='CHECK_OK';text(r.output)`,
    `const r=await tools.exec_command({cmd:'node x',workdir:'/t'});text(r.output.replace('FAIL','PASS'))`,
    `const r=await tools.exec_command({cmd:makeCommand(),workdir:'/t'});text(r.output)`,
    `const r=await tools.exec_command({cmd:'node x',workdir:'/t'});const s=await tools.exec_command({cmd:'node y',workdir:'/t'});text(r.output)`,
    `const r=await tools.exec_command({cmd:'node x',cmd:'node y',workdir:'/t'});text(r.output)`,
    `const r=await tools.exec_command({...args});text(r.output)`
  ]) assert.equal(directExecWrapper(input),null,input)
})

test('native full output requires an exact original Core digest and unchanged wrapper', () => {
  const f=fixture(),run=f=>extractNativeWitnesses(f.rows,[f.item],[f.core],f.workspace)
  assert.equal(run(f)[0].projection.output,'CHECK_OK\n?? report.json\n')
  for (const mutate of [
    f=>{f.core.payloadDigest='0'.repeat(64)},f=>{f.item.exitCode=1},f=>{f.workspace='/another/trial'},
    f=>{f.rows[2].payload.output[1].text='invented suffix'},f=>{f.rows.splice(2,0,structuredClone(f.rows[1]))},
    f=>{f.rows[0].payload.input=f.rows[0].payload.input.replace('text(r.output)','text("CHECK_OK")')}
  ]) { const f=fixture();mutate(f);assert.equal(run(f).length,0) }
})

test('only a proven final readonly help suffix can leave the verification prefix', () => {
  const output='extra edge checks passed\nrovai send\nUsage: help\n'
  const good=nativeOutputProjection('node checks.mjs\nrovai send --help',output,output)
  assert.equal(good.command,'node checks.mjs');assert.equal(good.output,'extra edge checks passed\n')
  assert.equal(nativeOutputProjection('node checks.mjs\nrovai send --help',output,'different help'),null)
  assert.equal(nativeOutputProjection('node checks.mjs\nrovai send --to member',output,output),null)
  assert.equal(nativeOutputProjection('node checks.mjs','review-duo confidential', 'review-duo confidential'),null)
})

test('supplement reconstruction rejects a resealed forgery and leaves original capture immutable', () => {
  const f=fixture(),records=extractNativeWitnesses(f.rows,[f.item],[f.core],f.workspace)
  const snapshot={ executionEvidence:[f.core],evaluationContext:{policyId:'bounded-evaluation-context-v1',receipts:[],omitted:[],tasks:[],deliveryMessageIds:[]} }
  const before=structuredClone(snapshot),capture={state:'captured',records}
  const actual=supplementEvaluationContext(snapshot,capture,[],'f'.repeat(64))
  assert.equal(actual.receipts[0].nativeWitnessDigest,records[0].witnessDigest)
  assert.equal(JSON.parse(actual.receipts[0].content).output,'CHECK_OK\n?? report.json\n')
  assert.deepEqual(snapshot,before)
  records[0].projection.output='FAKE_OK';const {witnessDigest,...payload}=records[0];records[0].witnessDigest=digestJson(payload)
  assert.throws(()=>supplementEvaluationContext(snapshot,capture,[],'f'.repeat(64)),/reconstruction/)
})
