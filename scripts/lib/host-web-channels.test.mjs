import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { launchHost, within } from './host-test-client.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './runtime-camp-files-root.mjs'
import { createHostChannelHandler, parseHostChannelRequest } from '../../apps/desktop/src/main/host-channels.ts'

const root = resolve(import.meta.dirname, '../..')
const uiDirectory = process.env.ROVAI_WEB_UI ?? join(root, 'out/web')
const binary = process.env.ROVAI_HOST_BIN ?? join(root, 'target/debug', process.platform === 'win32' ? 'rovai-host.exe' : 'rovai-host')

// Real Axum/auth/Host/parent pipe and production Main adapter; platform service
// is a controlled fixture, no real account login or Bot publication occurs.
test('Hosted channels use the closed parent adapter and survive browser logout and Web stop', { timeout: 60_000 }, async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-host-channels-')))
  const data = process.platform === 'win32'
    ? JSON.parse(execFileSync(binary, ['--prepare-windows-data-root', join(fixture, 'formal')], { encoding: 'utf8' })).core
    : join(fixture, 'data')
  const skills = join(fixture, 'skills')
  await mkdir(skills)
  console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir: data, skillLibraryRoot: skills, mcpConfigPath: join(data, 'mcp.json'), runtime: false, platformService: 'fixture' }))
  const host = launchHost(binary, [...coreDataDirectoryArguments(data), '--skill-library-root', skills, '--mcp-config-path', join(data, 'mcp.json')], { cwd: fixture })
  const snapshot = { schemaVersion: 4, channels: [], pendingBindingCount: 0, bindingIssueCount: 0, activeQrAttempt: null, activeProvisioning: null }
  const calls = []
  const releases = []
  const settled = []
  let fail = null
  const service = {
    async get() { await host.request('app.info'); return { ...snapshot, cookie: 'fixture-secret-do-not-expose' } },
    async publishMemberBot(agentId, kind) {
      calls.push(['publish', agentId, kind])
      await new Promise(resolve => releases.push(resolve))
      await host.request('app.info') // Same Core must remain available.
      settled.push(agentId)
      return snapshot
    },
    async retryMemberBot(agentId, kind) { calls.push(['retry', agentId, kind]); if (fail) throw new Error(fail); return snapshot },
    async selectPublicationApprover(agentId, userId, kind) { calls.push(['select', agentId, userId, kind]); return snapshot }
  }
  const handler = createHostChannelHandler(service)
  const callbacks = []
  host.onNotification(message => {
    if (message.method !== 'host.channels.request') return
    callbacks.push((async () => {
      const request = parseHostChannelRequest(message.params.request)
      assert.ok(request)
      const reply = await handler(request)
      await host.request('host.channels.reply', { requestId: message.params.requestId, reply })
    })())
  })
  let browserRequest
  try {
    await within(host.ready)
    let web = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory })
    const entry = await fetch(`${web.origin}/`)
    assert.equal(entry.headers.get('cache-control'), 'no-store')
    assert.match(await entry.text(), /name="rovai-host-kind" content="desktop"/)
    const login = async () => {
      const reply = await fetch(`${web.origin}/api/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 4, administratorToken: web.administratorToken }) })
      assert.equal(reply.status, 200)
      const result = await reply.json(); assert.equal(result.channels, 'desktop'); return result
    }
    const request = (session, body, extra = {}) => fetch(`${web.origin}/api/v1/channels`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}), ...extra }, body: JSON.stringify(body) })
    let first = await login(), second = await login()
    for (const operation of ['get', 'check', 'download', 'install']) {
      assert.equal((await fetch(`${web.origin}/api/v1/updates`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${first.token}` }, body: JSON.stringify({ operation, version: '999.0.0' }) })).status, 501, 'Desktop never exposes an updater to its browser')
    }
    assert.equal((await request(null, { operation: 'get' })).status, 401)
    assert.equal((await request(first, { operation: 'get' }, { Origin: 'http://other-device.invalid' })).status, 403)
    for (const body of [{ operation: 'connect' }, { operation: 'get', method: 'shell.open' }, { operation: 'publish', agentId: 'a', kind: 'other' }, { operation: 'selectApprover', agentId: 'a', userId: 'u', kind: 'feishu' }]) {
      assert.equal((await request(first, body)).status, 400)
    }
    const read = await request(first, { operation: 'get' })
    assert.equal(read.status, 200)
    assert.deepEqual(await read.json(), { result: snapshot, error: null })
    assert.deepEqual(calls, [])
    assert.equal((await request(first, { operation: 'retry', agentId: 'original-agent', kind: 'feishu' })).status, 200)
    assert.equal((await request(first, { operation: 'selectApprover', agentId: 'original-agent', userId: 'chosen-approver', kind: 'dingtalk' })).status, 200)
    assert.deepEqual(calls, [['retry', 'original-agent', 'feishu'], ['select', 'original-agent', 'chosen-approver', 'dingtalk']])
    for (const [reason, expected] of [
      ['dingtalk_open_platform_timeout', 'channel_operation_failed'],
      ['fixture Cookie=must-not-be-relayed', 'channel_operation_failed'],
      ['dingtalk_developer_session_expired', 'channel_session_expired'],
      ['feishu_developer_session_expired', 'channel_session_expired'],
      ['feishu_developer_identity_changed', 'channel_session_expired']
    ]) {
      fail = reason
      const response = await request(first, { operation: 'retry', agentId: 'original-agent', kind: 'dingtalk' })
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: { code: expected } })
    }
    fail = null
    browserRequest = request(first, { operation: 'publish', agentId: 'after-logout', kind: 'feishu' }); void browserRequest.catch(() => {})
    await within((async () => { while (releases.length < 1) await delay(10) })())
    assert.equal((await fetch(`${web.origin}/api/v1/logout`, { method: 'POST', headers: { Authorization: `Bearer ${first.token}` } })).status, 204)
    assert.equal((await request(first, { operation: 'get' })).status, 401)
    assert.equal((await request(second, { operation: 'get' })).status, 200)
    releases.shift()(); await browserRequest
    assert.deepEqual(settled, ['after-logout'])
    browserRequest = request(second, { operation: 'publish', agentId: 'after-web-stop', kind: 'dingtalk' }); void browserRequest.catch(() => {})
    await within((async () => { while (releases.length < 1) await delay(10) })())
    await host.request('host.web.stop')
    releases.shift()()
    await within((async () => { while (settled.length < 2) await delay(10) })())
    assert.deepEqual(settled, ['after-logout', 'after-web-stop'])
    await browserRequest.catch(() => {})
    web = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory })
    first = await login()
    assert.equal((await request(first, { operation: 'get' })).status, 200)
    await Promise.all(callbacks)
  } finally {
    for (const release of releases) release()
    await browserRequest?.catch(() => {})
    await host.close()
    await removeEphemeralRuntimeCampFilesRoot(data)
    await rm(fixture, { recursive: true, force: true })
  }
})
