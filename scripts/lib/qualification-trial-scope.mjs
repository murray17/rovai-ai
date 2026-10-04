// Each Qualification Trial creates a fresh Camp. Current Public Delivery
// claims batch Runs after publication and has no CampTurn identity.
export function isBatchTrialBoundary(boundary) {
  return boundary?.scope === 'isolated_camp_message_batch'
}

export function trialRuns(snapshot, boundary) {
  if (!snapshot || !boundary) return []
  const runs = Array.isArray(snapshot.agentRuns) ? snapshot.agentRuns : []
  return isBatchTrialBoundary(boundary)
    ? runs
    : runs.filter(run => (run.threadTurnId ?? run.campTurnId) === (boundary.threadTurnId ?? boundary.campTurnId))
}

export function trialDeliveries(snapshot, boundary) {
  if (!snapshot || !boundary || !Array.isArray(snapshot.messageDeliveries)) return []
  if (!isBatchTrialBoundary(boundary)) {
    return snapshot.messageDeliveries.filter(delivery => (delivery.threadTurnId ?? delivery.campTurnId) === (boundary.threadTurnId ?? boundary.campTurnId))
  }
  const rootSequence = snapshot.messages?.find(message => message.id === boundary.rootCampMessageId)?.sequence
  if (!Number.isSafeInteger(rootSequence)) return []
  const messageSequence = new Map(snapshot.messages.map(message => [message.id, message.sequence]))
  return snapshot.messageDeliveries.filter(delivery => messageSequence.get(delivery.messageId) >= rootSequence)
}

export function trialAgentDeliveries(snapshot, boundary) {
  const agentMessageIds = new Set((snapshot?.messages ?? [])
    .filter(message => message.authorType === 'agent')
    .map(message => message.id))
  return trialDeliveries(snapshot, boundary).filter(delivery => (
    agentMessageIds.has(delivery.messageId)
    && delivery.deliveryKind === 'public_a2a'
    && delivery.dispatchDisposition === 'dispatch'
  ))
}

export function trialRootRun(snapshot, boundary) {
  if (!isBatchTrialBoundary(boundary)) {
    return trialRuns(snapshot, boundary).find(run => run.id === boundary?.rootAgentRunId) ?? null
  }
  const rootDelivery = trialDeliveries(snapshot, boundary)
    .find(delivery => delivery.messageId === boundary.rootCampMessageId)
  if (!rootDelivery?.targetAgentRunId) return null
  const run = trialRuns(snapshot, boundary)
    .find(candidate => candidate.id === rootDelivery.targetAgentRunId)
  return run?.inputMessageIds?.includes(boundary.rootCampMessageId) ? run : null
}
