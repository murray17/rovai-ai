// Match Core's durable business receipt to the exact message from this Run.
export async function claudeSendReceipt(request, threadId, runId, marker, snapshot) {
  const evidence = []
  let afterSequence = 0
  for (;;) {
    const page = await request('agentRunEvidence.list', { threadId, agentRunId: runId, afterSequence, limit: 1000 })
    evidence.push(...page.evidence)
    if (!page.hasMore) break
    if (page.nextAfterSequence <= afterSequence) throw new Error('Claude send evidence pagination did not advance')
    afterSequence = page.nextAfterSequence
  }
  let send = null, messageId = null
  for (const entry of evidence.filter(entry => entry.payload?.kind === 'builtin_tool_invocation'
    && entry.payload.canonicalTool === 'thread.message.send' && entry.payload.status === 'completed')) {
    const content = await request('agentRunEvidence.getContent', { threadId, evidenceId: entry.id })
    const id = content.payload.receiptId
    if (snapshot.messages.some(message => message.id === id && message.body === marker && message.sourceAgentRunId === runId)) {
      send = content.payload
      messageId = id
      break
    }
  }
  if (!send) return null
  const envelope = send.coreEnvelope
  const message = snapshot.messages.find(value => value.id === messageId)
  if (send.sourceAuthority !== 'core' || !envelope?.ok
      || envelope.operation !== 'thread.message.send' || !/^sha256:[0-9a-f]{64}$/.test(envelope.receipt ?? '')
      || message?.body !== marker || message.sourceAgentRunId !== runId) {
    throw new Error(`Claude real send did not bind a Core receipt to this Run/message: ${JSON.stringify({ runId, messageId, envelope, message })}`)
  }
  return { messageId, receipt: envelope.receipt, sourceAgentRunId: runId }
}
