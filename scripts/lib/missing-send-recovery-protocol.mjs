const ACP_ADAPTERS = new Set([
  'opencode-cli',
  'copilot-cli',
  'kiro-cli',
  'qoder-cli',
  'codebuddy-cli',
  'qwen-code',
  'trae-cn-cli',
  'kimi-code-cli'
])

export function validateAcpRecoveryProtocolFixture(fixture) {
  if (!fixture || !ACP_ADAPTERS.has(fixture.adapterKind)) {
    throw new Error(`Protocol fixture has an unsupported ACP Adapter: ${JSON.stringify(fixture?.adapterKind)}`)
  }
  if (!Array.isArray(fixture.events) || fixture.events.length === 0) {
    throw new Error('Protocol fixture must contain ordered events')
  }
  let previousSequence = -1
  let toolEventCount = 0
  let turnCompleted = false
  let state = { kind: 'empty' }
  const privateAssistantStream = fixture.adapterKind === 'kimi-code-cli'
    && fixture.assistantStreamVisibility === 'private'
  for (const event of fixture.events) {
    if (!Number.isInteger(event.sequence) || event.sequence <= previousSequence) {
      throw new Error(`Protocol fixture sequence is not strictly increasing: ${JSON.stringify(event)}`)
    }
    previousSequence = event.sequence
    if (event.kind === 'tool') {
      toolEventCount += 1
      state = { kind: 'empty' }
      continue
    }
    if (event.kind === 'assistant') {
      if (privateAssistantStream) {
        throw new Error('Kimi private assistant chunks entered the public protocol fixture')
      }
      if (turnCompleted) throw new Error('Assistant chunk arrived after prompt completion')
      const messageId = nonEmptyString(event.messageId)
      const text = typeof event.text === 'string' ? event.text : ''
      if (!text) continue
      if (event.messageIdSource != null && !['update', 'content'].includes(event.messageIdSource)) {
        throw new Error(`Unknown ACP messageId source: ${JSON.stringify(event.messageIdSource)}`)
      }
      state = appendAssistantChunk(state, messageId, text)
      continue
    }
    if (event.kind === 'turn_completed') {
      if (turnCompleted) throw new Error('Protocol fixture contains more than one prompt completion')
      if (event.stopReason !== 'end_turn') {
        throw new Error(`ACP prompt did not finish with end_turn: ${JSON.stringify(event.stopReason)}`)
      }
      turnCompleted = true
      continue
    }
    throw new Error(`Protocol fixture contains an unknown event kind: ${JSON.stringify(event)}`)
  }
  if (toolEventCount === 0) throw new Error('ACP protocol fixture did not observe real tool activity')
  if (!turnCompleted) throw new Error('ACP protocol fixture omitted prompt completion')
  const candidate = candidateFromState(state)
  if (privateAssistantStream) {
    if (candidate !== null
        || fixture.publishedFinal !== fixture.expectedFinal
        || fixture.recovery?.decision !== 'published'
        || fixture.recovery?.candidateBoundary !== 'acp_end_turn_assistant_suffix'
        || !nonEmptyString(fixture.recovery?.messageId)) {
      throw new Error(`Kimi private recovery evidence disagrees with the real final: ${JSON.stringify({
        expected: fixture.expectedFinal,
        published: fixture.publishedFinal,
        candidate,
        recovery: fixture.recovery
      })}`)
    }
    return {
      adapterKind: fixture.adapterKind,
      toolEventCount,
      assistantChunkCount: 0,
      identifiedChunkCount: 0,
      anonymousChunkCount: 0,
      assistantStreamVisibility: 'private',
      candidateSource: 'terminal_recovery_record',
      candidate: fixture.publishedFinal
    }
  }
  if (candidate !== fixture.expectedFinal) {
    throw new Error(`ACP protocol candidate disagrees with the real final: ${JSON.stringify({
      expected: fixture.expectedFinal,
      candidate,
      state
    })}`)
  }
  return {
    adapterKind: fixture.adapterKind,
    toolEventCount,
    assistantChunkCount: fixture.events.filter((event) => event.kind === 'assistant').length,
    identifiedChunkCount: fixture.events.filter((event) => event.kind === 'assistant' && nonEmptyString(event.messageId)).length,
    anonymousChunkCount: fixture.events.filter((event) => event.kind === 'assistant' && !nonEmptyString(event.messageId)).length,
    assistantStreamVisibility: 'public',
    candidateSource: 'assistant_chunks',
    candidate
  }
}

function appendAssistantChunk(state, messageId, text) {
  if (state.kind === 'ambiguous') return state
  if (state.kind === 'empty') {
    return messageId
      ? { kind: 'identified', messageId, text }
      : { kind: 'anonymous', text }
  }
  if (state.kind === 'anonymous') {
    return messageId
      ? { kind: 'ambiguous' }
      : { kind: 'anonymous', text: state.text + text }
  }
  if (!messageId) return { kind: 'ambiguous' }
  return messageId === state.messageId
    ? { ...state, text: state.text + text }
    : { kind: 'identified', messageId, text }
}

function candidateFromState(state) {
  if (!['anonymous', 'identified'].includes(state.kind)) return null
  const candidate = state.text.trim()
  return candidate || null
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value : null
}
