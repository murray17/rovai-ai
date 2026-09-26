import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, mkdir, rename, writeFile, readdir, readFile as readAssetFile, cp, utimes, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchHost, within } from './host-test-client.mjs'
import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as pause } from 'node:timers/promises'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './runtime-camp-files-root.mjs'

const repository = resolve(import.meta.dirname, '../..')
const binary = process.env.ROVAI_HOST_BIN ?? join(repository, 'target/debug', process.platform === 'win32' ? 'rovai-host.exe' : 'rovai-host')
const uiDirectory = process.env.ROVAI_WEB_UI ?? join(repository, 'out/web')

// Owns the real Desktop pipe + HTTP + unique Core lifetime seam. It uses only
// isolated directories and public record mutations, never a model or daily data.
test('Desktop and Web share one Core while listener failure, revocation and stop stay local', { timeout: 90_000 }, async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-host-web-')))
  const builtUiDirectory = uiDirectory
  const ownedUiDirectory = join(fixture, 'web-ui')
  await cp(builtUiDirectory, ownedUiDirectory, { recursive: true })
  await writeFile(join(ownedUiDirectory, 'assets/plain.js'), 'console.log(1)')
  await writeFile(join(ownedUiDirectory, 'assets/unlisted-Abcdef12.js'), 'console.log(2)')
  const workspace = join(fixture, 'workspace')
  await mkdir(workspace)
  const dataDir = process.platform === 'win32'
    ? JSON.parse(execFileSync(binary, ['--prepare-windows-data-root', join(fixture, 'formal')], { encoding: 'utf8' })).core
    : join(fixture, 'data')
  console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir, skillLibraryRoot: join(dataDir, 'skills'), mcpConfigPath: join(dataDir, 'mcp.json'), runtime: false }))
  const uploadScratch = join(fixture, 'uploads')
  await mkdir(uploadScratch)
  const host = launchHost(binary, [
    ...coreDataDirectoryArguments(dataDir),
    '--skill-library-root', join(dataDir, 'skills'), '--mcp-config-path', join(dataDir, 'mcp.json')
  ], { cwd: repository, env: { ...process.env, TMPDIR: uploadScratch, TMP: uploadScratch, TEMP: uploadScratch } })
  const controllers = []
  try {
    await within(host.ready)
    assert.equal((await host.request('host.web.status')).enabled, false)
    const initialToken = (await host.request('host.web.token')).administratorToken
    assert.match(initialToken, /^[0-9a-f]{64}$/)
    assert.equal((await host.request('host.web.token')).administratorToken, initialToken, 'local token exists before the first start')
    assert.ok((await host.request('app.info')).dataDir)
    const occupied = createServer()
    await new Promise((resolve, reject) => { occupied.once('error', reject); occupied.listen(0, '127.0.0.1', resolve) })
    try {
      await assert.rejects(host.request('host.web.start', { listen: `127.0.0.1:${occupied.address().port}`, uiDirectory: ownedUiDirectory }), { code: 'HOST_WEB_START_FAILED' })
      assert.equal((await host.request('host.web.status')).enabled, false)
      assert.ok((await host.request('app.info')).dataDir)
    } finally {
      await new Promise((resolve) => occupied.close(resolve))
    }
    const started = await host.request('host.web.start', { listen: '127.0.0.1:0', publicOrigin: 'http://198.18.0.1:4317', uiDirectory: ownedUiDirectory })
    assert.equal(started.enabled, true)
    const origin = started.origin
    const shellForAssets = await fetch(`${origin}/`)
    assert.equal(shellForAssets.headers.get('cache-control'), 'no-store')
    const assetUrl = (await shellForAssets.text()).match(/src="(\/assets\/[^"]+\.js)"/)[1]
    assert.equal((await fetch(origin + assetUrl)).headers.get('cache-control'), 'public, max-age=31536000, immutable')
    for (const name of ['plain.js', 'unlisted-Abcdef12.js', 'missing-Abcdef12.js']) {
      assert.equal((await fetch(`${origin}/assets/${name}`)).headers.get('cache-control'), 'no-store')
    }
    const assetPath = join(ownedUiDirectory, assetUrl.slice(1))
    const originalAsset = await readAssetFile(assetPath)
    await writeFile(assetPath, 'changed under the same URL')
    assert.equal((await fetch(origin + assetUrl)).headers.get('cache-control'), 'no-store', 'a mismatched build digest never gets immutable caching')
    await writeFile(assetPath, originalAsset)
    const administrator = started.administratorToken
    assert.equal(administrator, initialToken, 'failed and successful starts retain the Host credential')
    const status = await host.request('host.web.status')
    assert.equal('administratorToken' in status, false)
    assert.equal(status.origin, origin)
    assert.equal((await host.request('host.web.token')).administratorToken, administrator)
    assert.ok(status.addresses.some(address => address.origin === origin))
    assert.equal(status.addresses.some(address => address.origin.includes('198.18.')), false)
    assert.equal(origin.includes('198.18.'), false, 'the default address comes from filtered discovery')
    await assert.rejects(host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory: ownedUiDirectory }), { code: 'HOST_WEB_START_FAILED' })
    const request = (path, options = {}) => fetch(`${origin}/api/v1/${path}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000) })
    // Fetch normalizes Host to its URL. Use HTTP directly to exercise the
    // configured proxy authority without changing this machine's interfaces.
    for (const [requestOrigin, expected] of [['http://198.18.0.1:4317', 401], [origin, 403]]) {
      const code = await new Promise((resolve, reject) => {
        const req = httpRequest(`${origin}/api/v1/capabilities`, {
          headers: { Host: '198.18.0.1:4317', Origin: requestOrigin }, signal: AbortSignal.timeout(10_000)
        }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); response.on('error', reject) })
        req.on('error', reject); req.end()
      })
      assert.equal(code, expected, 'excluded discovery addresses retain authentication and same-origin admission')
    }
    const login = async (editor) => {
      const response = await request('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 4, administratorToken: administrator, ...(editor ? { editor } : {}) }) })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('set-cookie'), null)
      return response.json()
    }
    for (const [path, options, expected] of [
      ['capabilities', {}, 401],
      ['workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: workspace }) }, 401],
      ['capabilities', { headers: { Authorization: `Bearer ${administrator}` } }, 401],
      ['capabilities', { headers: { Origin: 'http://127.0.0.1:1' } }, 403],
      ['capabilities?token=not-a-real-token', {}, 400],
      ['login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 3, administratorToken: administrator }) }, 409],
      ['login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 2, administratorToken: administrator }) }, 409],
      ['login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1, administratorToken: administrator }) }, 409],
      ['login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 400]
    ]) {
      const response = await request(path, options)
      assert.equal(response.status, expected, path)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(response.headers.get('set-cookie'), null)
    }
    const first = await login()
    assert.equal(first.protocolVersion, 4)
    assert.ok(first.expiresAt - first.serverTime <= 30 * 24 * 60 * 60 * 1000 && first.expiresAt - first.serverTime > 30 * 24 * 60 * 60 * 1000 - 10000)
    assert.equal(first.renewalWindowSeconds, 7 * 24 * 60 * 60)
    const second = await login()
    assert.notEqual(first.clientId, second.clientId)
    const authorized = (session, path, options = {}) => request(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` } })
    const earlyRenewal = await authorized(first, 'session/renew', { method: 'POST' })
    assert.equal(earlyRenewal.status, 200)
    const earlyTiming = await earlyRenewal.json()
    assert.equal(earlyTiming.expiresAt, first.expiresAt)
    assert.equal('token' in earlyTiming, false)
    const exchange = ticket => request('login-ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 4, ticket }) })
    const staleTicket = await host.request('host.web.loginTicket')
    const ticket = await host.request('host.web.loginTicket')
    assert.equal(ticket.expiresInSeconds, 120)
    assert.notEqual(ticket.ticket, administrator)
    assert.equal((await exchange(staleTicket.ticket)).status, 401)
    const competitors = await Promise.all([exchange(ticket.ticket), exchange(ticket.ticket)])
    assert.deepEqual(competitors.map(reply => reply.status).sort(), [200, 401])
    const scanSession = await competitors.find(reply => reply.status === 200).json()
    assert.ok(scanSession.expiresAt - scanSession.serverTime <= 30 * 24 * 60 * 60 * 1000 && scanSession.expiresAt - scanSession.serverTime > 30 * 24 * 60 * 60 * 1000 - 10000)
    assert.notEqual(scanSession.clientId, first.clientId)
    assert.notEqual(scanSession.clientId, second.clientId)
    assert.equal((await authorized(scanSession, 'capabilities')).status, 200)
    assert.equal((await exchange(ticket.ticket)).status, 401)
    assert.equal(JSON.stringify(await host.request('host.web.status')).includes(ticket.ticket), false)
    const call = async (session, operation, params = {}) => {
      const response = await authorized(session, 'request', { method: 'POST', body: JSON.stringify({ operation, params }) })
      assert.equal(response.status, 200, operation)
      const result = await response.json()
      assert.equal(result.error, null, operation)
      return result.result
    }
    const editor = { clientId: first.clientId, proof: first.editorProof }
    const resume = async (body) => authorized(first, 'session', { method: 'POST', body: JSON.stringify(body) })
    const restored = await (await resume({ editor })).json()
    assert.equal(restored.clientId, first.clientId)
    assert.equal(restored.editorProof, first.editorProof)
    assert.equal('token' in restored, false, 'validation does not rotate the Bearer')
    for (const invalid of [{ clientId: second.clientId, proof: second.editorProof }, { ...editor, proof: 'f'.repeat(64) }]) {
      assert.equal((await resume({ editor: invalid })).status, 401)
    }
    assert.equal((await resume({})).status, 401, 'existing editor requires a proof')
    const browserReopen = await (await resume({ fork: true })).json()
    assert.notEqual(browserReopen.clientId, first.clientId)
    assert.equal(browserReopen.expiresAt, first.expiresAt)
    await authorized(browserReopen, 'logout', { method: 'POST' })
    const fork = await (await resume({ editor, fork: true })).json()
    assert.notEqual(fork.clientId, first.clientId)
    assert.notEqual(fork.token, first.token)
    assert.equal((await authorized(fork, 'capabilities')).status, 200)
    await authorized(fork, 'logout', { method: 'POST' })
    assert.equal((await authorized(first, 'capabilities')).status, 200, 'copied tab logout cannot revoke its opener')
    assert.equal((await authorized(fork, 'session/renew', { method: 'POST' })).status, 401)
    const info = await call(first, 'app.info')
    assert.equal('dataDir' in info, false)
    assert.equal(info.name, (await host.request('app.info')).name)
    assert.deepEqual(await call(second, 'navigation.snapshot'), await host.request('navigation.snapshot'))
    for (const operation of ['preferences.newConversation.initialize', 'host.web.token', 'host.web.rotate', 'host.web.loginTicket', 'core.shutdown', 'host.editor.resolve', 'host.upload.bind', 'camp.composerDraft.get', 'camp.composerDraft.save', 'camp.sourceAttachments.addFromPath', 'camp.attachments.desktopOpenTarget', 'filePreview.resolveSource']) {
      const response = await authorized(first, 'request', { method: 'POST', body: JSON.stringify({ operation, params: {} }) })
      assert.equal(response.status, 400, operation)
    }
    // Writes use real Core services and independent, proof-bound editing scopes.
    const profiles = await call(first, 'members.list')
    const defaultsMethod = 'preferences.newConversation.'
    const legacyDefaults = { newConversationDefaults: { memberAgentIds: [profiles[0].agentId], defaultLeadAgentId: profiles[0].agentId }, newConversationDefaultsRequireConfirmation: false, oneClickNewConversationEnabled: true }
    assert.equal((await call(first, defaultsMethod + 'get')).newConversationDefaults, null)
    await host.request(defaultsMethod + 'initialize', legacyDefaults)
    assert.deepEqual(await call(first, defaultsMethod + 'get'), legacyDefaults)
    assert.deepEqual(await call(second, defaultsMethod + 'get'), legacyDefaults)
    const toggled = await call(first, defaultsMethod + 'setOneClick', { enabled: false })
    assert.equal(toggled.oneClickNewConversationEnabled, false)
    // Re-import after restart must never overwrite a choice made in Web.
    assert.deepEqual(await host.request(defaultsMethod + 'initialize', legacyDefaults), toggled)
    const nextTeam = { memberAgentIds: profiles.slice(0, 2).map(profile => profile.agentId), defaultLeadAgentId: profiles[1].agentId }
    const sharedDefaults = await call(second, defaultsMethod + 'setDefaults', { defaults: nextTeam, enableOneClick: true })
    assert.equal(sharedDefaults.oneClickNewConversationEnabled, true)
    assert.deepEqual(await host.request(defaultsMethod + 'get'), sharedDefaults)
    assert.deepEqual(await call(first, defaultsMethod + 'invalidate', { expectedDefaults: legacyDefaults.newConversationDefaults }), sharedDefaults)
    const invalidated = await call(first, defaultsMethod + 'invalidate', { expectedDefaults: nextTeam })
    assert.equal(invalidated.newConversationDefaultsRequireConfirmation, true)
    await assert.rejects(host.request(defaultsMethod + 'setOneClick', { enabled: true }))
    assert.deepEqual(await call(first, defaultsMethod + 'setDefaults', { defaults: nextTeam, enableOneClick: false }), sharedDefaults)
    for (const defaults of [{ ...nextTeam, defaultLeadAgentId: 'missing' }, { memberAgentIds: ['missing'], defaultLeadAgentId: 'missing' }, { memberAgentIds: [profiles[0].agentId, profiles[0].agentId], defaultLeadAgentId: profiles[0].agentId }]) {
      await assert.rejects(host.request(defaultsMethod + 'setDefaults', { defaults, enableOneClick: false }))
      assert.deepEqual(await call(first, defaultsMethod + 'get'), sharedDefaults)
    }
    const createParams = { commandId: crypto.randomUUID(), name: 'Web owned message', workspace: null, memberAgentIds: [profiles[0].agentId], defaultLeadAgentId: profiles[0].agentId, collaborationMode: 'peer' }
    const created = await call(first, 'camps.create', createParams)
    assert.equal(created.status, 'applied')
    const campId = created.payload.campId
    for (const [operation, cursor] of [
      ['agentRunExecution.page', { afterSequence: 1 }],
      ['agentRunExecution.changes', { afterChangeSequence: 1, refreshEvidenceIds: [] }]
    ]) {
      const response = await authorized(first, 'request', { method: 'POST', body: JSON.stringify({ operation, params: { campId, agentRunId: 'missing-run', ...cursor, limit: 12 } }) })
      assert.equal(response.status, 200)
      const reply = await response.json()
      assert.match(reply.error?.message ?? '', /AgentRun does not exist in this Camp/)
    }
    assert.deepEqual((await call(first, 'commands.reconcile', { operation: 'camps.create', params: createParams })).result, created)
    const roots = await (await authorized(first, 'workspaces', { method: 'POST', body: JSON.stringify({ path: fixture }) })).json()
    // Windows Core returns canonical paths with an extended-length prefix.
    const listedPaths = await Promise.all(roots.directories.map(entry => realpath(entry.projectPath)))
    assert.ok(listedPaths.includes(await realpath(workspace)), JSON.stringify(roots))
    assert.equal((await host.request('host.web.token')).administratorToken, administrator)
    assert.equal((await authorized(first, 'capabilities')).status, 200, 'viewing the token must not revoke sessions')
    const directoryParams = { ...createParams, commandId: crypto.randomUUID(), name: 'Workspace later moved', workspace: await call(first, 'workspaces.validate', { path: workspace }) }
    const directoryCamp = await call(first, 'camps.create', directoryParams)
    assert.equal(directoryCamp.status, 'applied')
    await rename(workspace, `${workspace}-moved`)
    assert.deepEqual((await call(first, 'commands.reconcile', { operation: 'camps.create', params: directoryParams })).result, directoryCamp)
    // Public Camp editing is local to each Renderer. The Host owns only the
    // authenticated upload source and the one-shot publication command.
    const forged = await request('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 4, administratorToken: administrator, editor: { clientId: first.clientId, proof: second.editorProof } }) })
    assert.equal(forged.status, 401)
    const resumed = await login({ clientId: first.clientId, proof: first.editorProof })
    assert.equal(resumed.clientId, first.clientId)
    assert.equal((await authorized(first, 'capabilities')).status, 401)
    Object.assign(first, resumed)
    const input = new TextEncoder().encode('source ref from real HTTP upload')
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', input))].map(value => value.toString(16).padStart(2, '0')).join('')
    const intent = { commandId: crypto.randomUUID(), campId, expectedRevision: 1, displayName: '浏览器 source.txt', byteSize: input.length, sha256 }
    const spools = async () => (await readdir(uploadScratch)).filter(name => name.startsWith('rovai-web-upload-'))
    const postUpload = body => request('uploads', { method: 'POST', headers: { Authorization: `Bearer ${first.token}` }, body })
    for (const scenario of ['digest', 'duplicate-file', 'too-large']) {
      const invalid = new FormData(); invalid.append('intent', JSON.stringify(intent))
      invalid.append('file', new Blob([scenario === 'too-large' ? new Uint8Array(20 * 1024 * 1024 + 1) : input]), 'input')
      if (scenario === 'duplicate-file') invalid.append('file', new Blob([input]), 'duplicate')
      if (scenario === 'digest') { invalid.set('intent', JSON.stringify({ ...intent, sha256: '0'.repeat(64) })) }
      // Invalid multipart requests may be rejected before their body finishes.
      // Use a fresh HTTP connection and observe the actual rejection response;
      // fetch's pooled streaming writer can race that close and report EPIPE.
      const encoded = new Request(`${origin}/api/v1/uploads`, { method: 'POST', body: invalid })
      const bytes = Buffer.from(await encoded.arrayBuffer())
      const rejectedStatus = await new Promise((resolve, reject) => {
        let responding = false
        const req = httpRequest(encoded.url, { method: 'POST', agent: false,
          headers: { Authorization: `Bearer ${first.token}`, 'Content-Type': encoded.headers.get('content-type'), 'Content-Length': bytes.length },
          signal: AbortSignal.timeout(10_000)
        }, response => {
          responding = true
          response.resume()
          response.on('end', () => resolve(response.statusCode))
          response.on('error', reject)
        })
        req.on('error', error => { if (!responding) reject(error) })
        req.end(bytes)
      })
      assert.equal(rejectedStatus, scenario === 'too-large' ? 413 : 400)
      assert.deepEqual(await spools(), [], 'rejected multipart bytes must leave no unbound source')
    }
    const abort = new AbortController()
    const boundary = 'rovai-upload-abort-fixture'
    const partial = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="partial"\r\nContent-Type: application/octet-stream\r\n\r\n`))
      controller.enqueue(new Uint8Array(64 * 1024))
    } })
    const interruptedUpload = fetch(`${origin}/api/v1/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${first.token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: partial, duplex: 'half', signal: abort.signal }).catch(() => undefined)
    await within((async () => { while ((await spools()).length === 0) await pause(10) })())
    abort.abort(); await interruptedUpload
    await within((async () => { while ((await spools()).length !== 0) await pause(10) })())
    const upload = new FormData(); upload.append('intent', JSON.stringify(intent)); upload.append('file', new Blob([input]), 'web-source.txt')
    const uploadResponse = await request('uploads', { method: 'POST', headers: { Authorization: `Bearer ${first.token}` }, body: upload })
    assert.equal(uploadResponse.status, 200, `${await uploadResponse.clone().text()}\n${host.stderr()}`)
    const bound = (await uploadResponse.json()).draft
    assert.equal(bound.id, intent.commandId)
    assert.ok(bound.sourcePath)
    assert.equal((await spools()).length, 1, 'a bound source survives request completion')
    const replayUpload = new FormData(); replayUpload.append('file', new Blob([input]), 'replay'); replayUpload.append('intent', JSON.stringify(intent))
    assert.equal((await postUpload(replayUpload)).status, 200, 'file-before-intent remains supported')
    assert.equal((await spools()).length, 1, 'a replay discards only its duplicate spool')

    // Actual HTTP ingress and the shared private page API use the verified
    // editor, never the client-provided conversation or command identity alone.
    const privateOpen = session => call(session, 'singleChat.open', { commandId: crypto.randomUUID(), command: { campId, agentId: profiles[0].agentId } })
    const privateA = await privateOpen(first)
    const privateB = await privateOpen(second)
    assert.equal(privateA.status, 'applied')
    assert.equal(privateB.payload.conversationId, privateA.payload.conversationId)
    const conversationId = privateA.payload.conversationId
    const privateIntent = { ...intent, commandId: crypto.randomUUID(), expectedRevision: 0, target: { kind: 'single_chat', conversationId } }
    const privateUpload = new FormData(); privateUpload.append('intent', JSON.stringify(privateIntent)); privateUpload.append('file', new Blob([input]), 'private.txt')
    const sendPrivateUpload = () => request('uploads', { method: 'POST', headers: { Authorization: `Bearer ${first.token}` }, body: privateUpload })
    const privateResponse = await sendPrivateUpload()
    assert.equal(privateResponse.status, 200, await privateResponse.clone().text())
    const privateSnapshot = (await privateResponse.json()).draft
    assert.equal(privateSnapshot.draft.attachments[0].id, privateIntent.commandId)
    assert.equal((await call(second, 'singleChat.get', { conversationId })).draft.attachments.length, 0)
    assert.equal((await host.request('singleChat.get', { conversationId })).draft.attachments.length, 0)
    const privateLocator = { owner: 'single_chat_composer', campId, conversationId, attachmentRefId: privateIntent.commandId }
    assert.equal((await authorized(first, 'attachments', { method: 'POST', body: JSON.stringify(privateLocator) })).status, 200)
    assert.equal((await authorized(second, 'attachments', { method: 'POST', body: JSON.stringify(privateLocator) })).status, 404)
    assert.equal((await sendPrivateUpload()).status, 200)
    assert.equal((await call(first, 'singleChat.get', { conversationId })).draft.attachments.length, 1)
    const privateRemove = await call(first, 'singleChat.composerDraft.removeAttachment', { conversationId, expectedDraftRevision: privateSnapshot.draft.revision, attachmentRefId: privateIntent.commandId })
    assert.equal(privateRemove.draft.attachments.length, 0)
    assert.equal((await call(second, 'singleChat.get', { conversationId })).draft.revision, 0)
    const sentParams = { commandId: crypto.randomUUID(), campId,
      content: { version: 2, segments: [{ kind: 'text', text: 'Published from Web' }] },
      sourceAttachments: [bound], quotes: [], replyToCampMessageId: null, execution: null }
    const sent = await call(first, 'camp.messages.send', sentParams)
    assert.notEqual(sent.commandResult.status, 'rejected', JSON.stringify(sent))
    assert.deepEqual((await call(first, 'commands.reconcile', { operation: 'camp.messages.send', params: sentParams })).result.commandResult, sent.commandResult)
    const messageLocator = { owner: 'message', campId, messageId: sent.commandResult.payload.campMessageId, attachmentRefId: intent.commandId }
    const historyFile = await authorized(first, 'attachments', { method: 'POST', body: JSON.stringify(messageLocator) })
    assert.equal(historyFile.status, 200)
    assert.equal(await historyFile.text(), new TextDecoder().decode(input))
    // Single Chat retains its Core-owned private pending edit lease.
    const pendingInputId = crypto.randomUUID()
    const seed = new DatabaseSync(join(dataDir, 'rovai.sqlite'))
    seed.exec('PRAGMA busy_timeout=5000')
    const now = new Date().toISOString()
    try {
      seed.prepare(`insert into single_chat_pending_input(id,conversation_id,enqueue_sequence,state,body,user_id,created_at,updated_at)
        values(?,?,1,'needs_repair','Pending private fixture','local_user',?,?)`).run(pendingInputId, conversationId, now, now)
    } finally { seed.close() }
    const operation = 'singleChat.pendingInputs.edit'
    const command = { campId, conversationId, pendingInputId, expectedRevision: 1, editToken: null, action: { type: 'begin' } }
    const begun = await call(first, operation, { commandId: crypto.randomUUID(), command })
    assert.equal(begun.status, 'applied', JSON.stringify(begun))
    const pendingIntent = { ...intent, commandId: crypto.randomUUID(), expectedRevision: 1, target: { kind: 'single_chat_pending', conversationId, pendingInputId, editToken: begun.payload.editToken } }
    const pendingForm = new FormData(); pendingForm.append('intent', JSON.stringify(pendingIntent)); pendingForm.append('file', new Blob([input]), 'pending.txt')
    const postPending = session => request('uploads', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: pendingForm })
    const boundPending = await postPending(first)
    assert.equal(boundPending.status, 200, await boundPending.clone().text())
    const pendingSnapshot = (await boundPending.json()).draft
    const edit = pendingSnapshot.pendingInputs.editSession
    assert.equal(edit.workingAttachments.length, 1)
    assert.equal(edit.workingAttachments[0].id, pendingIntent.commandId)
    assert.notEqual((await postPending(second)).status, 200, 'a leaked edit token does not confer another editor’s upload ownership')
    const replayed = await postPending(first)
    assert.equal(replayed.status, 200)
    assert.equal((await replayed.json()).draft.pendingInputs.editSession.workingAttachments.length, 1, 'replaying an unknown upload outcome must not duplicate the attachment')
    await call(first, operation, { commandId: crypto.randomUUID(), command: { ...command, editToken: edit.editToken, action: { type: 'cancel' } } })
    const html = await fetch(origin, { redirect: 'error' })
    assert.equal(html.status, 200)
    assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/)
    assert.match(await html.text(), /<title>Rovai AI<\/title>/)
    const portrait = (await readdir(join(ownedUiDirectory, 'assets'))).find(name=>name.endsWith('.avif'))
    assert.ok(portrait, 'production Web package includes the native member portraits')
    const portraitResponse = await fetch(`${origin}/assets/${portrait}`, { redirect: 'error' })
    assert.equal(portraitResponse.status, 200)
    assert.equal(portraitResponse.headers.get('content-type'), 'image/avif')
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
    // Sequential closed-tab recoveries, not simultaneous logins. Two other
    // Sessions retain actual SSE readers throughout; their drafts must survive.
    let candidate = first
    for (let index = 0; index < 64; index++) {
      const response = await authorized(candidate, 'session', { method: 'POST', body: JSON.stringify({ fork: true }) })
      assert.equal(response.status, 200, `closed tab recovery ${index}`)
      const child = await response.json()
      assert.notEqual(child.clientId, candidate.clientId)
      assert.equal(child.expiresAt, first.expiresAt)
      candidate = child
      assert.ok((await host.request('host.web.status')).sessions <= 32)
    }
    assert.equal((await authorized(first, 'capabilities')).status, 200)
    assert.equal((await authorized(second, 'capabilities')).status, 200)
    await rename(`${workspace}-moved`, workspace)
    const fileCampId = directoryCamp.payload.campId
    const largePath = join(workspace, 'large-preview.txt')
    const largeText = '第一行\n' + 'a'.repeat(2 * 1024 * 1024) + '\n最后🌸'
    await writeFile(largePath, largeText)
    const fileTime = new Date('2020-01-01T00:00:00Z')
    await utimes(largePath, fileTime, fileTime)
    const fileCall = async (session, action, value) => {
      const binary = ['readBinary', 'readChildImage', 'download'].includes(action)
      const response = await authorized(session, binary ? 'files/bytes' : 'files', { method: 'POST', body: JSON.stringify({ action, request: value }) })
      assert.equal(response.headers.get('cache-control'), 'no-store')
      if (binary && !response.headers.get('content-type').includes('application/json')) {
        assert.equal(response.status, 200)
        return { ok: true, value: { bytes: Buffer.from(await response.arrayBuffer()), mime: response.headers.get('content-type'),
          contentGeneration: response.headers.get('x-rovai-content-generation'), contentVersion: JSON.parse(response.headers.get('x-rovai-content-version')) } }
      }
      assert.equal(response.status, 200)
      return response.json()
    }
    const largeOpen = await fileCall(first, 'open', { kind: 'camp_workspace', campId: fileCampId, rawReference: 'large-preview.txt' })
    assert.equal(largeOpen.ok, true, JSON.stringify(largeOpen))
    let largeFile = largeOpen.value.file
    assert.equal(largeFile.kind, 'paged_text')
    assert.ok(largeFile.capabilities.includes('download'))
    assert.equal(largeFile.capabilities.includes('open_in_system'), false)
    const page = await fileCall(first, 'readPage', { handleId: largeFile.handleId, expectedGeneration: largeFile.contentGeneration, offset: 0, maxBytes: 9 })
    assert.equal(page.value.text, '第一行')
    assert.equal(page.value.endOffset, 9)
    const line = await fileCall(first, 'resolveLine', { handleId: largeFile.handleId, expectedGeneration: largeFile.contentGeneration, line: 2 })
    assert.equal(line.value.offset, 10)
    await writeFile(largePath, largeText.replace('a', 'b')); await utimes(largePath, fileTime, fileTime)
    assert.equal((await fileCall(first, 'readPage', { handleId: largeFile.handleId, expectedGeneration: largeFile.contentGeneration, offset: 0 })).ok, false, 'same length and restored mtime cannot hide changed bytes')
    await writeFile(largePath, largeText); await utimes(largePath, fileTime, fileTime)

    assert.equal((await fileCall(second, 'readPage', { handleId: largeFile.handleId, expectedGeneration: largeFile.contentGeneration, offset: 0 })).ok, false)
    await writeFile(largePath, largeText + '\nchanged')
    const updates = await fileCall(first, 'updates', {})
    assert.ok(updates.value.some(event => event.campId === fileCampId && event.previewKeys.includes(largeFile.previewKey)))
    const otherUpdates = await fileCall(second, 'updates', {})
    assert.equal(otherUpdates.value.some(event => event.previewKeys.includes(largeFile.previewKey)), false)
    assert.equal((await fileCall(first, 'readPage', { handleId: largeFile.handleId, expectedGeneration: largeFile.contentGeneration, offset: 0 })).ok, false)
    const reloaded = await fileCall(first, 'reload', { handleId: largeFile.handleId, reopenToken: largeFile.reopenToken, expectedGeneration: largeFile.contentGeneration })
    assert.equal(reloaded.ok, true)
    largeFile = reloaded.value
    const downloaded = await fileCall(first, 'download', { handleId: largeFile.handleId, expectedGeneration: largeFile.contentGeneration })
    assert.equal(downloaded.ok, true)
    assert.equal(Buffer.compare(downloaded.value.bytes, Buffer.from(largeText + '\nchanged')), 0)
    await fileCall(first, 'release', { handleId: largeFile.handleId })
    // HTML classification, original-source reads and editor/generation fences use
    // the real Host API. The separate Chrome case owns rendering and native browser capabilities.
    const htmlText = '<!doctype html><h1>HTML preview</h1><button>Run</button>'
    await writeFile(join(workspace, 'interactive.html'), htmlText)
    const htmlFile = (await fileCall(first, 'open', { kind: 'camp_workspace', campId: fileCampId, rawReference: 'interactive.html' })).value.file
    assert.equal(htmlFile.kind, 'html')
    assert.equal(htmlFile.mime, 'text/html')
    const htmlRead = { handleId: htmlFile.handleId, expectedGeneration: htmlFile.contentGeneration }
    const htmlDocument = (await fileCall(first, 'readHtml', htmlRead)).value
    assert.equal(htmlDocument.text, htmlText)
    assert.match(htmlDocument.resourceBasePath, /^\/preview-assets\/[a-f0-9]{64}\/$/)
    const cssPath = join(workspace, 'style.css')
    await writeFile(cssPath, 'body { color: red }')
    const cssUrl = origin + htmlDocument.resourceBasePath + 'style.css?version=1'
    const resource = await fetch(cssUrl, { headers: { Origin: 'null' } })
    assert.equal(resource.status, 200)
    assert.equal(resource.headers.get('access-control-allow-origin'), '*')
    assert.match(resource.headers.get('content-security-policy'), /sandbox allow-scripts;/)
    assert.equal(await resource.text(), 'body { color: red }')
    const replacement = join(workspace, 'edited.css')
    await writeFile(replacement, 'body { color: blue }'); await rename(replacement, cssPath)
    assert.equal(await (await fetch(cssUrl, { headers: { Origin: 'null' } })).text(), 'body { color: blue }')
    assert.equal((await fetch(cssUrl, { headers: { Origin: 'https://other.invalid' } })).status, 403)
    if (process.platform !== 'win32') {
      const secret = join(fixture, 'outside.css'); await writeFile(secret, 'outside')
      await symlink(secret, join(workspace, 'escape.css'))
      assert.equal((await fetch(origin + htmlDocument.resourceBasePath + 'escape.css')).status, 404)
    }
    assert.equal((await fileCall(first, 'readText', htmlRead)).value.text, htmlText)
    assert.equal((await fileCall(second, 'readHtml', htmlRead)).ok, false)
    assert.equal((await fileCall(first, 'readHtml', { ...htmlRead, expectedGeneration: 'obsolete' })).ok, false)
    await fileCall(first, 'release', { handleId: htmlFile.handleId })
    assert.equal((await fileCall(first, 'readHtml', htmlRead)).ok, false)
    assert.equal((await fetch(cssUrl)).status, 404, 'release revokes relative resource access')
    const shell = await fetch(`${origin}/preview.html`)
    assert.equal(shell.status, 200)
    assert.match(shell.headers.get('content-security-policy'), /sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-modals;/)
    assert.match(shell.headers.get('content-security-policy'), /form-action http: https:/)
    assert.doesNotMatch(shell.headers.get('content-security-policy'), /allow-top-navigation/)
    for (const path of ['/', '/api/not-a-route']) {
      const response = await fetch(`${origin}${path}`)
      assert.match(response.headers.get('content-security-policy'), /script-src 'self';/)
      assert.match(response.headers.get('content-security-policy'), /form-action 'self'/)
      assert.doesNotMatch(response.headers.get('content-security-policy'), /allow-same-origin|'unsafe-eval'/)
    }
    assert.equal(shell.headers.get('cache-control'), 'no-store')
    const childPath = join(workspace, 'child notes.md')
    await writeFile(childPath, '# Child\nRelative resource marker')
    await writeFile(join(workspace, 'parent.md'), '[Child](./child%20notes.md#L2)')
    const parent = (await fileCall(first, 'open', { kind: 'camp_workspace', campId: fileCampId, rawReference: 'parent.md' })).value.file
    assert.ok(parent.capabilities.includes('read_child'))
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
    await writeFile(join(workspace, 'inline.png'), png)
    const imageRequest = { handleId: parent.handleId, expectedGeneration: parent.contentGeneration, rawReference: './inline.png' }
    const inlineImage = await fileCall(first, 'readChildImage', imageRequest)
    assert.equal(inlineImage.ok, true, JSON.stringify(inlineImage))
    assert.equal(inlineImage.value.mime, 'image/png')
    assert.equal(Buffer.compare(inlineImage.value.bytes, png), 0)
    assert.equal((await fileCall(second, 'readChildImage', imageRequest)).ok, false)
    assert.equal((await fileCall(first, 'readChildImage', { ...imageRequest, expectedGeneration: 'obsolete' })).ok, false)
    assert.equal((await fileCall(first, 'readChildImage', { ...imageRequest, rawReference: '../outside.png' })).ok, false)

    const childRequest = { kind: 'child_of_handle', parentHandleId: parent.handleId, rawReference: './child%20notes.md#L2' }
    assert.equal((await fileCall(second, 'open', childRequest)).ok, false)
    const childReply = await fileCall(first, 'open', childRequest)
    assert.equal(childReply.ok, true, JSON.stringify(childReply))
    const childFile = childReply.value.file
    assert.deepEqual(childFile.restoreRequest, { kind: 'camp_workspace', campId: fileCampId, rawReference: 'child notes.md' })
    await fileCall(first, 'release', { handleId: parent.handleId })
    assert.match((await fileCall(first, 'readText', { handleId: childFile.handleId, expectedGeneration: childFile.contentGeneration })).value.text, /Relative resource marker/)
    assert.equal((await fileCall(first, 'restore', childFile.restoreRequest)).ok, true)
    const located = await fileCall(first, 'open', { kind: 'camp_workspace', campId: fileCampId, rawReference: './child%20notes.md:2:3' })
    assert.equal(located.ok, true, JSON.stringify(located))
    const externalPath = join(fixture, 'external.md')
    await writeFile(externalPath, '# Exact external file')
    const external = await fileCall(first, 'open', { kind: 'camp_workspace', campId: fileCampId, rawReference: externalPath })
    assert.equal(external.ok, true, JSON.stringify(external))
    const preference = await call(first, 'notifications.preference.get')
    const preferenceParams = { commandId: crypto.randomUUID(), command: { expectedVersion: preference.version, headsUpEnabled: !preference.headsUpEnabled, ...Object.fromEntries(['approvalHeadsUpEnabled', 'userMentionHeadsUpEnabled', 'turnCompletedHeadsUpEnabled', 'turnIncompleteHeadsUpEnabled'].map(key => [key, preference[key]])) } }
    const changedPreference = await call(first, 'notifications.preference.update', preferenceParams)
    assert.equal(changedPreference.status, 'applied')
    assert.deepEqual((await call(second, 'notifications.preference.get')).headsUpEnabled, !preference.headsUpEnabled)
    assert.deepEqual((await call(first, 'commands.reconcile', { operation: 'notifications.preference.update', params: preferenceParams })).result, changedPreference)
    assert.equal((await call(first, 'notifications.inbox', { filter: 'unread', limit: 1 })).schemaVersion, 8)
    const exported = await call(first, 'diagnostics.export')
    assert.equal(exported.format, 'rovai-diagnostics-v5')
    assert.equal(JSON.stringify(exported).includes(administrator), false)
    assert.equal(JSON.stringify(exported).includes(fixture), false)
    const temporary = await call(first, 'camps.create', { ...createParams, commandId: crypto.randomUUID(), name: 'Temporary remote management Camp' })
    const temporaryId = temporary.payload.campId
    const temporaryCamp = (await call(first, 'camps.open', { campId: temporaryId, traceId: crypto.randomUUID() })).camp
    const renameParams = { commandId: crypto.randomUUID(), command: { campId: temporaryId, expectedVersion: temporaryCamp.version, title: 'Renamed remotely' } }
    const renamed = await call(first, 'camps.rename', renameParams)
    assert.equal(renamed.status, 'applied')
    assert.equal((await call(second, 'camps.open', { campId: temporaryId, traceId: crypto.randomUUID() })).camp.title, 'Renamed remotely')
    assert.deepEqual((await call(first, 'commands.reconcile', { operation: 'camps.rename', params: renameParams })).result, renamed)
    const deleteParams = { commandId: crypto.randomUUID(), command: { campId: temporaryId, expectedVersion: (await call(first, 'camps.open', { campId: temporaryId, traceId: crypto.randomUUID() })).camp.version, force: false } }
    const deleted = await call(first, 'camps.delete', deleteParams)
    assert.equal(deleted.status, 'accepted')
    assert.equal(await call(first, 'camps.exists', { campId: temporaryId }), false)
    assert.deepEqual((await call(first, 'commands.reconcile', { operation: 'camps.delete', params: deleteParams })).result, deleted, 'deleted Camp receipts remain queryable')
    const unusedBeforeRotation = await host.request('host.web.loginTicket')
    const rotated = await host.request('host.web.rotate')
    assert.equal((await exchange(unusedBeforeRotation.ticket)).status, 401)
    assert.notEqual(rotated.administratorToken, administrator)
    assert.equal((await authorized(first, 'capabilities')).status, 401)
    assert.equal((await authorized(second, 'capabilities')).status, 401)
    const expectClosed = reader => within((async () => { for (;;) { if ((await reader.read()).done) return true } })())
    assert.equal(await expectClosed(reader), true, 'rotation must close active SSE after draining prior invalidations')
    reader.releaseLock()
    for (const reader of otherReaders) {
      assert.equal(await expectClosed(reader), true, 'rotation must close every client stream')
      reader.releaseLock()
    }
    const rotatedLogin = await request('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 4, administratorToken: rotated.administratorToken }) })
    assert.equal(rotatedLogin.status, 200)
    const beforeStop = await rotatedLogin.json()
    const unusedBeforeStop = await host.request('host.web.loginTicket')
    assert.equal((await host.request('host.web.stop')).enabled, false)
    assert.equal((await host.request('host.web.token')).administratorToken, rotated.administratorToken, 'stopping the listener retains the latest local credential')
    assert.equal('administratorToken' in await host.request('host.web.status'), false)
    assert.equal(host.child.exitCode, null, 'stopping Web must leave Core alive')
    assert.equal((await host.request('app.info')).name, info.name)
    await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(2000) }))
    await assert.rejects(host.request('host.web.start', { listen: '0.0.0.0:0', uiDirectory: ownedUiDirectory }), { code: 'HOST_WEB_START_FAILED' })
    assert.equal((await host.request('host.web.status')).enabled, false)
    const restarted = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory: ownedUiDirectory })
    assert.equal(restarted.enabled, true)
    assert.equal(restarted.administratorToken, rotated.administratorToken, 'restart reuses the retained credential')
    assert.equal((await fetch(`${restarted.origin}/api/v1/login-ticket`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 4, ticket: unusedBeforeStop.ticket }) })).status, 401)
    assert.equal((await fetch(`${restarted.origin}/api/v1/capabilities`, { headers: { Authorization: `Bearer ${beforeStop.token}` } })).status, 401, 'old browser sessions cannot resume after stop')
    const beforeExitReply = await fetch(`${restarted.origin}/api/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 4, administratorToken: restarted.administratorToken }) })
    assert.equal(beforeExitReply.status, 200, 'the retained credential permits a fresh login')
    const beforeExit = await beforeExitReply.json()
    const reply = await host.request('core.shutdown', { protocolVersion: 3, deadlineMs: 10_000 })
    assert.equal(reply.controlledShutdownCyclePersisted, true)
    assert.equal((await within(host.closed)).code, 0)
    await assert.rejects(fetch(restarted.origin, { signal: AbortSignal.timeout(2000) }))
    assert.equal(host.unmatchedResponses.length, 0, 'Web correlation responses must never leak into Desktop stdout')
    assert.ok(!host.stderr().includes(administrator), 'management credentials must not enter logs')
    assert.ok(!host.stderr().includes(first.token), 'session credentials must not enter logs')
    const reopened = launch([...coreDataDirectoryArguments(dataDir), '--skill-library-root', join(dataDir, 'skills'), '--mcp-config-path', join(dataDir, 'mcp.json')])
    try {
      await within(reopened.ready)
      const reopenedWeb = await reopened.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory: ownedUiDirectory })
      assert.equal(reopenedWeb.administratorToken, restarted.administratorToken)
      const recoveredSession = await fetch(`${reopenedWeb.origin}/api/v1/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${beforeExit.token}` }, body: JSON.stringify({ editor: { clientId: beforeExit.clientId, proof: beforeExit.editorProof } }) })
      assert.equal(recoveredSession.status, 200, 'normal Host restart preserves the same Bearer and editor')
      const recoveredIdentity = await recoveredSession.json()
      assert.equal(recoveredIdentity.clientId, beforeExit.clientId)
      assert.equal(recoveredIdentity.expiresAt, beforeExit.expiresAt)
      for (const session of [first, second, beforeStop]) assert.equal((await fetch(`${reopenedWeb.origin}/api/v1/session/renew`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } })).status, 401, 'prior explicit revocations survive Host restart')
      assert.deepEqual(await reopened.request(defaultsMethod + 'get'), sharedDefaults)
      assert.deepEqual(await reopened.request(defaultsMethod + 'initialize', legacyDefaults), sharedDefaults)
      const path = join(dataDir, 'new-conversation-preferences.json')
      await writeFile(path, '{broken')
      await assert.rejects(reopened.request(defaultsMethod + 'get'), 'corrupt preferences cannot masquerade as an empty team')
    } finally { await reopened.close() }
    const disabled = launch([...coreDataDirectoryArguments(dataDir), '--skill-library-root', join(dataDir, 'skills'), '--mcp-config-path', join(dataDir, 'mcp.json')])
    try {
      await within(disabled.ready)
      // Explicit stop also revokes persisted Sessions before the first listener
      // start in a reopened Desktop Host, where credentials are still lazy.
      await disabled.request('host.web.stop')
      const afterDisable = await disabled.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory: ownedUiDirectory })
      assert.equal(afterDisable.administratorToken, restarted.administratorToken)
      assert.equal((await fetch(`${afterDisable.origin}/api/v1/capabilities`, { headers: { Authorization: `Bearer ${beforeExit.token}` } })).status, 401)
    } finally { await disabled.close() }
  } finally {
    controllers.forEach((controller) => controller.abort())
    await host.close()
    await removeEphemeralRuntimeCampFilesRoot(dataDir, { temporaryDirectory: fixture })
    await rm(fixture, { recursive: true, force: true })
  }
})

// This process owner proves that both Host entrances drive persisted schedules
// without a Renderer tick. The ordinary Delivery scheduler may leave the work
// waiting or claim it into an AgentRun; domain tests own execution and recovery.
test('Host clock consumes scheduled occurrences with Web stopped and in standalone mode', { timeout: 180_000 }, async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-host-clock-')))
  const dataDir = join(fixture, 'data')
  const args = [...coreDataDirectoryArguments(dataDir), '--skill-library-root', join(dataDir, 'skills'), '--mcp-config-path', join(dataDir, 'mcp.json')]
  console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir, skillLibraryRoot: join(dataDir, 'skills'), mcpConfigPath: join(dataDir, 'mcp.json'), runtime: false }))
  const desktop = launch(args)
  let standalone
  let database
  const startStandalone = async () => {
    const child = spawn(binary, ['run', ...args], { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    const collect = chunk => { log = (log + chunk).slice(-16_000) }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
    standalone = { child, closed }
    await within((async () => {
      while (!log.includes('Host Core is ready')) {
        assert.equal(child.exitCode, null, log)
        await pause(50)
      }
    })())
  }
  const stopStandalone = async () => {
    standalone.child.kill('SIGTERM')
    // This owner checks persisted scheduling, including reopening afterward.
    // Node's Windows SIGTERM is forced termination, not a console Ctrl-C event;
    // native controlled shutdown remains a separate, unqualified console seam.
    assert.deepEqual(await within(standalone.closed), process.platform === 'win32'
      ? { code: null, signal: 'SIGTERM' } : { code: 0, signal: null })
  }
  try {
    await within(desktop.ready)
    const [member] = await desktop.request('members.list')
    // Leave ten seconds of setup margin even just before a minute boundary.
    const firstAt = Math.ceil((Date.now() + 10_000) / 60_000) * 60_000
    const create = async (name, due) => {
      const date = new Date(due)
      const result = await desktop.request('automations.create', { commandId: crypto.randomUUID(), command: {
        name, prompt: 'Isolated scheduler acceptance; no configured Runtime.', memberId: member.agentId,
        projectRef: { kind: 'quick_chat' }, notifyChannels: [], schedule: { kind: 'once',
          date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
          at: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
      } })
      assert.equal(result.status, 'applied')
      return result.payload.automationId
    }
    const desktopId = await create('Desktop Host clock', firstAt)
    const standaloneId = await create('Standalone Host clock', firstAt + 60_000)
    const started = await desktop.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory })
    await desktop.request('host.web.stop')
    await assert.rejects(fetch(started.origin, { signal: AbortSignal.timeout(1000) }))
    database = new DatabaseSync(join(dataDir, 'rovai.sqlite'), { readOnly: true })
    const rows = id => database.prepare(`
      SELECT occurrence.status, occurrence.reason, occurrence.camp_id,
             occurrence.trigger_message_id, occurrence.trigger_delivery_id,
             delivery.status AS delivery_status,
             delivery.claimed_agent_run_id
      FROM automation_run AS occurrence
      LEFT JOIN camp_message_delivery AS delivery ON delivery.id = occurrence.trigger_delivery_id
      WHERE occurrence.automation_id = ?
    `).all(id)
    const waitForOccurrence = async (id, due) => {
      while (rows(id).length === 0 && Date.now() < due + 15_000) await pause(200)
      const runs = rows(id)
      assert.equal(runs.length, 1)
      assert.notEqual(runs[0].reason, 'missed', 'a live Host must claim the due occurrence')
      assert.equal(runs[0].status, 'running')
      assert.ok(runs[0].camp_id, 'an admitted occurrence owns a Camp')
      assert.ok(runs[0].trigger_message_id, 'an admitted occurrence owns its system message')
      assert.ok(runs[0].trigger_delivery_id, 'an admitted occurrence owns its Delivery')
      assert.ok(['waiting', 'claimed'].includes(runs[0].delivery_status))
      if (runs[0].delivery_status === 'claimed') {
        assert.ok(runs[0].claimed_agent_run_id, 'a claimed Delivery owns an AgentRun')
      } else {
        assert.equal(runs[0].claimed_agent_run_id, null, 'a waiting Delivery is not owned by an AgentRun')
      }
    }
    await waitForOccurrence(desktopId, firstAt)
    const reply = await desktop.request('core.shutdown', { protocolVersion: 3, deadlineMs: 10_000 })
    assert.equal(reply.controlledShutdownCyclePersisted, true)
    assert.equal((await within(desktop.closed)).code, 0)
    await startStandalone()
    await waitForOccurrence(standaloneId, firstAt + 60_000)
    await stopStandalone()
    await startStandalone()
    // Reopening past both due times cannot create a second occurrence.
    await pause(1200)
    assert.equal(rows(desktopId).length, 1)
    assert.equal(rows(standaloneId).length, 1)
    await stopStandalone()
  } finally {
    database?.close()
    if (standalone && standalone.child.exitCode === null && standalone.child.signalCode === null) {
      standalone.child.kill('SIGKILL'); await standalone.closed
    }
    await desktop.close()
    await removeEphemeralRuntimeCampFilesRoot(dataDir, { temporaryDirectory: fixture })
    await rm(fixture, { recursive: true, force: true })
  }
})

function launch(args) { return launchHost(binary, args, { cwd: repository }) }
