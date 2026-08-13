import { lstat, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import {
  canonicalJson,
  digestJson,
  sha256,
  validateRelativeLocator,
  writePrivateJsonExclusive
} from './qualification-common.mjs'

export const TOOL_MEASUREMENT_SPEC_SCHEMA_ID = 'rovai.qualification.tool-measurement-spec'
export const TOOL_MEASUREMENT_SPEC_SCHEMA_VERSION = '1.0.0'
export const TOOL_MEASUREMENT_PROJECTION_POLICY = 'qualification-tool-measurement-v1'

const ADAPTERS = new Set([
  'camp_history',
  'memory_retrieval',
  'memory_mutation',
  'camp_message_send'
])
const MODES = new Set(['forced_use', 'natural_use', 'non_use_control'])
const PARTITIONS = new Set(['development', 'holdout'])
const MEMORY_SCOPES = new Set(['hearth', 'companion', 'relationship'])
const MEMORY_KINDS = new Set(['preference', 'agreement', 'fact', 'lesson', 'commitment'])

export async function admitToolMeasurementPack(packDirectory, caseRecord) {
  const pack = await loadToolMeasurementPack(packDirectory, caseRecord)
  const admissionWithoutDigest = {
    schemaId: 'rovai.qualification.tool-measurement-pack-admission',
    schemaVersion: '1.0.0',
    specificationId: pack.spec.specificationId,
    caseId: caseRecord.contract.manifest.id,
    caseSeal: withDigest(caseRecord.seal),
    partition: pack.spec.partition,
    projectionPolicyId: pack.spec.projectionPolicyId,
    opportunityCount: pack.spec.opportunities.length,
    opportunityStructureDigest: withDigest(digestJson(pack.spec.opportunities)),
    specificationDigest: pack.references.specificationDigest,
    fixtureDigest: pack.references.fixtureDigest,
    oracleDigest: pack.references.oracleDigest
  }
  const admission = {
    ...admissionWithoutDigest,
    admissionDigest: withDigest(digestJson(admissionWithoutDigest))
  }
  await writePrivateJsonExclusive(join(pack.root, 'measurement-admission.json'), admission)
  return admission
}

export async function retainPreparedToolFixtureManifest(evidenceDirectory, manifest) {
  const expected = manifestWithoutPayloadDigest(manifest)
  if (manifest?.schemaId !== 'rovai.qualification.prepared-tool-fixture-manifest'
      || manifest.schemaVersion !== '1.0.0'
      || manifest.payloadDigest !== withDigest(digestJson(expected))) {
    throw new Error('Prepared Tool Fixture Manifest identity is invalid')
  }
  const locator = join(
    'prepared-tool-fixture-manifests',
    `${sha256(`${manifest.armId}:${manifest.payloadDigest}`)}.json`
  )
  await writePrivateJsonExclusive(join(evidenceDirectory, locator), manifest)
  return { locator, payloadDigest: manifest.payloadDigest }
}

export async function verifyToolMeasurementPack(packDirectory, caseRecord) {
  const pack = await loadToolMeasurementPack(packDirectory, caseRecord)
  const admission = JSON.parse(await readFile(join(pack.root, 'measurement-admission.json'), 'utf8'))
  const expectedWithoutDigest = {
    schemaId: 'rovai.qualification.tool-measurement-pack-admission',
    schemaVersion: '1.0.0',
    specificationId: pack.spec.specificationId,
    caseId: caseRecord.contract.manifest.id,
    caseSeal: withDigest(caseRecord.seal),
    partition: pack.spec.partition,
    projectionPolicyId: pack.spec.projectionPolicyId,
    opportunityCount: pack.spec.opportunities.length,
    opportunityStructureDigest: withDigest(digestJson(pack.spec.opportunities)),
    specificationDigest: pack.references.specificationDigest,
    fixtureDigest: pack.references.fixtureDigest,
    oracleDigest: pack.references.oracleDigest
  }
  const expected = {
    ...expectedWithoutDigest,
    admissionDigest: withDigest(digestJson(expectedWithoutDigest))
  }
  if (canonicalJson(admission) !== canonicalJson(expected)) {
    throw new Error('Tool Measurement Pack admission does not match its sealed inputs')
  }
  return { ...pack, admission }
}

export async function materializeToolMeasurementFixtures({
  request,
  campId,
  pack,
  armId,
  treatment
}) {
  if (typeof request !== 'function') throw new Error('fixture materializer requires a Core request function')
  stableId(campId, 'campId')
  stableId(armId, 'armId')
  if (!['team', 'solo'].includes(treatment)) throw new Error('fixture treatment must be team or solo')
  const entities = []
  for (const message of pack.fixture.campMessages) {
    const currentDraft = await request('camp.composerDraft.get', { campId })
    const saved = await request('camp.composerDraft.save', {
      campId,
      expectedRevision: currentDraft.revision,
      content: [{ kind: 'text', text: message.body }]
    })
    const response = await request('camp.messages.send', {
      commandId: crypto.randomUUID(),
      campId,
      draftRevision: saved.revision,
      replyToCampMessageId: null,
      execution: null
    })
    const result = response.commandResult ?? response
    const messageId = result.payload?.campMessageId ?? result.payload?.messageId
    if (!['applied', 'accepted'].includes(result.status) || typeof messageId !== 'string') {
      throw new Error(`Camp fixture message materialization failed for ${message.symbol}`)
    }
    entities.push({
      symbol: message.symbol,
      entityType: 'camp_message',
      entityId: messageId,
      revisionId: null,
      contentDigest: withDigest(sha256(message.body))
    })
  }
  for (const memory of pack.fixture.memories) {
    let response = await request('memory.create', {
      commandId: crypto.randomUUID(),
      command: memoryCommand(memory)
    })
    if (response.status !== 'applied' || typeof response.payload?.memoryId !== 'string') {
      throw new Error(`Memory fixture materialization failed for ${memory.symbol}`)
    }
    let memoryId = response.payload.memoryId
    let revisionId = response.payload.revisionId
    let version = 1
    for (const revision of memory.revisions) {
      response = await request('memory.revise', {
        commandId: crypto.randomUUID(),
        command: {
          memoryId,
          expectedVersion: version,
          baseRevisionId: revisionId,
          body: revision.body,
          retrievalKeys: revision.retrievalKeys,
          reviewAfter: revision.reviewAfter
        }
      })
      if (response.status !== 'applied' || typeof response.payload?.revisionId !== 'string') {
        throw new Error(`Memory fixture revision failed for ${memory.symbol}`)
      }
      revisionId = response.payload.revisionId
      version += 1
    }
    const effective = memory.revisions.at(-1) ?? memory
    entities.push({
      symbol: memory.symbol,
      entityType: 'memory',
      entityId: memoryId,
      revisionId,
      version,
      contentDigest: withDigest(digestJson({
        body: effective.body,
        retrievalKeys: effective.retrievalKeys
      }))
    })
  }
  const manifestWithoutDigest = {
    schemaId: 'rovai.qualification.prepared-tool-fixture-manifest',
    schemaVersion: '1.0.0',
    specificationId: pack.spec.specificationId,
    caseId: pack.admission.caseId,
    caseSeal: pack.admission.caseSeal,
    armId,
    treatment,
    specificationDigest: pack.references.specificationDigest,
    fixtureDigest: pack.references.fixtureDigest,
    oracleDigest: pack.references.oracleDigest,
    entities: entities.sort((left, right) => left.symbol.localeCompare(right.symbol))
  }
  return {
    ...manifestWithoutDigest,
    payloadDigest: withDigest(digestJson(manifestWithoutDigest))
  }
}

export function materializeMeasurementSpecForBuilder(pack, preparedManifest) {
  const oracleById = new Map(pack.oracle.opportunities.map((item) => [item.opportunityId, item.oracle]))
  const identityBySymbol = Object.fromEntries(preparedManifest.entities.map((item) => [item.symbol, {
    entityId: item.entityId,
    revisionId: item.revisionId,
    version: item.version ?? null,
    contentDigest: item.contentDigest
  }]))
  return {
    specificationId: pack.spec.specificationId,
    opportunities: pack.spec.opportunities.map((opportunity) => ({
      opportunityId: opportunity.opportunityId,
      adapter: opportunity.adapter,
      mode: opportunity.mode,
      allowedOperations: opportunity.allowedOperations,
      semanticItems: opportunity.semanticItems,
      oracle: resolveOracleSymbols(oracleById.get(opportunity.opportunityId), identityBySymbol)
    }))
  }
}

export async function loadToolMeasurementPack(packDirectory, caseRecord) {
  if ((await lstat(packDirectory)).isSymbolicLink()) {
    throw new Error('Tool Measurement Pack root must not be a symlink')
  }
  const root = await realpath(packDirectory)
  const spec = JSON.parse(await readFile(join(root, 'measurement-spec.json'), 'utf8'))
  validateSpec(spec, caseRecord)
  const fixtureLocator = validateRelativeLocator(spec.fixtureFile, 'fixtureFile')
  const oracleLocator = validateRelativeLocator(spec.oracleFile, 'oracleFile')
  const fixturePath = join(root, fixtureLocator)
  const oraclePath = join(root, oracleLocator)
  const [fixtureBytes, oracleBytes] = await Promise.all([
    readFile(fixturePath),
    readFile(oraclePath)
  ])
  const fixture = JSON.parse(fixtureBytes)
  const oracle = JSON.parse(oracleBytes)
  validateFixture(fixture, spec)
  validateOracle(oracle, spec, fixture)
  return {
    root,
    spec,
    fixture,
    oracle,
    references: {
      specificationDigest: withDigest(digestJson(spec)),
      fixtureDigest: withDigest(sha256(fixtureBytes)),
      oracleDigest: withDigest(sha256(oracleBytes))
    }
  }
}

function validateSpec(spec, caseRecord) {
  exactKeys(spec, [
    'schemaId', 'schemaVersion', 'specificationId', 'case', 'partition',
    'projectionPolicyId', 'fixtureFile', 'oracleFile', 'opportunities'
  ], 'Tool Measurement Spec')
  if (spec.schemaId !== TOOL_MEASUREMENT_SPEC_SCHEMA_ID
      || spec.schemaVersion !== TOOL_MEASUREMENT_SPEC_SCHEMA_VERSION
      || spec.projectionPolicyId !== TOOL_MEASUREMENT_PROJECTION_POLICY) {
    throw new Error('Tool Measurement Spec identity is unsupported')
  }
  stableId(spec.specificationId, 'specificationId')
  if (!PARTITIONS.has(spec.partition)) throw new Error('Tool Measurement Spec partition is invalid')
  exactKeys(spec.case, ['caseId', 'caseSeal'], 'Tool Measurement Spec case binding')
  if (spec.case.caseId !== caseRecord.contract.manifest.id
      || spec.case.caseSeal !== withDigest(caseRecord.seal)) {
    throw new Error('Tool Measurement Spec is bound to another Case')
  }
  validateRelativeLocator(spec.fixtureFile, 'fixtureFile')
  validateRelativeLocator(spec.oracleFile, 'oracleFile')
  if (!Array.isArray(spec.opportunities) || spec.opportunities.length === 0) {
    throw new Error('Tool Measurement Spec requires opportunities')
  }
  const ids = new Set()
  for (const opportunity of spec.opportunities) {
    exactKeys(opportunity, [
      'opportunityId', 'adapter', 'mode', 'allowedOperations', 'semanticItems'
    ], 'Tool Measurement Opportunity')
    stableId(opportunity.opportunityId, 'opportunityId')
    if (ids.has(opportunity.opportunityId)) throw new Error('Tool Measurement Opportunity IDs must be unique')
    ids.add(opportunity.opportunityId)
    if (!ADAPTERS.has(opportunity.adapter) || !MODES.has(opportunity.mode)) {
      throw new Error(`Tool Measurement Opportunity ${opportunity.opportunityId} has an invalid adapter or mode`)
    }
    boundedStrings(opportunity.allowedOperations, 'allowedOperations', 1, 8)
    boundedStrings(opportunity.semanticItems, 'semanticItems', 0, 5)
  }
}

function validateFixture(fixture, spec) {
  exactKeys(fixture, ['schemaVersion', 'specificationId', 'campMessages', 'memories'], 'Tool fixture')
  if (fixture.schemaVersion !== 1 || fixture.specificationId !== spec.specificationId) {
    throw new Error('Tool fixture identity mismatch')
  }
  if (!Array.isArray(fixture.campMessages) || !Array.isArray(fixture.memories)
      || fixture.campMessages.length > 256 || fixture.memories.length > 128) {
    throw new Error('Tool fixture collection is invalid')
  }
  const symbols = new Set()
  for (const message of fixture.campMessages) {
    exactKeys(message, ['symbol', 'body'], 'Camp message fixture')
    addSymbol(symbols, message.symbol)
    boundedText(message.body, 'Camp message fixture body', 1, 16_000)
  }
  for (const memory of fixture.memories) {
    exactKeys(memory, [
      'symbol', 'scope', 'kind', 'body', 'retrievalKeys', 'companionAgentId',
      'relationshipAgentIds', 'direction', 'directedActorAgentId', 'reviewAfter', 'revisions'
    ], 'Memory fixture')
    addSymbol(symbols, memory.symbol)
    if (!MEMORY_SCOPES.has(memory.scope) || !MEMORY_KINDS.has(memory.kind)) {
      throw new Error(`Memory fixture ${memory.symbol} has an invalid scope or kind`)
    }
    boundedText(memory.body, 'Memory fixture body', 1, 8_000)
    boundedStrings(memory.retrievalKeys, 'Memory retrievalKeys', 1, 16)
    if (!Array.isArray(memory.relationshipAgentIds) || memory.relationshipAgentIds.length > 8) {
      throw new Error('Memory relationshipAgentIds are invalid')
    }
    if (!Array.isArray(memory.revisions) || memory.revisions.length > 8) {
      throw new Error('Memory fixture revisions are invalid')
    }
    for (const revision of memory.revisions) {
      exactKeys(revision, ['body', 'retrievalKeys', 'reviewAfter'], 'Memory fixture revision')
      boundedText(revision.body, 'Memory fixture revision body', 1, 8_000)
      boundedStrings(revision.retrievalKeys, 'Memory revision retrievalKeys', 1, 16)
    }
  }
}

function validateOracle(oracle, spec, fixture) {
  exactKeys(oracle, ['schemaVersion', 'specificationId', 'opportunities'], 'Tool oracle')
  if (oracle.schemaVersion !== 1 || oracle.specificationId !== spec.specificationId
      || !Array.isArray(oracle.opportunities)
      || oracle.opportunities.length !== spec.opportunities.length) {
    throw new Error('Tool oracle identity or cardinality mismatch')
  }
  const expected = new Set(spec.opportunities.map((item) => item.opportunityId))
  const symbols = new Set([
    ...fixture.campMessages.map((item) => item.symbol),
    ...fixture.memories.map((item) => item.symbol)
  ])
  for (const item of oracle.opportunities) {
    exactKeys(item, ['opportunityId', 'oracle'], 'Tool oracle opportunity')
    if (!expected.delete(item.opportunityId)) throw new Error('Tool oracle has an unknown or duplicate opportunity')
    validateOracleValue(item.oracle, symbols)
  }
  if (expected.size > 0) throw new Error('Tool oracle omitted an opportunity')
}

function validateOracleValue(value, symbols, depth = 0) {
  if (depth > 6) throw new Error('Tool oracle nesting is too deep')
  if (value === null || typeof value === 'boolean' || Number.isFinite(value)) return
  if (typeof value === 'string') {
    boundedText(value, 'Tool oracle value', 1, 512)
    if (value.startsWith('$symbol:') && !symbols.has(value.slice(8))) {
      throw new Error(`Tool oracle references unknown fixture symbol ${value.slice(8)}`)
    }
    return
  }
  if (Array.isArray(value)) {
    if (value.length > 64) throw new Error('Tool oracle array is too large')
    value.forEach((item) => validateOracleValue(item, symbols, depth + 1))
    return
  }
  if (!value || typeof value !== 'object') throw new Error('Tool oracle value is invalid')
  const keys = Object.keys(value)
  if (keys.length > 32 || keys.some((key) => !/^[a-z][A-Za-z0-9]{0,63}$/.test(key))) {
    throw new Error('Tool oracle keys are invalid')
  }
  Object.values(value).forEach((item) => validateOracleValue(item, symbols, depth + 1))
}

function resolveOracleSymbols(value, identityBySymbol) {
  if (typeof value === 'string' && value.startsWith('$symbol:')) {
    const identity = identityBySymbol[value.slice(8)]
    if (!identity) throw new Error(`Prepared fixture omitted ${value}`)
    return structuredClone(identity)
  }
  if (Array.isArray(value)) return value.map((item) => resolveOracleSymbols(item, identityBySymbol))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      resolveOracleSymbols(item, identityBySymbol)
    ]))
  }
  return value
}

function memoryCommand(memory) {
  return {
    scope: memory.scope,
    kind: memory.kind,
    body: memory.body,
    retrievalKeys: memory.retrievalKeys,
    companionAgentId: memory.companionAgentId,
    relationshipAgentIds: memory.relationshipAgentIds,
    direction: memory.direction,
    directedActorAgentId: memory.directedActorAgentId,
    reviewAfter: memory.reviewAfter
  }
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const keys = Object.keys(value).sort()
  if (canonicalJson(keys) !== canonicalJson([...allowed].sort())) {
    throw new Error(`${label} has missing or unknown fields`)
  }
}

function addSymbol(symbols, symbol) {
  stableId(symbol, 'fixture symbol')
  if (symbols.has(symbol)) throw new Error(`duplicate fixture symbol ${symbol}`)
  symbols.add(symbol)
}

function stableId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(value)) {
    throw new Error(`${label} is invalid`)
  }
}

function boundedStrings(values, label, minimum, maximum) {
  if (!Array.isArray(values) || values.length < minimum || values.length > maximum
      || new Set(values).size !== values.length) throw new Error(`${label} is invalid`)
  values.forEach((value) => boundedText(value, label, 1, 512))
}

function boundedText(value, label, minimum, maximum) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} is invalid`)
  }
}

function withDigest(value) {
  return String(value).startsWith('sha256:') ? String(value) : `sha256:${value}`
}

function manifestWithoutPayloadDigest(manifest) {
  return Object.fromEntries(Object.entries(manifest ?? {}).filter(([key]) => key !== 'payloadDigest'))
}
