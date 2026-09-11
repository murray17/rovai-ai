import assert from 'node:assert/strict'
import test from 'node:test'
import { sha256 } from './qualification-common.mjs'
import { buildTaskSourceMaterials, validateTaskSourceMaterial } from './qualification-task-source-materials.mjs'
const message=(id,text,sequence=1,authorType='user')=>({id,authorType,sequence,timelineGlobalSequence:sequence,bodyDigest:sha256(text),bodyBytes:Buffer.byteLength(text),content:[{kind:'text',text}]})
function fixture(text='材料🙂\n最终条件：ORBIT-74') {
  const source=message('source',text),root=message('root','根据材料生成报告',3)
  return {text,snapshot:{camp:{id:'camp'},messages:[source,root,message('member','PARTICIPANT_CANARY',2,'agent'),message('later','LATER_CANARY',4)]},boundary:{campId:'camp',rootCampMessageId:'root',requestBodyDigest:root.bodyDigest,preDispatchThroughGlobalSequence:2}}
}

test('source selection retains original Unicode lengths and excludes participant/late messages',()=>{
 const {text,snapshot,boundary}=fixture();const result=buildTaskSourceMaterials(snapshot,boundary,[text])
 assert.equal(result.selectedMessages,2)
 assert.equal(result.expectedFixtureMessages,1)
 const body=JSON.parse(result.records[0].content)
 assert.equal(body.text,text);assert.equal(body.characterCount,[...text].length);assert.equal(body.utf16CodeUnits,text.length);assert.equal(body.byteLength,Buffer.byteLength(text))
 assert.doesNotMatch(JSON.stringify(result),/PARTICIPANT_CANARY|LATER_CANARY/)
 for(const record of result.records)validateTaskSourceMaterial(record,snapshot,boundary)
})

test('missing captured source cannot be filled from the known Fixture answer',()=>{
 const {text,snapshot,boundary}=fixture();snapshot.messages=snapshot.messages.filter(m=>m.id!=='source')
 assert.throws(()=>buildTaskSourceMaterials(snapshot,boundary,[text]),/declared_source_missing/)
})

test('changed bytes, root binding, foreign Camp and duplicate identities fail before judging',()=>{
 for(const [mutate,pattern] of [
  [s=>s.messages[0].content[0].text='tampered',/declared_source_missing|digest_mismatch/],
  [s=>s.messages[0].bodyBytes++,/digest_mismatch/],
  [s=>s.messages[1].content[0].text='different request',/root_request/],
  [s=>s.camp.id='foreign',/camp_mismatch/],
  [s=>s.messages.push({...s.messages[0]}),/duplicate_message/]
 ]) {const {text,snapshot,boundary}=fixture();mutate(snapshot);assert.throws(()=>buildTaskSourceMaterials(snapshot,boundary,[text]),pattern)}
})

test('redacted evidence preserves original lengths and cannot silently replace its source',()=>{
 const {text,snapshot,boundary}=fixture('api_key=fixture-sensitive-value 原文🙂');const result=buildTaskSourceMaterials(snapshot,boundary,[text]);const item=JSON.parse(result.records[0].content)
 assert.equal(item.textState,'redacted');assert.doesNotMatch(item.text,/fixture-sensitive-value/);assert.equal(item.characterCount,[...text].length)
 result.records[0].content='altered';assert.throws(()=>validateTaskSourceMaterial(result.records[0],snapshot,boundary),/projection_mismatch/)
})

test('source size and total budgets reject explicitly instead of dropping a tail',()=>{
 const large=fixture('x'.repeat(32_001));assert.throws(()=>buildTaskSourceMaterials(large.snapshot,large.boundary,[large.text]),/message_budget/)
 const f=fixture();f.boundary.preDispatchThroughGlobalSequence=100
 f.snapshot.messages=[...Array.from({length:6},(_,i)=>message('s'+i,'x'.repeat(30_000),i)),f.snapshot.messages[1]]
 assert.throws(()=>buildTaskSourceMaterials(f.snapshot,f.boundary),/total_budget/)
 f.snapshot.messages=[...Array.from({length:65},(_,i)=>message('s'+i,'x',i)),f.snapshot.messages.at(-1)]
 assert.throws(()=>buildTaskSourceMaterials(f.snapshot,f.boundary),/message_count/)
})
