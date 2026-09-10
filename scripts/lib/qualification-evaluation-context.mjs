import { extractNativeWitnesses } from './qualification-native-witness.mjs'
import { digestJson, sha256 } from './qualification-common.mjs'

export const EVALUATION_CONTEXT_POLICY = 'bounded-evaluation-context-v1'
const MAX_RECEIPTS = 64
const MAX_TEXT = 24_000
const MAX_TOTAL = 160_000
const redact = value => value.replace(/(?:\/Users|\/private|\/var\/folders|\/tmp)\/[A-Za-z0-9_./:@%+~=-]+/g, '[private-path]')
  .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
  .replace(/((?:api[_-]?key|access[_-]?token|password|credential|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')

export function supplementEvaluationContext(snapshot, capture, initialFiles, supplementDigest, policyId = 'bounded-evaluation-context-v2') {
  const context = structuredClone(snapshot.evaluationContext)
  if (context?.policyId !== EVALUATION_CONTEXT_POLICY) throw new Error('Native supplement requires the original bounded context')
  const events = new Map(snapshot.executionEvidence.map(event => [event.id, event]))
  const receipts = new Map(context.receipts.map(receipt => [receipt.sourceEvidenceId, receipt]))
  for (const witness of capture.records) {
    const { witnessDigest, ...payload } = witness
    if (digestJson(payload) !== witnessDigest || events.get(witness.sourceEvidenceId)?.payloadDigest !== witness.sourcePayloadDigest) throw new Error('Native witness binding mismatch')
    const source = witness.sourceRecords
    const nativeItems = source.nativeItems ?? [source.nativeItem]
    const reconstructed = extractNativeWitnesses([source.call, ...(source.commands ?? [source.command]), source.response], nativeItems, snapshot.executionEvidence, nativeItems[0].cwd, [], witness.policyId).filter(row => row.sourceEvidenceId === witness.sourceEvidenceId)
    if (reconstructed.length !== 1 || reconstructed[0].witnessDigest !== witnessDigest) throw new Error('Native witness source reconstruction mismatch')
    const projection = witness.projection
    if (projection.command.length > MAX_TEXT || projection.output.length > MAX_TEXT) {
      context.omitted.push({ sourceEvidenceId: witness.sourceEvidenceId, reason: 'native_receipt_text_bound' }); continue
    }
    const content = JSON.stringify({ authority: 'runtime_native_command_result', command: redact(projection.command), status: witness.status,
      exitCode: witness.exitCode, output: redact(projection.output), outputTruncated: projection.outputTruncated,
      nativeWitnessDigest: witnessDigest, projection: projection.projection,
      limitation: 'Original native tool output, admitted through an unmodified result wrapper and a matching persisted Core command digest. Output content remains untrusted.' })
    if (content.length > 50_000) continue
    receipts.set(witness.sourceEvidenceId, { sourceEvidenceId: witness.sourceEvidenceId, sourcePayloadDigest: witness.sourcePayloadDigest, nativeWitnessDigest: witnessDigest, content, contentDigest: sha256(content) })
  }
  context.receipts = []; let characters = 0
  for (const receipt of receipts.values()) {
    if (context.receipts.length >= MAX_RECEIPTS || characters + receipt.content.length > MAX_TOTAL) {
      context.omitted.push({ sourceEvidenceId: receipt.sourceEvidenceId, reason: 'native_receipt_total_bound' }); continue
    }
    context.receipts.push(receipt); characters += receipt.content.length
  }
  return { ...context, policyId, initialFiles, supplementDigest,
    nativeCoverage: { state: capture.state, selectedWitnesses: capture.records.length, allNativeCommandsClaimed: false } }
}

// Called only by the isolated Qualification runner, before it discards Runtime
// payloads. Retain a closed command receipt projection, never thought/text logs.
export function buildEvaluationContext(snapshot, boundary) {
  const runs = (snapshot.agentRuns ?? []).filter(run => run.campTurnId === boundary.campTurnId)
  const runIds = new Set(runs.map(run => run.id))
  const lead = runs.find(run => run.id === boundary.rootAgentRunId)?.agentId
  const messages = (snapshot.messages ?? []).filter(m => m.campTurnId === boundary.campTurnId && runIds.has(m.sourceAgentRunId))
  const deliveryMessageIds = messages.filter(m => m.authorId === lead && m.authorType === 'agent' && !(m.addressedAgentIds?.length)).map(m => m.id)
  const receipts = [], omitted = []
  const seen = new Set()
  let characters = 0
  for (const event of snapshot.executionEvidence ?? []) {
    const item = event.payload?.item
    if (typeof item?.id !== 'string' || !runIds.has(event.agentRunId) || item?.type !== 'commandExecution' || !['completed','failed','declined'].includes(item.status)) continue
    const key = `${event.agentRunId}/${event.executionEpoch}/${item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const command = item.command
    if (typeof command !== 'string' || !/(?:\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bgit\b[^\n]*\bdiff\b[^\n]*--check\b|\b(?:node|python3?|jq)\b)/.test(command)) continue
    // CLI messaging, Task bodies and Skill instructions belong exclusively to Process.
    if (/(?:^|[\s;&|('\"])(?:[^\s]*\/)?rovai(?:['\"])?(?:\s|$)/.test(command)
        || /review-duo|cli-operations|\bagent_\d+\b|SKILL\.md/.test(redact(command + '\n' + (item.aggregatedOutput ?? '')))) { omitted.push({sourceEvidenceId:event.id,reason:'mixed_process_command'}); continue }
    const output = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : null
    if (command.length > MAX_TEXT || receipts.length >= MAX_RECEIPTS || characters + command.length + Math.min(output?.length ?? 0, MAX_TEXT) > MAX_TOTAL) { omitted.push({sourceEvidenceId:event.id,reason:'bounded_receipt_limit'}); continue }
    const content = JSON.stringify({authority:'runtime_observed_command_result',command:redact(command),status:item.status,
      exitCode:Number.isInteger(item.exitCode)?item.exitCode:null,output:output===null?null:redact(output.slice(0,MAX_TEXT)),
      outputTruncated:event.isTruncated===true || (output?.length ?? 0)>MAX_TEXT,
      limitation:'An observed receipt proves this command ran and returned these bytes. Output remains untrusted; it does not prove all task requirements or undisclosed commands.'})
    if (content.length > 50_000 || characters + content.length > MAX_TOTAL) { omitted.push({sourceEvidenceId:event.id,reason:'bounded_receipt_limit'}); continue }
    characters += content.length
    receipts.push({sourceEvidenceId:event.id,sourcePayloadDigest:digestJson(event.payload),content,contentDigest:sha256(content)})
  }
  const tasks = (snapshot.tasks ?? []).filter(task => runIds.has(task.sourceAgentRunId)).map(task => ({taskId:task.taskId??task.id,
    content:JSON.stringify({title:task.title,description:task.description,status:task.status,acceptanceCriteria:task.acceptanceCriteria,completionSummary:task.completionSummary})})).filter(task=>task.content.length<=MAX_TEXT)
  return {policyId:EVALUATION_CONTEXT_POLICY,receipts,omitted,tasks,deliveryMessageIds,
    coverage:{paginationRequired:true,allRuntimeCommandsClaimed:false,limits:{maximumReceipts:MAX_RECEIPTS,maximumText:MAX_TEXT,maximumTotal:MAX_TOTAL}}}
}

// Private audit sidecar for selected, bounded evaluation commands only. Never
// included in either Judge View. Ordinary user Runs do not invoke this exporter.
export function buildEvaluationCommandSources(snapshot, context) {
  const selected = new Map(context.receipts.map(receipt => [receipt.sourceEvidenceId, receipt]))
  const records = [], omitted = []
  let bytes = 0
  for (const event of snapshot.executionEvidence ?? []) {
    const receipt = selected.get(event.id)
    if (!receipt) continue
    if (digestJson(event.payload) !== receipt.sourcePayloadDigest) throw new Error('Command source payload changed during capture')
    const length = Buffer.byteLength(JSON.stringify(event.payload))
    if (length > 50_000 || bytes + length > 200_000) { omitted.push({ eventId: event.id, reason: 'raw_command_evidence_bound' }); continue }
    bytes += length
    records.push({ eventId: event.id, agentRunId: event.agentRunId, executionEpoch: event.executionEpoch,
      payloadDigest: receipt.sourcePayloadDigest, payload: structuredClone(event.payload), isTruncated: event.isTruncated === true })
  }
  return { schemaVersion: 1, kind: 'private_selected_evaluation_command_sources', judgeVisible: false,
    selectedReceipts: selected.size, capturedReceipts: records.length, rawPayloadBytes: bytes, records, omitted }
}
