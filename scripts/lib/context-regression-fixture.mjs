import { composerDocumentForAddress } from './create-configured-camp.mjs'
import { isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { digestJson } from './qualification-common.mjs'

export function validateRegressionConfiguration(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.team) || value.team.length < 1 || value.team.length > 4) throw new Error('Regression configuration requires 1–4 explicit members')
  if (new Set(value.team.map(member => member.agentId)).size !== value.team.length || value.team[0].agentId !== 'agent_1') throw new Error('Regression team must have distinct IDs and agent_1 as Lead')
  for (const member of value.team) {
    if (!/^agent_[1-4]$/.test(member.agentId) || !member.adapterKind || member.model?.mode !== 'explicit' || !member.model.modelId || member.permissions?.adapterKind !== member.adapterKind) throw new Error('Regression Runtime/model/permissions must be explicit')
  }
  if (value.temporaryRoot !== undefined && (typeof value.temporaryRoot !== 'string' || !isAbsolute(value.temporaryRoot))) throw new Error('Regression temporaryRoot must be an absolute, new directory')
  if (value.fixture && (!Array.isArray(value.fixture.campMessages) || !Array.isArray(value.fixture.memories))) throw new Error('Regression fixture must explicitly list messages and memories')
  if ((value.fixture?.campMessages.length ?? 0) > 100 || (value.fixture?.memories.length ?? 0) > 20) throw new Error('Regression fixture exceeds its bounded setup budget')
  return value
}

export async function materializeRegressionFixture(request, fixture = { campMessages: [], memories: [] }, campId) {
  const entities = []
  for (const body of fixture.campMessages) {
    if (typeof body !== 'string' || body.length > 100_000) throw new Error('Invalid regression history fixture')
    const current = await request('camp.composerDraft.get', { campId })
    const saved = await request('camp.composerDraft.save', { campId, expectedRevision: current.revision, content: composerDocumentForAddress({ mode: 'default' }, body) })
    const response = await request('camp.messages.send', { commandId: randomUUID(), campId, draftRevision: saved.revision, execution: null })
    const result = response.commandResult ?? response
    if (!['applied', 'accepted'].includes(result.status)) throw new Error('Regression history fixture was not accepted')
    entities.push({ kind: 'camp_message', id: result.payload.campMessageId ?? result.payload.messageId, digest: digestJson(body) })
  }
  for (const memory of fixture.memories) {
    const result = await request('memory.create', { commandId: randomUUID(), command: memory })
    if (result.status !== 'applied' || !result.payload.memoryId) throw new Error('Regression memory fixture was not accepted')
    entities.push({ kind: 'memory', id: result.payload.memoryId, revisionId: result.payload.revisionId, digest: digestJson(memory) })
  }
  return { fixtureDigest: digestJson(fixture), entities }
}

export async function captureRegressionMemoryState(request) {
  const library = await request('memory.list')
  const reviews = await request('memory.hearthReviewItems.list')
  if (!Array.isArray(library?.memories) || !Array.isArray(reviews)) throw new Error('Regression memory snapshot is unavailable')
  return { memories: library.memories.map(memory => ({ id: memory.id, revisionId: memory.currentRevisionId, lifecycle: memory.lifecycle, version: memory.version })).sort((a, b) => a.id.localeCompare(b.id)),
    reviews: reviews.map(review => ({ id: review.reviewItemId, status: review.status })).sort((a, b) => a.id.localeCompare(b.id)) }
}
