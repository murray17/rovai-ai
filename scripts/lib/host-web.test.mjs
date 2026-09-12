import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, mkdir, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { createServer } from 'node:net'
import test from 'node:test'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './runtime-camp-files-root.mjs'

const repository = resolve(import.meta.dirname, '../..')
const binary = process.env.ROVAI_HOST_BIN ?? join(repository, 'target/debug', process.platform === 'win32' ? 'rovai-host.exe' : 'rovai-host')
const uiDirectory = process.env.ROVAI_WEB_UI ?? join(repository, 'out/web')

// Owns the real Desktop pipe + HTTP + unique Core lifetime seam. It uses only
// isolated directories and public record mutations, never a model or daily data.
test('Desktop and Web share one Core while listener failure, revocation and stop stay local', { timeout: 90_000 }, async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-host-web-')))
  const workspace = join(fixture, 'workspace')
  await mkdir(workspace)
  const dataDir = process.platform === 'win32'
    ? JSON.parse(execFileSync(binary, ['--prepare-windows-data-root', join(fixture, 'formal')], { encoding: 'utf8' })).core
    : join(fixture, 'data')
  const host = launch([
    ...coreDataDirectoryArguments(dataDir),
    '--skill-library-root', join(dataDir, 'skills'), '--mcp-config-path', join(dataDir, 'mcp.json')
  ])
  const controllers = []
  try {
    await within(host.ready)
    assert.equal((await host.request('host.web.status')).enabled, false)
    assert.ok((await host.request('app.info')).dataDir)
    const occupied = createServer()
    await new Promise((resolve, reject) => { occupied.once('error', reject); occupied.listen(0, '127.0.0.1', resolve) })
    try {
      await assert.rejects(host.request('host.web.start', { listen: `127.0.0.1:${occupied.address().port}`, uiDirectory }), { code: 'HOST_WEB_START_FAILED' })
      assert.equal((await host.request('host.web.status')).enabled, false)
      assert.ok((await host.request('app.info')).dataDir)
    } finally {
      await new Promise((resolve) => occupied.close(resolve))
    }
    const started = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory, authorizedWorkspaces: [workspace] })
    assert.equal(started.enabled, true)
    const origin = started.origin
    const administrator = started.administratorToken
    const status = await host.request('host.web.status')
    assert.equal('administratorToken' in status, false)
    assert.equal(status.origin, origin)
    await assert.rejects(host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory }), { code: 'HOST_WEB_START_FAILED' })
    const request = (path, options = {}) => fetch(`${origin}/api/v1/${path}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000) })
    const login = async (editor) => {
      const response = await request('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 2, administratorToken: administrator, ...(editor ? { editor } : {}) }) })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('set-cookie'), null)
      return response.json()
    }
    for (const [path, options, expected] of [
      ['capabilities', {}, 401],
      ['capabilities', { headers: { Authorization: `Bearer ${administrator}` } }, 401],
      ['capabilities', { headers: { Origin: 'http://127.0.0.1:1' } }, 403],
      ['capabilities?token=not-a-real-token', {}, 400],
      ['login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1, administratorToken: administrator }) }, 409],
      ['login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 400]
    ]) {
      const response = await request(path, options)
      assert.equal(response.status, expected, path)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(response.headers.get('set-cookie'), null)
    }
    const first = await login()
    assert.equal(first.protocolVersion, 2)
    const second = await login()
    assert.notEqual(first.clientId, second.clientId)
    const authorized = (session, path, options = {}) => request(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` } })
    const call = async (session, operation, params = {}) => {
      const response = await authorized(session, 'request', { method: 'POST', body: JSON.stringify({ operation, params }) })
      assert.equal(response.status, 200, operation)
      const result = await response.json()
      assert.equal(result.error, null, operation)
      return result.result
    }
    const info = await call(first, 'app.info')
    assert.equal('dataDir' in info, false)
    assert.equal(info.name, (await host.request('app.info')).name)
    assert.deepEqual(await call(second, 'navigation.snapshot'), await host.request('navigation.snapshot'))
    for (const operation of ['host.web.rotate', 'core.shutdown', 'host.editor.resolve', 'host.upload.bind', 'camp.sourceAttachments.addFromPath', 'camp.attachments.desktopOpenTarget', 'filePreview.resolveSource']) {
      const response = await authorized(first, 'request', { method: 'POST', body: JSON.stringify({ operation, params: {} }) })
      assert.equal(response.status, 400, operation)
    }
    // Writes use real Core services and independent, proof-bound editing scopes.
    const profiles = await call(first, 'members.list')
    const createParams = { commandId: crypto.randomUUID(), name: 'Web owned draft', workspace: null, memberAgentIds: [profiles[0].agentId], defaultLeadAgentId: profiles[0].agentId, collaborationMode: 'peer' }
    const created = await call(first, 'camps.create', createParams)
    assert.equal(created.status, 'applied')
    const campId = created.payload.campId
    assert.deepEqual((await call(first, 'commands.reconcile', { operation: 'camps.create', params: createParams })).result, created)
    const roots = await (await authorized(first, 'workspaces')).json()
    const directoryParams = { ...createParams, commandId: crypto.randomUUID(), name: 'Workspace later moved', workspace: await call(first, 'workspaces.validate', { path: roots[0].projectPath }) }
    const directoryCamp = await call(first, 'camps.create', directoryParams)
    assert.equal(directoryCamp.status, 'applied')
    await rename(workspace, `${workspace}-moved`)
    assert.deepEqual((await call(first, 'commands.reconcile', { operation: 'camps.create', params: directoryParams })).result, directoryCamp)
    const save = (session, text, expectedRevision = 0) => call(session, 'camp.composerDraft.save', { campId, expectedRevision, content: { version: 2, segments: [{ kind: 'text', text }] } })
    const draftA = await save(first, 'tab A')
    const draftB = await save(second, 'tab B')
    assert.notEqual(draftA.draftId, draftB.draftId)
    assert.equal((await host.request('camp.composerDraft.get', { campId })).body, '')
    const forged = await request('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 2, administratorToken: administrator, editor: { clientId: first.clientId, proof: second.editorProof } }) })
    assert.equal(forged.status, 401)
    const resumed = await login({ clientId: first.clientId, proof: first.editorProof })
    assert.equal(resumed.clientId, first.clientId)
    assert.equal((await authorized(first, 'capabilities')).status, 401)
    Object.assign(first, resumed)
    assert.deepEqual(await call(first, 'camp.composerDraft.get', { campId }), draftA)
    const rejectedQuote = { commandId: crypto.randomUUID(), command: { campId, conversationId: null, expectedRevision: draftA.revision + 1, action: { type: 'remove', quoteId: crypto.randomUUID() } } }
    const quoteResponse = await authorized(first, 'request', { method: 'POST', body: JSON.stringify({ operation: 'messageQuotes.mutateDraft', params: rejectedQuote }) })
    assert.ok((await quoteResponse.json()).error, 'A stale quote mutation must reject')
    const quoteReceipt = await call(first, 'commands.reconcile', { operation: 'messageQuotes.mutateDraft', params: rejectedQuote })
    assert.deepEqual(quoteReceipt, { state: 'recorded', error: { code: 'draft_changed', message: 'draft_changed' } })
    assert.deepEqual(await call(first, 'camp.composerDraft.get', { campId }), draftA)
    const input = new TextEncoder().encode('source ref from real HTTP upload')
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', input))].map(value => value.toString(16).padStart(2, '0')).join('')
    const intent = { commandId: crypto.randomUUID(), campId, expectedRevision: draftA.revision, displayName: '浏览器 source.txt', byteSize: input.length, sha256 }
    const upload = new FormData(); upload.append('intent', JSON.stringify(intent)); upload.append('file', new Blob([input]), 'web-source.txt')
    const uploadResponse = await request('uploads', { method: 'POST', headers: { Authorization: `Bearer ${first.token}` }, body: upload })
    assert.equal(uploadResponse.status, 200, await uploadResponse.clone().text())
    const bound = (await uploadResponse.json()).draft
    assert.equal(bound.attachments[0].id, intent.commandId)
    const locator = { owner: 'composer', campId, attachmentRefId: intent.commandId }
    const ownFile = await authorized(first, 'attachments', { method: 'POST', body: JSON.stringify(locator) })
    assert.match(ownFile.headers.get('content-disposition'), /filename\*=UTF-8''/)
    assert.equal(decodeURIComponent(ownFile.headers.get('content-disposition').split("filename*=UTF-8''")[1]), intent.displayName)
    assert.equal(await ownFile.text(), new TextDecoder().decode(input))
    assert.equal((await authorized(second, 'attachments', { method: 'POST', body: JSON.stringify(locator) })).status, 404)
    const previewResponse = await authorized(first, 'files', { method: 'POST', body: JSON.stringify({ action: 'open', request: { kind: 'attachment', campId, locator } }) })
    const preview = await previewResponse.json()
    assert.equal(preview.ok, true, JSON.stringify(preview))
    const file = preview.value.file
    const readFile = session => authorized(session, 'files', { method: 'POST', body: JSON.stringify({ action: 'readText', request: { handleId: file.handleId, expectedGeneration: file.contentGeneration } }) }).then(response => response.json())
    assert.equal((await readFile(first)).value.text, new TextDecoder().decode(input))
    assert.equal((await readFile(second)).ok, false)
    const sentParams = { commandId: crypto.randomUUID(), campId, draftRevision: bound.revision, execution: null }
    const sent = await call(first, 'camp.messages.send', sentParams)
    assert.notEqual(sent.commandResult.status, 'rejected', JSON.stringify(sent))
    assert.deepEqual((await call(first, 'commands.reconcile', { operation: 'camp.messages.send', params: sentParams })).result.commandResult, sent.commandResult)
    assert.equal((await call(first, 'camp.composerDraft.get', { campId })).body, '')
    assert.deepEqual(await call(second, 'camp.composerDraft.get', { campId }), draftB)
    assert.equal((await readFile(first)).ok, false, 'consumed Composer source no longer authorizes its old handle')
    const messageLocator = { owner: 'message', campId, messageId: sent.commandResult.payload.campMessageId, attachmentRefId: intent.commandId }
    const historyFile = await authorized(first, 'attachments', { method: 'POST', body: JSON.stringify(messageLocator) })
    assert.equal(historyFile.status, 200)
    assert.equal(await historyFile.text(), new TextDecoder().decode(input))
    const html = await fetch(origin, { redirect: 'error' })
    assert.equal(html.status, 200)
    assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/)
    assert.match(await html.text(), /浏览器工作区/)
    const controller = new AbortController(); controllers.push(controller)
    const stream = await fetch(`${origin}/api/v1/events`, { headers: { Authorization: `Bearer ${first.token}` }, signal: controller.signal })
    assert.equal(stream.status, 200)
    const reader = stream.body.getReader()
    assert.match(new TextDecoder().decode((await within(reader.read())).value), /event: resync/)
    const otherReaders = []
    for (const session of [first, second]) {
      const controller = new AbortController(); controllers.push(controller)
      const response = await fetch(`${origin}/api/v1/events`, { headers: { Authorization: `Bearer ${session.token}` }, signal: controller.signal })
      assert.equal(response.status, 200, 'one client filling its quota must not deny another client')
      const reader = response.body.getReader()
      assert.match(new TextDecoder().decode((await within(reader.read())).value), /event: resync/)
      otherReaders.push(reader)
    }
    assert.equal((await authorized(first, 'events')).status, 429, 'a third stream must exceed only this session quota')
    const rotated = await host.request('host.web.rotate')
    assert.notEqual(rotated.administratorToken, administrator)
    assert.equal((await authorized(first, 'capabilities')).status, 401)
    assert.equal((await authorized(second, 'capabilities')).status, 401)
    assert.equal((await within(reader.read())).done, true, 'rotation must close active SSE')
    reader.releaseLock()
    for (const reader of otherReaders) {
      assert.equal((await within(reader.read())).done, true, 'rotation must close every client stream')
      reader.releaseLock()
    }
    assert.equal((await host.request('host.web.stop')).enabled, false)
    assert.equal(host.child.exitCode, null, 'stopping Web must leave Core alive')
    assert.equal((await host.request('app.info')).name, info.name)
    await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(2000) }))
    await assert.rejects(host.request('host.web.start', { listen: '0.0.0.0:0', uiDirectory }), { code: 'HOST_WEB_START_FAILED' })
    assert.equal((await host.request('host.web.status')).enabled, false)
    const restarted = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory })
    assert.equal(restarted.enabled, true)
    const reply = await host.request('core.shutdown', { protocolVersion: 3, deadlineMs: 10_000 })
    assert.equal(reply.controlledShutdownCyclePersisted, true)
    assert.equal((await within(host.closed)).code, 0)
    await assert.rejects(fetch(restarted.origin, { signal: AbortSignal.timeout(2000) }))
    assert.equal(host.unmatchedResponses.length, 0, 'Web correlation responses must never leak into Desktop stdout')
    assert.ok(!host.stderr().includes(administrator), 'management credentials must not enter logs')
    assert.ok(!host.stderr().includes(first.token), 'session credentials must not enter logs')
  } finally {
    controllers.forEach((controller) => controller.abort())
    await host.close()
    await removeEphemeralRuntimeCampFilesRoot(dataDir, { temporaryDirectory: fixture })
    await rm(fixture, { recursive: true, force: true })
  }
})

function launch(args) {
  const child = spawn(binary, args, { cwd: repository, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  const unmatchedResponses = []
  let nextId = 1
  let stderr = ''
  let resolveReady; let rejectReady
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  void ready.catch(() => {})
  child.stdin.on('error', () => {})
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000) })
  const closed = new Promise((resolve) => {
    child.once('error', (error) => { rejectReady(error); resolve({ code: null, error: error.message }) })
    child.once('close', (code) => {
      rejectReady(new Error(`Host stopped (${code}): ${stderr}`))
      for (const request of pending.values()) request.reject(new Error('Host stopped'))
      resolve({ code })
    })
  })
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    const message = JSON.parse(line)
    if (message.kind === 'core_startup' && message.status === 'ready') resolveReady(message)
    if (message.kind === 'core_startup' && ['failed', 'blocked'].includes(message.status)) rejectReady(new Error(message.error?.code ?? 'Core refused'))
    if (message.id !== undefined) {
      const request = pending.get(message.id)
      if (!request) { unmatchedResponses.push(message.id); return }
      pending.delete(message.id)
      if (message.error) request.reject(message.error)
      else request.resolve(message.result)
    }
  })
  return {
    child, ready, closed, unmatchedResponses, stderr: () => stderr,
    async request(method, params = {}) {
      await within(ready)
      const id = nextId++
      try {
        return await within(new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject })
          child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
        }))
      } finally { pending.delete(id) }
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end()
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
      try { await closed } finally { clearTimeout(timer); lines.close() }
    }
  }
}

async function within(promise) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Host Web step exceeded 15 seconds')), 15_000)
    })])
  } finally { clearTimeout(timer) }
}
