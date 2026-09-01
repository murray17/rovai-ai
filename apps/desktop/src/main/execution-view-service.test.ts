import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import type { CoreEvent, CoreMethod } from '@contracts'
import { ExecutionViewService, selectPrivateLanAddress, type ExecutionViewScope } from './execution-view-service'
import { ExecutionWebSettingsStore, parseExecutionWebSettings } from './execution-web-settings'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('Execution Web settings', () => {
  it('accepts only the exact persisted schema and private port range', () => {
    expect(parseExecutionWebSettings({ schemaVersion: 1, enabled: true, port: 8765 }))
      .toEqual({ schemaVersion: 1, enabled: true, port: 8765 })
    expect(parseExecutionWebSettings({ schemaVersion: 1, enabled: true, port: 80 })).toBeNull()
    expect(parseExecutionWebSettings({ schemaVersion: 1, enabled: true, port: 8765, extra: true })).toBeNull()
  })

  it('defaults a missing settings file to enabled without overriding a saved choice', async () => {
    const root = await tempRoot()
    const path = join(root, 'execution-web.json')

    const firstUseStore = await ExecutionWebSettingsStore.load(path)
    expect(firstUseStore.get()).toEqual({ schemaVersion: 1, enabled: true, port: 8765 })
    expect(firstUseStore.loadDegradation).toBeNull()

    await writeFile(path, JSON.stringify({ schemaVersion: 1, enabled: false, port: 18765 }), 'utf8')
    const returningUserStore = await ExecutionWebSettingsStore.load(path)
    expect(returningUserStore.get()).toEqual({ schemaVersion: 1, enabled: false, port: 18765 })
    expect(returningUserStore.loadDegradation).toBeNull()
  })

  it('fails closed to disabled defaults when the saved file is malformed', async () => {
    const root = await tempRoot()
    const path = join(root, 'execution-web.json')
    await writeFile(path, '{"schemaVersion":1,"enabled":true,"port":80}', 'utf8')
    const store = await ExecutionWebSettingsStore.load(path)
    expect(store.get()).toEqual({ schemaVersion: 1, enabled: false, port: 8765 })
    expect(store.loadDegradation?.code).toBe('execution_web_settings_invalid')
  })

  it('fails closed to disabled defaults when the saved file is unreadable', async () => {
    const root = await tempRoot()
    const path = join(root, 'execution-web.json')
    await mkdir(path)
    const store = await ExecutionWebSettingsStore.load(path)
    expect(store.get()).toEqual({ schemaVersion: 1, enabled: false, port: 8765 })
    expect(store.loadDegradation?.code).toBe('execution_web_settings_unreadable')
  })
})

describe('ExecutionViewService', () => {
  it('selects only deterministic RFC1918 addresses and ignores virtual interfaces', () => {
    expect(selectPrivateLanAddress({
      lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: true, cidr: '127.0.0.1/8' }],
      utun4: [{ address: '10.0.0.9', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: false, cidr: '10.0.0.9/8' }],
      en7: [{ address: '172.20.0.4', netmask: '255.255.0.0', family: 'IPv4', mac: '', internal: false, cidr: '172.20.0.4/16' }],
      en0: [{ address: '192.168.1.23', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '192.168.1.23/24' }],
      public0: [{ address: '203.0.113.5', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '203.0.113.5/24' }]
    })).toBe('192.168.1.23')
  })

  it('keeps the default enabled without opening a port until a channel Bot is published', async () => {
    const root = await tempRoot()
    const settingsFilePath = join(root, 'execution-web.json')
    let addressResolutionCount = 0
    const service = new ExecutionViewService({
      settingsFilePath,
      resolveAddress: () => {
        addressResolutionCount += 1
        return null
      },
      core: {
        onEvent() { return () => undefined },
        async request<T>(): Promise<T> { return coreSnapshot() as T }
      }
    })

    try {
      await service.start()
      expect(service.getSettings()).toEqual({
        schemaVersion: 1,
        enabled: true,
        port: 8765,
        server: {
          state: 'no_published_bot',
          address: null,
          errorCode: 'execution_web_no_published_bot'
        }
      })
      expect(addressResolutionCount).toBe(0)

      await service.setPublishedChannelBotAvailable(true)
      expect(service.getSettings()).toEqual({
        schemaVersion: 1,
        enabled: true,
        port: 8765,
        server: {
          state: 'no_lan_address',
          address: null,
          errorCode: 'execution_web_no_lan_address'
        }
      })
      expect(addressResolutionCount).toBe(1)
      await expect(readFile(settingsFilePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await service.stop()
    }
  })

  it('serves a no-store page and an immutable scoped public snapshot with a bearer token', async () => {
    const root = await tempRoot()
    const port = await availablePort()
    const settingsFilePath = join(root, 'execution-web.json')
    await writeFile(settingsFilePath, JSON.stringify({ schemaVersion: 1, enabled: false, port }), 'utf8')
    const calls: unknown[] = []
    let eventListener: ((event: CoreEvent) => void) | null = null
    let address: string | null = '127.0.0.1'
    const tokens = [
      'fixed-token-with-at-least-thirty-two-characters',
      'replacement-token-with-at-least-thirty-two-characters'
    ]
    const service = new ExecutionViewService({
      settingsFilePath,
      resolveAddress: () => address,
      randomToken: () => tokens.shift()!,
      core: {
        onEvent(listener) {
          eventListener = listener
          return () => { eventListener = null }
        },
        async request<T>(_method: CoreMethod, params?: unknown): Promise<T> {
          calls.push(structuredClone(params))
          return coreSnapshot() as T
        }
      }
    })
    await service.setPublishedChannelBotAvailable(true)
    await service.start()
    await service.setSettings({ enabled: true, port })
    const scope: ExecutionViewScope = {
      channelConversationId: 'channel-original',
      targetAppId: 'app-a',
      campId: 'camp-a',
      agentId: 'agent-a',
      focusRunId: 'run-a',
      maxRunCreatedAt: '2026-09-01T00:00:00Z'
    }
    const href = await service.createExecutionViewUrl(scope)
    expect(href).toBe(`http://127.0.0.1:${port}/execution/run-a#t=fixed-token-with-at-least-thirty-two-characters`)
    scope.channelConversationId = 'mutated'

    const page = await fetch(href!.split('#')[0])
    expect(page.status).toBe(200)
    expect(page.headers.get('cache-control')).toBe('no-store')
    expect(page.headers.get('connection')).toBe('close')
    const pageHtml = await page.text()
    expect(pageHtml).toContain('<meta name="viewport"')
    expect(pageHtml).toContain('data-brand-mark="horizon"')
    expect(pageHtml).toContain('run-disclosure')
    expect(pageHtml).toContain('tool-group')
    expect(pageHtml).toContain('command-disclosure')
    expect(pageHtml).toContain("if (nonTerminal(run)) return '处理过程'")
    expect(pageHtml).not.toContain('nonTerminal(run) ? Date.now()')
    expect(pageHtml).not.toContain('局域网视图')
    expect(pageHtml).not.toContain('飞书成员')
    const pageScript = pageHtml.match(/<script>([\s\S]*)<\/script>/)?.[1]
    expect(pageScript).toBeTruthy()
    expect(() => new Script(pageScript!)).not.toThrow()

    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/execution/run-a/snapshot`)
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.get('connection')).toBe('close')
    const response = await fetch(`http://127.0.0.1:${port}/api/execution/run-a/snapshot`, {
      headers: { Authorization: 'Bearer fixed-token-with-at-least-thirty-two-characters' }
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('connection')).toBe('close')
    const publicSnapshot = await response.json()
    expect(publicSnapshot).toMatchObject({
      schemaVersion: 1,
      focusRunId: 'run-a',
      terminal: false,
      runs: [{
        id: 'run-a',
        trigger: { authorDisplayName: '你', channelLabel: '' },
        items: [{
          kind: 'activityGroup',
          status: 'completed',
          statusLabel: '全部成功',
          primary: '已执行 1 项操作',
          activities: [{
            iconKind: 'unknown',
            title: 'pnpm test',
            status: 'completed',
            statusLabel: '已完成'
          }]
        }, { kind: 'narration', body: '公开正文' }]
      }]
    })
    expect(JSON.stringify(publicSnapshot)).not.toContain('private-stdout-token')
    expect(calls[0]).toMatchObject({ channelConversationId: 'channel-original' })
    expect(eventListener).not.toBeNull()

    address = null
    expect(await service.createExecutionViewUrl({ ...scope, channelConversationId: 'channel-offline' }))
      .toBeNull()
    expect(service.getSettings().server).toMatchObject({ state: 'no_lan_address', address: null })

    address = '127.0.0.1'
    const nextHref = await service.createExecutionViewUrl({ ...scope, channelConversationId: 'channel-next' })
    expect(nextHref).toBe(`http://127.0.0.1:${port}/execution/run-a#t=replacement-token-with-at-least-thirty-two-characters`)
    expect(service.getSettings().server).toMatchObject({ state: 'ready', address: `127.0.0.1:${port}` })
    expect((await fetch(`http://127.0.0.1:${port}/api/execution/run-a/snapshot`, {
      headers: { Authorization: 'Bearer fixed-token-with-at-least-thirty-two-characters' }
    })).status).toBe(401)
    const reboundPage = await fetch(nextHref!.split('#')[0])
    expect(reboundPage.status).toBe(200)
    await reboundPage.text()

    await service.setPublishedChannelBotAvailable(false)
    expect(service.getSettings()).toMatchObject({
      enabled: true,
      port,
      server: { state: 'no_published_bot', address: null }
    })
    expect(await service.createExecutionViewUrl(scope)).toBeNull()

    await service.stop()
    expect(eventListener).toBeNull()
    expect(JSON.parse(await readFile(join(root, 'execution-web.json'), 'utf8')))
      .toEqual({ schemaVersion: 1, enabled: true, port })
  })

  it('coalesces live execution events into a refreshed SSE snapshot', async () => {
    const root = await tempRoot()
    const port = await availablePort()
    const eventListeners = new Set<(event: CoreEvent) => void>()
    let requestCount = 0
    const snapshot = coreSnapshot() as {
      runs: Array<{ evidence: Array<{ payload: { delta?: string } }> }>
    }
    const service = new ExecutionViewService({
      settingsFilePath: join(root, 'execution-web.json'),
      resolveAddress: () => '127.0.0.1',
      randomToken: () => 'live-refresh-token-with-at-least-thirty-two-characters',
      core: {
        onEvent(listener) {
          eventListeners.add(listener)
          return () => { eventListeners.delete(listener) }
        },
        async request<T>(): Promise<T> {
          requestCount += 1
          return structuredClone(snapshot) as T
        }
      }
    })
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    try {
      await service.setPublishedChannelBotAvailable(true)
      await service.start()
      await service.setSettings({ enabled: true, port })
      const href = await service.createExecutionViewUrl({
        channelConversationId: 'channel-a',
        targetAppId: 'app-a',
        campId: 'camp-a',
        agentId: 'agent-a',
        focusRunId: 'run-a',
        maxRunCreatedAt: '2026-09-01T00:00:00Z'
      })
      const stream = await fetch(`http://127.0.0.1:${port}/api/execution/run-a/events`, {
        headers: { Authorization: `Bearer ${new URL(href!).hash.slice(3)}` }
      })
      reader = stream.body!.getReader()
      expect((await reader.read()).done).toBe(false)

      snapshot.runs[0].evidence[1].payload.delta = '自动更新后的正文'
      for (const method of ['agent.text.delta', 'activity.started', 'activity.completed']) {
        for (const listener of eventListeners) {
          listener({ method, params: { agentRunId: 'run-a' } })
        }
      }
      const update = await readWithin(reader, 1_000)
      expect(update).not.toBeNull()
      if (!update || update.done) throw new Error('execution_web_live_refresh_timeout')
      expect(new TextDecoder().decode(update.value)).toContain('自动更新后的正文')
      expect(requestCount).toBe(2)
    } finally {
      await reader?.cancel()
      await service.stop()
    }
  })

  it('does not drift to another port when the configured port is occupied', async () => {
    const root = await tempRoot()
    const originalPort = await availablePort()
    let occupiedPort = await availablePort()
    while (occupiedPort === originalPort) occupiedPort = await availablePort()
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(occupiedPort, '127.0.0.1', resolve))
    const settingsFilePath = join(root, 'execution-web.json')
    await writeFile(
      settingsFilePath,
      JSON.stringify({ schemaVersion: 1, enabled: false, port: originalPort }),
      'utf8'
    )
    const service = new ExecutionViewService({
      settingsFilePath,
      resolveAddress: () => '127.0.0.1',
      randomToken: () => 'fixed-token-with-at-least-thirty-two-characters',
      core: {
        onEvent() { return () => undefined },
        async request<T>(): Promise<T> { return coreSnapshot() as T }
      }
    })
    try {
      await service.setPublishedChannelBotAvailable(true)
      await service.start()
      expect((await service.setSettings({ enabled: true, port: originalPort })).server.state).toBe('ready')
      const href = await service.createExecutionViewUrl({
        channelConversationId: 'channel-a',
        targetAppId: 'app-a',
        campId: 'camp-a',
        agentId: 'agent-a',
        focusRunId: 'run-a',
        maxRunCreatedAt: '2026-09-01T00:00:00Z'
      })!
      const stream = await fetch(`http://127.0.0.1:${originalPort}/api/execution/run-a/events`, {
        headers: { Authorization: 'Bearer fixed-token-with-at-least-thirty-two-characters' }
      })
      const reader = stream.body!.getReader()
      expect((await reader.read()).done).toBe(false)
      const snapshot = await service.setSettings({ enabled: true, port: occupiedPort })
      expect(snapshot).toMatchObject({
        enabled: true,
        port: occupiedPort,
        server: { state: 'port_conflict', address: null }
      })
      expect((await reader.read()).done).toBe(true)
      expect(href).toContain(`:${originalPort}/execution/run-a#t=`)
      expect(await service.createExecutionViewUrl({
        channelConversationId: 'channel-a',
        targetAppId: 'app-a',
        campId: 'camp-a',
        agentId: 'agent-a',
        focusRunId: 'run-a',
        maxRunCreatedAt: '2026-09-01T00:00:00Z'
      })).toBeNull()
      expect(JSON.parse(await readFile(join(root, 'execution-web.json'), 'utf8')))
        .toEqual({ schemaVersion: 1, enabled: true, port: occupiedPort })
    } finally {
      await service.stop()
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rovai-execution-web-test-'))
  temporaryDirectories.push(root)
  return root
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test_port_unavailable')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

async function readWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  milliseconds: number
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), milliseconds)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function coreSnapshot(): unknown {
  return {
    schemaVersion: 1,
    focusRunId: 'run-a',
    camp: { id: 'camp-a', title: '产品讨论' },
    agent: { id: 'agent-a', displayName: '叮叮' },
    runs: [{
      id: 'run-a',
      campTurnId: 'turn-a',
      purpose: '公开触发消息',
      invocationKind: 'channel',
      status: 'running',
      waitReason: null,
      terminalReasonCode: null,
      version: 1,
      createdAt: '2026-09-01T00:00:00Z',
      startedAt: '2026-09-01T00:00:01Z',
      endedAt: null,
      trigger: {
        summary: '公开触发消息',
        authorDisplayName: 'Murray',
        channelLabel: '飞书',
        createdAt: '2026-09-01T00:00:00Z'
      },
      evidence: [{
        id: 'evidence-command',
        agentRunId: 'run-a',
        executionEpoch: 1,
        sequence: 1,
        eventType: 'activity.completed',
        kind: 'command',
        phase: 'completed',
        payload: {
          item: {
            type: 'commandExecution',
            command: 'pnpm test',
            status: 'completed',
            aggregatedOutput: 'tests passed\nAuthorization: Bearer private-stdout-token'
          }
        },
        contentBlobId: null,
        contentByteCount: 64,
        isTruncated: false,
        occurredAt: '2026-09-01T00:00:02Z',
        canonical: null
      }, {
        id: 'evidence-a',
        agentRunId: 'run-a',
        executionEpoch: 1,
        sequence: 2,
        eventType: 'agent.text.delta',
        kind: 'narration',
        phase: 'updated',
        payload: { itemId: 'message-a', delta: '公开正文' },
        contentBlobId: null,
        contentByteCount: 12,
        isTruncated: false,
        occurredAt: '2026-09-01T00:00:03Z',
        canonical: null
      }],
      publicOutput: null,
      fileChanges: null
    }]
  }
}
