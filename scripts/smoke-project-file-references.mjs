import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchHost } from './lib/host-test-client.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

// Real filesystem, Desktop Host pipe and authenticated Web. No model is configured or called.
const repository = resolve(import.meta.dirname, '..')
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-file-reference-host-')))
const data = join(fixture, 'data'), project = join(fixture, 'project'), other = join(fixture, 'other')
await mkdir(project); await mkdir(other)
const relative = 'src/中文 (draft)#1.test.ts'
await mkdir(join(project, 'src')); await writeFile(join(project, relative), 'export const nonce = "first"\n')
const host = launchHost(join(repository, 'target/debug/rovai-host'), [...coreDataDirectoryArguments(data), '--skill-library-root', join(data, 'skills'), '--mcp-config-path', join(data, 'mcp.json')], { cwd: repository })
const checks = []
console.log(JSON.stringify({ channel: 'automatic_acceptance', fixture, data, skills: join(data, 'skills'), mcp: join(data, 'mcp.json'), realRuntime: false }))
try {
  await host.ready
  assert.equal((await host.request('app.info')).composerProjectFileReferenceVersion, 1)
  const members = await host.request('members.list')
  const create = async path => {
    const workspace = await host.request('workspaces.validate', { path })
    const created = await host.request('threads.create', { commandId: randomUUID(), name: 'File reference acceptance', workspace,
      memberAgentIds: [members[0].agentId], defaultLeadAgentId: members[0].agentId, collaborationMode: 'peer', activationState: 'pending' })
    assert.equal(created.status, 'applied'); return created.payload.threadId
  }
  const threadId = await create(project), target = await create(project), foreign = await create(other)
  const request = (action, input = {}) => host.request('projectFiles.request', { threadId, action, ...input })
  const scope = (await request('resolve')).value.scopeId
  const found = await request('search', { scopeId: scope, query: 'draft', queryRevision: 1 })
  assert.equal(found.ok, true); assert.equal(found.value.partial, false)
  const entry = found.value.entries.find(item => item.relativePath === relative)
  assert.ok(entry)
  const source = (await request('open', { scopeId: scope, entryId: entry.id })).value
  await request('release', { scopeId: scope })
  const resolveFile = (target, source) => host.request('projectFileReferences.resolve', { threadId: target, references: [{ threadId: source.threadId, rawReference: source.rawReference }] })
  const available = await resolveFile(threadId, source)
  assert.equal(available.value[0].status, 'available')
  assert.equal(available.value[0].reference.labelFallback, relative)
  checks.push('independent search scope closes while selected file identity survives')
  const rebound = await resolveFile(target, source)
  assert.equal(rebound.value[0].status, 'available')
  assert.equal(rebound.value[0].reference.threadId, target)
  assert.notEqual(rebound.value[0].reference.rawReference, source.rawReference)
  assert.equal((await resolveFile(foreign, source)).value[0].status, 'needs_reselect')
  checks.push('target permission reissues same-root identity and refuses different roots')
  const current = await host.request('filePreview.resolveSource', source)
  assert.equal(current.kind, 'file_target')
  assert.equal(await host.request('filePreview.resolveSource', { ...source, expectedPathAtSend: join(project, 'different.ts') }), null)
  checks.push('history path assertion narrows preview authorization')
  const atom = available.value[0].reference
  const frozen = { commandId: randomUUID(), threadId, content: { version: 2, segments: [{ kind: 'atom', atom }] } }
  await rm(join(project, relative))
  const rejected = await host.request('thread.messages.send', frozen)
  assert.equal(rejected.commandResult.code, 'project_file_reference_unavailable')
  assert.equal(rejected.commandResult.payload.segmentIndex, 0)
  assert.equal(rejected.commandResult.payload.reason, 'file_missing')
  await writeFile(join(project, relative), 'export const nonce = "restored"\n')
  const replay = await host.request('thread.messages.send', frozen)
  assert.equal(replay.replayed, true); assert.deepEqual(replay.commandResult, rejected.commandResult)
  const snapshot = await host.request('threads.open', { threadId, traceId: randomUUID() })
  assert.equal(snapshot.thread.activationState, 'pending'); assert.equal(snapshot.messages.length, 0)
  checks.push('invalid Pending first input is atomic and rejection replay precedes fresh filesystem checks')
  const wrong = await host.request('thread.messages.send', { ...frozen, commandId: randomUUID(), threadId: target })
  assert.equal(wrong.commandResult.payload.reason, 'thread_mismatch')
  await assert.rejects(host.request('thread.messages.send', { ...frozen, commandId: randomUUID(), content: { version: 2, segments: [{ kind: 'atom', atom: { ...atom, pathAtSend: '/forged' } }] } }))
  checks.push('foreign Thread and client-authored publication fields are rejected')
  const started = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory: join(repository, 'out/web') })
  const login = version => fetch(started.origin + '/api/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: version, administratorToken: started.administratorToken }) })
  assert.equal((await login(5)).status, 409)
  const auth = await login(6); assert.equal(auth.status, 200)
  const token = (await auth.json()).token
  const info = await (await fetch(started.origin + '/api/v1/request', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ operation: 'app.info', params: {} }) })).json()
  assert.equal(info.result.composerProjectFileReferenceVersion, 1)
  assert.equal('dataDir' in info.result, false)
  const response = await fetch(started.origin + '/api/v1/request', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ operation: 'projectFileReferences.resolve', params: { threadId: target, references: [{ threadId, rawReference: source.rawReference }] } }) })
  assert.equal(response.status, 200)
  const web = await response.json()
  assert.deepEqual(web.result, rebound)
  checks.push('authenticated Web shares Host identity rules; protocol 5 cannot read or write')
  console.log(JSON.stringify({ passed: checks, realFilesystem: true, realRuntime: false }))
} finally {
  await host.close()
  await removeEphemeralRuntimeCampFilesRoot(data)
  if (process.env.ROVAI_KEEP_FILE_REFERENCE_FIXTURE !== '1') await rm(fixture, { recursive: true, force: true })
}
