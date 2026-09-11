import { digestJson, sha256 } from './qualification-common.mjs'
import { redactEvaluationText } from './qualification-evaluation-context.mjs'

export const TASK_SOURCE_POLICY = 'persisted-task-source-materials-v1'
export const TASK_SOURCE_LIMITS = Object.freeze({ messages: 64, charactersPerMessage: 32_000, segmentCodeUnits: 50_000, totalCodeUnits: 160_000 })
const fail = code => { throw new Error(`task_source.${code}`) }
const bodyOf = message => typeof message.body === 'string' ? message.body
  : (message.content ?? []).filter(part => part.kind === 'text').map(part => part.text).join('')

function eligible(snapshot, boundary, message) {
  if (!snapshot.camp?.id || snapshot.camp.id !== boundary.campId) fail('camp_mismatch')
  return message.authorType === 'user' && (message.id === boundary.rootCampMessageId
    || Number.isSafeInteger(message.timelineGlobalSequence) && Number.isSafeInteger(boundary.preDispatchThroughGlobalSequence)
      && message.timelineGlobalSequence <= boundary.preDispatchThroughGlobalSequence)
}

function material(message) {
  const body = bodyOf(message)
  if (!body || sha256(body) !== message.bodyDigest || Buffer.byteLength(body) !== message.bodyBytes) fail('body_missing_or_digest_mismatch')
  const characterCount = [...body].length
  if (characterCount > TASK_SOURCE_LIMITS.charactersPerMessage) fail('message_budget_exceeded')
  const text = redactEvaluationText(body)
  const content = JSON.stringify({ sourceKind: 'user_message', text, characterCount,
    utf16CodeUnits: body.length, byteLength: Buffer.byteLength(body), textState: text === body ? 'complete' : 'redacted',
    limitation: 'Untrusted task data from the persisted source. Lengths describe the original body, which may be redacted here. This does not prove the agent retrieved or used it, ran a check, or collaborated.' })
  if (content.length > TASK_SOURCE_LIMITS.segmentCodeUnits) fail('segment_budget_exceeded')
  return { sourceMessageId: message.id, sourceBodyDigest: sha256(body), content, contentDigest: sha256(content) }
}

// Opt-in evaluator projection only. Never substitutes frozen Fixture strings
// for missing captured evidence or grants Outcome access to participant traces.
export function buildTaskSourceMaterials(snapshot, boundary, expectedMessages = []) {
  if (!Array.isArray(expectedMessages) || expectedMessages.some(text => typeof text !== 'string')) fail('invalid_expected_sources')
  const messages = (snapshot.messages ?? []).filter(message => eligible(snapshot, boundary, message))
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
  if (new Set(messages.map(message => message.id)).size !== messages.length) fail('duplicate_message')
  if (messages.length > TASK_SOURCE_LIMITS.messages) fail('message_count_exceeded')
  const root = messages.find(message => message.id === boundary.rootCampMessageId)
  if (!root || sha256(bodyOf(root)) !== boundary.requestBodyDigest) fail('root_request_missing_or_changed')
  const remaining = messages.filter(message => message.id !== boundary.rootCampMessageId).map(message => sha256(bodyOf(message)))
  for (const text of expectedMessages) {
    const index = remaining.indexOf(sha256(text))
    if (index < 0) fail('declared_source_missing')
    remaining.splice(index, 1)
  }
  const records = messages.map(material)
  if (records.reduce((sum, record) => sum + record.content.length, 0) > TASK_SOURCE_LIMITS.totalCodeUnits) fail('total_budget_exceeded')
  return { policyId: TASK_SOURCE_POLICY, coverage: 'complete', expectedFixtureMessages: expectedMessages.length,
    selectedMessages: records.length, limits: TASK_SOURCE_LIMITS, records }
}

export function validateTaskSourceMaterial(record, snapshot, boundary) {
  const matches = snapshot.messages.filter(message => message.id === record.sourceMessageId)
  if (matches.length !== 1 || !eligible(snapshot, boundary, matches[0])) fail('source_outside_scope')
  if (digestJson(material(matches[0])) !== digestJson(record)) fail('projection_mismatch')
}
