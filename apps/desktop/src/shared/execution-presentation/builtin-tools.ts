import type { LiveRuntimeEvent } from './index'

/** Display vocabulary only. Protocol identities, receipts and stored evidence stay unchanged. */
export const BUILTIN_CLI_NAMES: Readonly<Record<string, string>> = Object.freeze({
  'camp.message.send': 'rovai send',
  'team.gather': 'rovai gather',
  'member.create': 'rovai member create',
  'team.create_task': 'rovai task create',
  'team.get_task': 'rovai task get',
  'team.list_tasks': 'rovai task list',
  'team.update_task': 'rovai task update',
  'camp.list': 'rovai camp list',
  'camp.search': 'rovai camp search',
  'camp.read': 'rovai camp read',
  'single_chat.history': 'rovai single-chat history',
  'history.search': 'rovai history search',
  'memory.view': 'rovai memory view',
  'memory.search': 'rovai memory search',
  'memory.read': 'rovai memory read',
  'memory.write': 'rovai memory write',
  'automation.list': 'rovai automation list',
  'automation.get': 'rovai automation get',
  'automation.create': 'rovai automation create',
  'automation.run': 'rovai automation run',
  'automation.close': 'rovai automation close',
  'automation.update': 'rovai automation update',
  'automation.delete': 'rovai automation delete'
})

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

export function builtinOperation(payloadValue: unknown): string | null {
  const payload = record(payloadValue)
  const operation = payload.canonicalTool
  return payload.sourceAuthority === 'core' && typeof operation === 'string'
    && Object.hasOwn(BUILTIN_CLI_NAMES, operation) ? operation : null
}

const PROJECTION_FACT = /(?:CharCount|Digest|SecretDetected|Redacted|Truncated|TruncatedCount|OmittedCount|Count|Present)$/u

export function builtinInputText(payloadValue: unknown): string | null {
  const payload = record(payloadValue)
  const operation = builtinOperation(payload)
  if (!operation) return null
  const projection = record(payload.operationProjection)
  if (projection.operation !== operation) return null
  const input = record(projection.canonicalInput)
  const message = operation === 'camp.message.send' || operation === 'team.gather'
  const fields = Object.entries(input).filter(([key, value]) =>
    value !== null && value !== undefined && !PROJECTION_FACT.test(key) && key !== 'changedFields'
    && !(message && key === 'body')
  )
  if (fields.length === 0) return null
  const names: Record<string, string> = { recipientAgentIds: 'to', mentionsCurrentUser: 'mentionUser', requestedStatus: 'status' }
  return JSON.stringify(Object.fromEntries(fields.map(([key, value]) => [names[key] ?? key, value])), null, 2)
}

function cliResult(operation: string, result: unknown): unknown {
  const value = record(result)
  let keys: string[] | undefined
  if (operation === 'camp.message.send') keys = ['messageId', 'agentAddressingMode', 'effectiveRecipients', 'deliveryIds']
  if (operation === 'team.gather') keys = ['gatherId', 'requestMessageId', 'effectiveRecipients', 'completion']
  if (operation === 'team.create_task' || operation === 'team.update_task') {
    keys = ['taskId', 'title', 'status', 'assigneeAgentId', 'version', 'availableActions']
    if (operation === 'team.update_task') keys.push('changed')
  }
  if (operation === 'memory.write') {
    keys = value.outcome === 'effective' ? ['outcome', 'memoryId', 'revisionId']
      : value.outcome === 'review_pending' ? ['outcome', 'reviewItemId'] : undefined
  }
  if (!keys) return result
  return keys.every(key => Object.hasOwn(value, key))
    ? Object.fromEntries(keys.map(key => [key, value[key]])) : undefined
}

function stableJson(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize)
    : item !== null && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, normalize(entry)]))
      : item
  return JSON.stringify(normalize(value))
}

/** A completed CLI enclosing one unique Core invocation with its exact projected response
 * establishes a presentation association. Ambiguous/repeated results and mixed commands stay independent.
 * This never alters Canonical Activity, evidence, authorization or replay identity. */
export function builtinShellAssociations(
  events: LiveRuntimeEvent[], agentRunId: string,
  parseCommand: (command: string) => string | null,
  getCommand: (payload: unknown) => string | null
): { hiddenShellIds: Set<string>; shellIdByBuiltinId: Map<string, string> } {
  const run = events.filter(event => event.agentRunId === agentRunId)
  type Invocation = { operation: string; signature: string; first: number; last: number }
  const core = new Map<string, Invocation>()
  const shells = new Map<string, Invocation>()
  const associated = new Set<string>()
  type Identity = Omit<Invocation, 'signature'> & { id: string }
  const coreIdentities = new Map<string, Identity>()
  const attestedShells = new Map<string, Identity>()
  for (const event of run) {
    const payload = record(event.payload)
    const id = event.canonical?.operationId ?? event.id
    const operation = builtinOperation(payload)
    if (operation) {
      if (event.canonical?.sourceAuthority !== 'core' || event.canonical.credibility !== 'core_verified') continue
      coreIdentities.set(id, { id, operation, first: event.canonical.firstEvidenceSequence, last: event.canonical.lastEvidenceSequence })
      const envelope = record(payload.coreEnvelope)
      if (envelope.operation !== operation || envelope.ok !== true) continue
      const signature = stableJson(cliResult(operation, envelope.result))
      if (signature && signature !== '{}') core.set(id, { operation, signature, first: event.canonical?.firstEvidenceSequence ?? 0, last: event.canonical?.lastEvidenceSequence ?? 0 })
      continue
    }
    if (event.canonical?.activityDomain !== 'shell') continue
    const command = getCommand(payload)
    const cliOperation = command ? parseCommand(command) : null
    if (!cliOperation) continue
    if (event.canonical.outcome === 'succeeded' && payload.executionWindowBuiltinOperation === cliOperation) {
      associated.add(id)
      attestedShells.set(id, { id, operation: cliOperation, first: event.canonical.firstEvidenceSequence, last: event.canonical.lastEvidenceSequence })
      continue
    }
    const item = record(payload.item)
    const output = payload.output ?? item.aggregatedOutput ?? item.output
    // Only a complete JSON response is proof; never match a substring of a mixed log.
    let decoded: unknown
    try { decoded = typeof output === 'string' ? JSON.parse(output.trim()) : output } catch { continue }
    const response = record(decoded)
    const signature = stableJson(response)
    if (!signature || signature === '{}') continue
    const outcome = event.canonical?.outcome
    if (outcome !== 'succeeded') continue
    shells.set(id, { operation: cliOperation, signature, first: event.canonical.firstEvidenceSequence, last: event.canonical.lastEvidenceSequence })
  }
  const key = (value: { operation: string; signature: string }): string => JSON.stringify([value.operation, value.signature])
  const coreByResponse = new Map<string, (Invocation & { id: string })[]>()
  const shellCounts = new Map<string, number>()
  for (const [id, value] of core) {
    const responseKey = key(value)
    const candidates = coreByResponse.get(responseKey) ?? []
    candidates.push({ ...value, id })
    coreByResponse.set(responseKey, candidates)
  }
  for (const value of shells.values()) shellCounts.set(key(value), (shellCounts.get(key(value)) ?? 0) + 1)
  const hidden = associated
  const candidatesByBuiltinId = new Map<string, Set<string>>()
  const associate = (builtinId: string, shellId: string): void => {
    const candidates = candidatesByBuiltinId.get(builtinId) ?? new Set<string>()
    candidates.add(shellId)
    candidatesByBuiltinId.set(builtinId, candidates)
  }
  for (const [id, shell] of shells) {
    const responseKey = key(shell)
    if (shellCounts.get(responseKey) !== 1) continue
    const matches = (coreByResponse.get(responseKey) ?? []).filter(candidate =>
      shell.first > 0 && shell.first < candidate.first && candidate.last < shell.last)
    if (matches.length === 1 && !core.has(id)) {
      hidden.add(id)
      associate(matches[0].id, id)
    }
  }
  // Window summaries omit responses. Reuse the Core-attested carrier marker, but
  // select a detail source only when its enclosing lifetime identifies one local
  // verified operation. A carrier whose Core row is on another page stays hidden.
  const coreByOperation = new Map<string, Identity[]>()
  for (const identity of coreIdentities.values()) {
    const candidates = coreByOperation.get(identity.operation) ?? []
    candidates.push(identity)
    coreByOperation.set(identity.operation, candidates)
  }
  for (const shell of attestedShells.values()) {
    const matches = (coreByOperation.get(shell.operation) ?? []).filter(candidate =>
      shell.first > 0 && shell.first < candidate.first && candidate.last < shell.last)
    if (matches.length === 1 && matches[0].id !== shell.id) associate(matches[0].id, shell.id)
  }
  return {
    hiddenShellIds: hidden,
    shellIdByBuiltinId: new Map([...candidatesByBuiltinId].flatMap(([id, candidates]) =>
      candidates.size === 1 ? [[id, [...candidates][0]]] : []))
  }
}
