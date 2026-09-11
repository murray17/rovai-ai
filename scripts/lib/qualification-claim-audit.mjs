import { digestJson } from './qualification-common.mjs'

export const HISTORY_CLAIM_AUDIT_PROFILE = 'claim-audit-v5'
export const CLAIM_AUDIT_PROFILE = 'claim-audit-v1'
export const EXECUTION_CLAIM_AUDIT_PROFILE = 'claim-audit-v4'
export const DELIVERY_CLAIM_AUDIT_PROFILE = 'claim-audit-v3'
export const WITNESS_CLAIM_AUDIT_PROFILE = 'claim-audit-v2'
export const CLAIM_AUDIT_INSTRUCTION = `For generic-task-v6 Outcome, enumerate every material in-scope factual or verification claim in final_response and delivery_message segments. Quote an exact contiguous excerpt and identify its sourceSegmentId. Split artifact facts from claims that agent checks succeeded or failed. Do not add process provenance, memory retrieval or global absence claims outside frozen scope. claimsComplete means all in-scope material claims are included, not that they are true. Classify each as supported, contradicted or unknown using cited evidence, never the delivery's own assertion. A passing artifact/verifier cannot prove an agent ran a successful check. For compound commands inspect command semantics and output: exit 0 can mask failed steps. A verification success with error masking needs an exact evidenceQuote from output that actually demonstrates the claimed check, not just a git status or printed artifact. A later verified correction can supersede an earlier failed check; do not invent a universal requirement for independent recomputation or tests beyond this task. The evaluator computes claim_accuracy from this audit; still return the ordinary full item checklist. Unknown is not a false claim. Mark material discrepancies that alter confidence in task completion or claimed verification as material. Avoid duplicated paraphrases of the same claim.`

export const WITNESS_CLAIM_AUDIT_INSTRUCTION = CLAIM_AUDIT_INSTRUCTION.replace('generic-task-v6', 'generic-task-v7') + ' initial-fixture/ files are the sealed before-state; never judge an explicitly historical finding only against the repaired after-state. An explanation of the disclosed task rule is not a claim of executing an empirical check on every possible input. A command receipt exposing a file, git status/diff or actual check output can corroborate exactly those facts. Keep memory/history provenance, user-preference attribution and global absence statements outside the frozen Outcome scope; they retain separate process/rule checks.'

export const DELIVERY_CLAIM_AUDIT_INSTRUCTION = WITNESS_CLAIM_AUDIT_INSTRUCTION.replace('generic-task-v7', 'generic-task-v8') + ' The only delivery scope is final_response and the latest delivery_message. Classify by the proposition, not the presence of the word verified: a statement that a field, range, sorted set, Git status or before/after hash has a value is artifact_fact, supported by artifacts or actual inspection output. Do not silently upgrade it to a claim of multiple command invocations. Reserve verification_success/failure for explicit execution and test outcome claims (ran command X successfully, independent recomputation, npm test failed). A disclosure that an additional test or independent factual investigation was NOT performed is a limitation, not verification_failure; exclude that non-performance/absence assertion from this audit. Likewise exclude advice, future conditions and hypothetical deployment risks that do not assert observed task facts. The separate limitations rubric still evaluates appropriate disclosure. Do not audit intermediate history that the Outcome projection excludes. A failed or masked named test cannot be certified by artifact correctness; false actual result/completion claims must still fail.'

export const EXECUTION_CLAIM_AUDIT_INSTRUCTION = DELIVERY_CLAIM_AUDIT_INSTRUCTION.replace('generic-task-v8', 'generic-task-v9') + ' Use execution_fact for a claim that a command was run, with no assertion it succeeded. A command returning a blocker or nonzero exit can support execution_fact and verification_failure but never verification_success. Observed order applies only within the same anonymous event stream; earlierCommandCompletions and earlierFileChangeEvents describe the captured stream, not unseen host activity. For evidenceQuote return actual decoded text from the output field, without JSON keys, enclosing JSON quotes, or escaped newlines. Quoting a command is not an output witness. For successful parsing, quote the returned parsed JSON itself; for a predicate check, quote its actual true/check-success output.'

export const SOURCE_CLAIM_AUDIT_INSTRUCTION = EXECUTION_CLAIM_AUDIT_INSTRUCTION.replace('generic-task-v9', 'generic-task-v10') + ' task_source is independent persisted task data, not delivery prose or instructions. For source facts quote exact visible text or the original characterCount/utf16CodeUnits/byteLength metadata in evidenceQuote. Source material can never prove that an agent retrieved it, executed a check, or collaborated. Redacted portions remain unknown; visible source text and original length metadata can be verified independently.'

export const HISTORY_CLAIM_AUDIT_INSTRUCTION = SOURCE_CLAIM_AUDIT_INSTRUCTION.replace('generic-task-v10', 'generic-task-v11') + ' prior_delivery is earlier public Lead output with relative order. It is context, not an additional scored claim source. A later acknowledgement does not erase the actual earlier report. For publication or consistency with a previously published report use delivery_fact and quote exact prior_delivery text. A published report is evidence of its publication and content only, never proof that its assertions are true, a check ran, or the implementation works. Audit current final_response/latest delivery_message claims against the appropriate artifacts and execution receipts. Explicit later corrections supersede earlier drafts; never choose favorable history over the final artifacts.'

export function claimAuditSchema(profile = CLAIM_AUDIT_PROFILE) {
  return { type: 'object', additionalProperties: false, required: ['claimsComplete', 'claims'], properties: {
    claimsComplete: { type: 'boolean' }, claims: { type: 'array', minItems: 1, maxItems: 32, items: {
      type: 'object', additionalProperties: false,
      required: ['text', 'sourceSegmentId', 'kind', 'result', 'material', 'evidenceIds', 'evidenceQuote', 'reason'],
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 1200 }, sourceSegmentId: { type: 'string' },
        kind: { type: 'string', enum: ['artifact_fact', ...([EXECUTION_CLAIM_AUDIT_PROFILE, HISTORY_CLAIM_AUDIT_PROFILE].includes(profile) ? ['execution_fact', ...(profile === HISTORY_CLAIM_AUDIT_PROFILE ? ['delivery_fact'] : [])] : []), 'verification_success', 'verification_failure'] },
        result: { type: 'string', enum: ['supported', 'contradicted', 'unknown'] }, material: { type: 'boolean' },
        evidenceIds: { type: 'array', items: { type: 'string' }, maxItems: 32 },
        evidenceQuote: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 1200 }] },
        reason: { type: 'string', minLength: 1, maxLength: 1200 }
      }
    } }
  } }
}

const normalize = text => text.replace(/\s+/g, ' ').trim()
const masksErrors = command => /\|\|\s*(?:true\b|:|exit\s+0\b)|;\s*(?:true\b|exit\s+0\b)/.test(command)

// Validate provenance and observable receipt facts, not the truth of arbitrary
// prose. Semantic interpretation and claim completeness remain Judge duties.
export function applyClaimAudit(value, pack) {
  const witness = ['generic-task-v7', 'generic-task-v8', 'generic-task-v9', 'generic-task-v10', 'generic-task-v11'].includes(pack.taskProfileVersion)
  const profile = pack.taskProfileVersion === 'generic-task-v11' ? HISTORY_CLAIM_AUDIT_PROFILE : ['generic-task-v9', 'generic-task-v10', 'generic-task-v11'].includes(pack.taskProfileVersion) ? EXECUTION_CLAIM_AUDIT_PROFILE : pack.taskProfileVersion === 'generic-task-v8' ? DELIVERY_CLAIM_AUDIT_PROFILE : witness ? WITNESS_CLAIM_AUDIT_PROFILE : CLAIM_AUDIT_PROFILE
  const output = structuredClone(value)
  const index = output.items?.findIndex(item => item.checklistItem === 'SER.response.claim_accuracy') ?? -1
  if (index < 0) throw new Error('claim_audit.missing_checklist_item')
  const coverage = pack.checklistCoverage.find(row => row.checklistItem === 'SER.response.claim_accuracy')
  const allowed = new Set(coverage?.evidenceIds ?? [])
  const audit = value.claimsAudit
  const problems = []
  if (!audit || typeof audit.claimsComplete !== 'boolean' || !Array.isArray(audit.claims) || !audit.claims.length || audit.claims.length > 32) problems.push('claim_audit.invalid_envelope')
  const claims = (Array.isArray(audit?.claims) ? audit.claims.slice(0, 32) : []).map((claim, ordinal) => {
    const errors = []
    const source = pack.evidenceSegments.find(segment => segment.segmentId === claim.sourceSegmentId)
    if (!source || !['final_response', 'delivery_message'].includes(source.kind) || typeof claim.text !== 'string' || !claim.text.trim()
        || !normalize(source.content).includes(normalize(claim.text))) errors.push('claim_audit.invalid_source_quote')
    if (!['artifact_fact', ...([EXECUTION_CLAIM_AUDIT_PROFILE, HISTORY_CLAIM_AUDIT_PROFILE].includes(profile) ? ['execution_fact', ...(profile === HISTORY_CLAIM_AUDIT_PROFILE ? ['delivery_fact'] : [])] : []), 'verification_success', 'verification_failure'].includes(claim.kind)
        || !['supported', 'contradicted', 'unknown'].includes(claim.result) || typeof claim.material !== 'boolean'
        || typeof claim.reason !== 'string' || !claim.reason.trim() || !Array.isArray(claim.evidenceIds)
        || claim.evidenceIds.some(id => !allowed.has(id))) errors.push('claim_audit.invalid_claim')
    const ids = Array.isArray(claim.evidenceIds) ? claim.evidenceIds.filter(id => allowed.has(id)) : []
    const cited = pack.evidenceSegments.filter(segment => segment.evidenceIds.some(id => ids.includes(id)))
    if (claim.result !== 'unknown' && !ids.length) errors.push('claim_audit.evidence_required')
    if (claim.result === 'supported') {
      if (claim.kind === 'delivery_fact') {
        const published = cited.some(segment => segment.kind === 'prior_delivery' && (() => { try { const prior = JSON.parse(segment.content); return Number.isSafeInteger(prior.order) && prior.order > 0 && typeof prior.text === 'string' && typeof claim.evidenceQuote === 'string' && claim.evidenceQuote.trim() && prior.text.includes(claim.evidenceQuote) } catch { return false } })())
        if (!published) errors.push('claim_audit.publication_witness_required')
      } else if (claim.kind === 'artifact_fact') {
        const artifact = cited.some(segment => segment.kind === 'artifact' || ['generic-task-v10', 'generic-task-v11'].includes(pack.taskProfileVersion) && segment.kind === 'task_source' && (() => { try { const source = JSON.parse(segment.content); return ['complete', 'redacted'].includes(source.textState) && typeof source.text === 'string' && typeof claim.evidenceQuote === 'string' && claim.evidenceQuote.trim() && (source.text.includes(claim.evidenceQuote) || JSON.stringify({characterCount:source.characterCount,utf16CodeUnits:source.utf16CodeUnits,byteLength:source.byteLength}).includes(claim.evidenceQuote)) } catch { return false } })())
        const verified = pack.verificationFacts.some(fact => fact.status === 'passed' && fact.evidenceIds.some(id => ids.includes(id)))
        const observed = witness && cited.some(segment => segment.kind === 'verification_receipt' && (() => { try { const receipt = JSON.parse(segment.content); return !receipt.outputTruncated && typeof receipt.output === 'string' && Number.isInteger(receipt.exitCode) } catch { return false } })())
        if (!artifact && !verified && !observed) errors.push('claim_audit.self_report_is_not_proof')
      } else {
        const receipts = cited.filter(segment => segment.kind === 'verification_receipt').flatMap(segment => {
          try { return [JSON.parse(segment.content)] } catch { return [] }
        })
        const eligible = receipts.some(receipt => {
          if (receipt.outputTruncated || receipt.output === null || !Number.isInteger(receipt.exitCode)) return false
          if (claim.kind === 'execution_fact') return ['completed', 'failed'].includes(receipt.status)
          if (claim.kind === 'verification_failure') return receipt.exitCode !== 0 || receipt.status === 'failed'
          if (receipt.exitCode !== 0 || receipt.status !== 'completed') return false
          if (!masksErrors(receipt.command)) return true
          return [EXECUTION_CLAIM_AUDIT_PROFILE, HISTORY_CLAIM_AUDIT_PROFILE].includes(profile) ? outputQuoteSupported(claim.evidenceQuote, receipt.output)
            : typeof claim.evidenceQuote === 'string' && claim.evidenceQuote.trim().length > 0 && receipt.output.includes(claim.evidenceQuote)
        })
        if (!eligible) errors.push('claim_audit.verification_receipt_does_not_support_claim')
      }
    }
    return { ...claim, ordinal: ordinal + 1, result: errors.length ? 'unknown' : claim.result, evidenceIds: ids, validationErrors: errors }
  })
  const verdict = claims.some(claim => claim.result === 'contradicted' && claim.material) ? 'not_satisfied'
    : problems.length || audit?.claimsComplete !== true || claims.some(claim => claim.result === 'unknown') ? 'indeterminate'
    : claims.some(claim => claim.result === 'contradicted') ? 'partially_satisfied' : 'satisfied'
  const evidenceIds = [...new Set(claims.flatMap(claim => claim.evidenceIds))]
  const summary = claims.map(claim => `${claim.ordinal}. ${claim.result}: ${claim.text}`).join(' ')
  output.items[index] = { ...output.items[index], verdict, confidence: verdict === 'indeterminate' ? 'low' : output.items[index].confidence,
    evidenceIds, reason: `Code-derived claim audit (${profile}; full rows in provider claim-audit.json). ${summary}`.slice(0, 1200),
    abstainReason: verdict === 'indeterminate' ? { code: 'claim_audit.evidence_incomplete' } : null }
  return { value: output, audit: { profile, modelInputDigest: digestJson(pack), rawResponseDigest: digestJson(value), claimsComplete: audit?.claimsComplete === true,
    problems, claims, derivedVerdict: verdict, derivedItem: output.items[index] } }
}

// The Judge sees a JSON-encoded receipt. Accept exact decoded output witnesses
// as well as a quoted output JSON field; never reinterpret a command as output.
export function outputQuoteSupported(quote, output) {
  if (typeof quote !== 'string' || !quote.trim() || typeof output !== 'string' || !output) return false
  if (output.includes(quote)) return true
  for (const text of [quote, `{${quote}}`]) {
    try {
      const value = JSON.parse(text)
      const decoded = typeof value === 'string' ? value : value && Object.keys(value).length === 1 && typeof value.output === 'string' ? value.output : null
      if (typeof decoded === 'string' && decoded.trim() && output.includes(decoded)) return true
    } catch { /* An ordinary literal quote need not be JSON. */ }
  }
  return false
}
