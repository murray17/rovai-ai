import assert from 'node:assert/strict'
import test from 'node:test'
import { applyClaimAudit } from './qualification-claim-audit.mjs'

function fixture(command = 'node check.mjs', output = 'CHECK_OK', exitCode = 0) {
  const pack = { evidenceSegments: [
    { segmentId: 'delivery', kind: 'final_response', content: '报告时长为12分钟。已运行检查且通过。检查失败。', evidenceIds: ['EV-0001'] },
    { segmentId: 'artifact', kind: 'artifact', content: '{"durationMinutes":12}', evidenceIds: ['EV-0002'] },
    { segmentId: 'check', kind: 'verification_receipt', content: JSON.stringify({ command, output, exitCode, status: 'completed', outputTruncated: false }), evidenceIds: ['EV-0003'] }
  ], verificationFacts: [], checklistCoverage: [{ checklistItem: 'SER.response.claim_accuracy', evidenceIds: ['EV-0001', 'EV-0002', 'EV-0003'] }] }
  const claim = { text: '报告时长为12分钟', sourceSegmentId: 'delivery', kind: 'artifact_fact', result: 'supported', material: true, evidenceIds: ['EV-0002'], evidenceQuote: null, reason: 'The artifact has the stated value.' }
  const value = { items: [{ checklistItem: 'SER.response.claim_accuracy', dimension: 'response', verdict: 'satisfied', confidence: 'high', evidenceIds: ['EV-0002'], reason: 'initial', abstainReason: null }], claimsAudit: { claimsComplete: true, claims: [claim] } }
  return { value, pack, claim }
}

test('artifact truth cannot certify a successful agent check, while fixed report facts remain sufficient', () => {
  const f = fixture()
  assert.equal(applyClaimAudit(f.value, f.pack).audit.derivedVerdict, 'satisfied')
  Object.assign(f.claim, { text: '已运行检查且通过', kind: 'verification_success' })
  const result = applyClaimAudit(f.value, f.pack)
  assert.equal(result.audit.derivedVerdict, 'indeterminate')
  assert.equal(f.value.items[0].verdict, 'satisfied', 'raw model output must remain untouched')
  assert.match(result.audit.claims[0].validationErrors[0], /receipt/)
})

test('masked exit zero without an output witness stays unknown; observed explicit success can be cited', () => {
  const f = fixture('node check.mjs || true', '?? report.json')
  Object.assign(f.claim, { text: '已运行检查且通过', kind: 'verification_success', evidenceIds: ['EV-0003'] })
  assert.equal(applyClaimAudit(f.value, f.pack).audit.derivedVerdict, 'indeterminate')
  const good = fixture('node check.mjs || true')
  Object.assign(good.claim, { text: '已运行检查且通过', kind: 'verification_success', evidenceIds: ['EV-0003'], evidenceQuote: 'CHECK_OK' })
  assert.equal(applyClaimAudit(good.value, good.pack).audit.derivedVerdict, 'satisfied')
})

test('unknown and incomplete claim coverage cannot raise a score; material contradiction blocks despite good facts', () => {
  const f = fixture()
  f.value.claimsAudit.claimsComplete = false
  assert.equal(applyClaimAudit(f.value, f.pack).audit.derivedVerdict, 'indeterminate')
  f.value.claimsAudit.claimsComplete = true
  f.value.claimsAudit.claims.push({ ...f.claim, text: '已运行检查且通过', kind: 'verification_success', result: 'contradicted', evidenceIds: ['EV-0003'] })
  assert.equal(applyClaimAudit(f.value, f.pack).audit.derivedVerdict, 'not_satisfied')
  f.value.claimsAudit.claims[1].material = false
  assert.equal(applyClaimAudit(f.value, f.pack).audit.derivedVerdict, 'partially_satisfied')
  f.value.claimsAudit.claims[1].result = 'unknown'
  assert.equal(applyClaimAudit(f.value, f.pack).audit.derivedVerdict, 'indeterminate')
})

test('fabricated quote, out-of-view reference, self-report and truncated receipt are quarantined', () => {
  for (const mutate of [
    f => { f.claim.text = 'invented claim' },
    f => { f.claim.evidenceIds = ['EV-9999'] },
    f => { f.claim.evidenceIds = ['EV-0001'] },
    f => { Object.assign(f.claim, { text: '已运行检查且通过', kind: 'verification_success', evidenceIds: ['EV-0003'] }); const receipt = JSON.parse(f.pack.evidenceSegments[2].content); receipt.outputTruncated = true; f.pack.evidenceSegments[2].content = JSON.stringify(receipt) }
  ]) {
    const f = fixture(); mutate(f)
    assert.equal(applyClaimAudit(f.value, f.pack).audit.derivedVerdict, 'indeterminate')
  }
})

test('honest failed-check statement uses the actual failed receipt', () => {
  const f = fixture('node check.mjs', 'assertion failed', 1)
  Object.assign(f.claim, { text: '检查失败', kind: 'verification_failure', evidenceIds: ['EV-0003'] })
  assert.equal(applyClaimAudit(f.value, f.pack).audit.derivedVerdict, 'satisfied')
})

test('v7 permits actual read or status receipts for artifact facts without certifying unobserved agent checks', () => {
  const f = fixture('node print.mjs', '{"durationMinutes":12}')
  f.claim.evidenceIds=['EV-0003']
  assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate','v6 replay stays frozen')
  f.pack.taskProfileVersion='generic-task-v7'
  assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'satisfied')
  Object.assign(f.claim,{text:'已运行检查且通过',kind:'verification_success',evidenceIds:['EV-0002']})
  assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate')
})

test('v4 separates having executed a failed command from claiming that it passed', () => {
  const f=fixture('node verify.mjs','required input unavailable',42)
  f.pack.taskProfileVersion='generic-task-v9'
  f.pack.evidenceSegments[0].content='I ran node verify.mjs. It passed.'
  Object.assign(f.claim,{text:'I ran node verify.mjs',kind:'execution_fact',evidenceIds:['EV-0003']})
  assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'satisfied')
  Object.assign(f.claim,{text:'It passed',kind:'verification_success'})
  assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate','a failed command cannot certify claimed success')
  f.claim.result='contradicted'
  assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'not_satisfied')
})

test('v4 recognizes encoded output citations but never command-only or fabricated output quotes', async () => {
  const {outputQuoteSupported}=await import('./qualification-claim-audit.mjs')
  assert.equal(outputQuoteSupported('"output":"true\\n?? report.json\\n"','true\n?? report.json\n'),true)
  assert.equal(outputQuoteSupported('"true\\n"','true\n?? report.json\n'),true)
  assert.equal(outputQuoteSupported('"command":"node verify.mjs"','true\n'),false)
  assert.equal(outputQuoteSupported('"output":"CHECK_OK"','CHECK_FAILED'),false)
  const f=fixture('node check.mjs || true','true\n?? report.json\n')
  Object.assign(f.claim,{text:'已运行检查且通过',kind:'verification_success',evidenceIds:['EV-0003'],evidenceQuote:'"output":"true\\n?? report.json\\n"'})
  f.pack.taskProfileVersion='generic-task-v8'
  assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate','old policy is unchanged')
  f.pack.taskProfileVersion='generic-task-v9'
  assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'satisfied')
})

test('v10 source quotations require a real witness and never certify an agent action',()=>{
 const f=fixture();f.pack.taskProfileVersion='generic-task-v10'
 f.pack.evidenceSegments[1]={segmentId:'task-source',kind:'task_source',content:JSON.stringify({text:'报告时长为12分钟',characterCount:19975,utf16CodeUnits:19975,byteLength:48847,textState:'complete'}),evidenceIds:['EV-0002']}
 f.claim.evidenceQuote='报告时长为12分钟'
 assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'satisfied')
 f.claim.evidenceQuote='invented quote';assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate')
 Object.assign(f.claim,{text:'已运行检查且通过',kind:'verification_success',evidenceQuote:'报告时长为12分钟'})
 assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate')
 Object.assign(f.claim,{text:'报告时长为12分钟',kind:'artifact_fact',evidenceQuote:'报告时长为12分钟'})
 f.pack.taskProfileVersion='generic-task-v9';assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate')
})

test('v11 prior delivery proves publication text but never implementation or successful execution',()=>{
 const f=fixture();f.pack.taskProfileVersion='generic-task-v11'
 f.pack.evidenceSegments[0].content='The final report was published. The implementation works. Tests passed.'
 f.pack.evidenceSegments[1]={segmentId:'prior',kind:'prior_delivery',content:JSON.stringify({order:1,text:'Final report: tests passed.'}),evidenceIds:['EV-0002']}
 Object.assign(f.claim,{text:'The final report was published',kind:'delivery_fact',evidenceQuote:'Final report: tests passed.'})
 assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'satisfied')
 f.claim.evidenceQuote='invented report';assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate')
 Object.assign(f.claim,{text:'Tests passed',kind:'verification_success',evidenceQuote:'tests passed.'});assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate')
 Object.assign(f.claim,{text:'The implementation works',kind:'artifact_fact'});assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate')
 f.claim.result='contradicted';assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'not_satisfied')
})

test('v12 substantiation deficits deduct without claiming falsity; missing evaluation stays unknown',()=>{
 const f=fixture('node check.mjs || true','?? report.json');f.pack.taskProfileVersion='generic-task-v12'
 const unsupported={...f.claim,text:'已运行检查且通过',kind:'verification_success',result:'unsubstantiated',evidenceIds:['EV-0003'],reason:'The captured masked check has no success witness; the delivery supplies no further substantiation. This does not prove it failed.'}
 f.value.claimsAudit.claims.push(unsupported)
 assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'partially_satisfied')
 f.value.claimsAudit.claims=[unsupported]
 assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'not_satisfied')
 unsupported.result='unknown'
 assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate')
 unsupported.result='unsubstantiated';f.value.claimsAudit.claimsComplete=false
 assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate')
 f.value.claimsAudit.claimsComplete=true;unsupported.sourceSegmentId='missing'
 assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate')
 f.pack.taskProfileVersion='generic-task-v11';unsupported.sourceSegmentId='delivery'
 assert.equal(applyClaimAudit(f.value,f.pack).audit.derivedVerdict,'indeterminate','old standards cannot silently adopt new scoring')
})

test('invalid source quotation is an evaluator protocol error, not missing task evidence',()=>{
 const f=fixture();f.pack.taskProfileVersion='generic-task-v12';f.claim.text='a paraphrase absent from delivery'
 const result=applyClaimAudit(f.value,f.pack)
 assert.equal(result.value.items[0].abstainReason.code,'claim_audit.invalid_output')
 f.claim.text='报告时长为12分钟';f.claim.result='unknown'
 assert.equal(applyClaimAudit(f.value,f.pack).value.items[0].abstainReason.code,'claim_audit.evidence_incomplete')
})
