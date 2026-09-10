import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEvaluationContext } from './qualification-evaluation-context.mjs'
import { digestJson, sha256 } from './qualification-common.mjs'
const boundary = {campTurnId:'turn', rootAgentRunId:'lead-run'}
const event = (id, command, output, status='completed') => ({id,agentRunId:'lead-run',executionEpoch:1,payload:{item:{id,type:'commandExecution',command,aggregatedOutput:output,status,exitCode:status==='failed'?1:0}}})
const snapshot = () => ({agentRuns:[{id:'lead-run',agentId:'lead',campTurnId:'turn'}],messages:[],tasks:[],executionEvidence:[]})
test('isolated receipt projection retains observed success/failure, deduplicates, excludes foreign and private activity', () => {
  const s=snapshot(), ok=event('ok','npm test','tests 5 pass 5'), bad=event('bad','node --test tests/public.test.mjs','assertion failed','failed')
  s.executionEvidence=[ok,ok,bad,{...event('foreign','npm test','FOREIGN'),agentRunId:'foreign'},event('pending','npm test','PENDING','inProgress'),{id:'thought',agentRunId:'lead-run',payload:{text:'PRIVATE_THOUGHT'}},event('mixed','node check.mjs && rovai task view','PROCESS_SECRET')]
  const result=buildEvaluationContext(s,boundary)
  assert.equal(result.receipts.length,2)
  assert.equal(JSON.parse(result.receipts[1].content).exitCode,1)
  assert.equal(result.receipts[0].sourcePayloadDigest,digestJson(ok.payload))
  assert.equal(result.receipts[0].contentDigest,sha256(result.receipts[0].content))
  assert.doesNotMatch(JSON.stringify(result),/FOREIGN|PENDING|PRIVATE_THOUGHT|PROCESS_SECRET/)
  assert.equal(result.omitted[0].reason,'mixed_process_command')
  assert.equal(result.coverage.allRuntimeCommandsClaimed,false)
})
test('receipt bounds retain truncation and missing output, and redact credential/path content', () => {
  const s=snapshot();s.executionEvidence=[event('large','npm test','x'.repeat(30000)),event('missing','node check.mjs',null),event('secret','node /Users/alice/test.mjs','api_key=example-secret')]
  const rows=buildEvaluationContext(s,boundary).receipts.map(r=>JSON.parse(r.content))
  assert.equal(rows[0].outputTruncated,true);assert.equal(rows[0].output.length,24000)
  assert.equal(rows[1].output,null);assert.doesNotMatch(JSON.stringify(rows),/Users\/alice|example-secret/)
  s.executionEvidence=Array.from({length:100},(_,i)=>event(String(i),'npm test','x'.repeat(23000)))
  const bounded=buildEvaluationContext(s,boundary)
  assert.ok(bounded.receipts.reduce((n,r)=>n+r.content.length,0)<=160000)
  assert.ok(bounded.omitted.length>0)
})
test('delivery includes earlier public Lead result before late acknowledgement, never addressed handoffs or peer messages', () => {
  const s=snapshot();s.messages=[
    {id:'delivery',authorId:'lead',authorType:'agent',campTurnId:'turn',sourceAgentRunId:'lead-run',sequence:1,addressedAgentIds:[]},
    {id:'handoff',authorId:'lead',authorType:'agent',campTurnId:'turn',sourceAgentRunId:'lead-run',sequence:2,addressedAgentIds:['peer']},
    {id:'foreign',authorId:'lead',authorType:'agent',campTurnId:'other',sourceAgentRunId:'lead-run',sequence:3,addressedAgentIds:[]}
  ]
  assert.deepEqual(buildEvaluationContext(s,boundary).deliveryMessageIds,['delivery'])
})
