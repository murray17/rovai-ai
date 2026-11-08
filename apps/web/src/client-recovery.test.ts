import { describe, expect, it, vi } from 'vitest'
import { ConsoleClient } from './client'
import type { ThreadReadInvalidation } from '@contracts'
import { RECOVERY_KEY } from './tab-recovery'
import { newCommandId } from '../../desktop/src/shared/command-id'

const identity = { protocolVersion: 5, token: 'a'.repeat(64), clientId: 'b'.repeat(64), editorProof: 'c'.repeat(64), ownerId: 'owner' }
const origin = 'http://localhost:4317'
const storage = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
const command = () => ({ commandId: newCommandId(), threadId: 'original', body: 'original text', execution: null })
const unknown = () => Response.json({ result: { state: 'unknown' } })
const rpc = (init?: RequestInit) => JSON.parse(String(init?.body)) as { operation: string; params: ReturnType<typeof command> }

// Owns the client recovery transaction, not Core's idempotency implementation.
// Controlled response loss distinguishes unknown receipts from known failures.
describe('global Web connection recovery', () => {
  it('submits different native questions concurrently while rejecting a duplicate before sending', async () => {
    let finishFirst: ((response: Response) => void) | undefined
    const dispatched: string[] = []
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/login')) return Response.json(identity)
      const request = JSON.parse(String(init?.body)) as { operation: string; params: { interactionId: string } }
      if (request.operation !== 'nativeInteractions.respond') return Response.json({ result: {} })
      dispatched.push(request.params.interactionId)
      if (request.params.interactionId === 'first') return new Promise<Response>(resolve => { finishFirst = resolve })
      return Response.json({ result: { status: 'sent' } })
    })
    const client = new ConsoleClient(origin, fetcher, storage())
    await client.login('test')
    const answer = (interactionId: string) => ({ commandId: newCommandId(), threadId: 'thread', agentRunId: `run-${interactionId}`,
      executionEpoch: 1, interactionId, answer: { kind: 'input', value: 'answer' } })
    const first = client.request('nativeInteractions.respond', answer('first'))
    await vi.waitFor(() => expect(dispatched).toEqual(['first']))
    await expect(client.request('nativeInteractions.respond', answer('first'))).rejects.toMatchObject({ requestNotSent: true })
    expect(dispatched).toEqual(['first'])
    await expect(client.request('nativeInteractions.respond', answer('second'))).resolves.toEqual({ status: 'sent' })
    expect(dispatched).toEqual(['first', 'second'])
    expect(client.pendingCommandCount).toBe(1)
    finishFirst!(Response.json({ result: { status: 'sent' } }))
    await expect(first).resolves.toEqual({ status: 'sent' })
    expect(client.pendingCommandCount).toBe(0)
    client.clear()
  })

  it.each([
    { code: 'request_capacity', status: 429 },
    { code: 'operation_not_admitted', status: 503 },
    { code: 'workspace_not_authorized', status: 403 }
  ])('allows another attempt after a fresh native answer is not admitted: $code', async ({ code, status }) => {
    let rejected = true
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/login')) return Response.json(identity)
      return rejected ? Response.json({ error: { code } }, { status }) : Response.json({ result: { status: 'sent' } })
    })
    const client = new ConsoleClient(origin, fetcher, storage())
    await client.login('test')
    const params = { commandId: newCommandId(), threadId: 'thread', agentRunId: 'run', executionEpoch: 1,
      interactionId: 'question', answer: { kind: 'input', value: 'draft' } }
    await expect(client.request('nativeInteractions.respond', params)).rejects.toMatchObject({ code, requestNotSent: true })
    expect(client.pendingCommandCount).toBe(0)
    expect(client.connectionState).toBe('live')
    rejected = false
    await expect(client.request('nativeInteractions.respond', { ...params, commandId: newCommandId() })).resolves.toEqual({ status: 'sent' })
    client.clear()
  })

  it('blocks new operations after a stopped service, preserves the original and explicitly retries it once', async () => {
    let available = true
    const saved = storage()
    const dispatches: unknown[] = []
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/login')) return Response.json(identity)
      if (!available) throw new TypeError('service stopped')
      const request = rpc(init)
      if (request.operation === 'commands.reconcile') return unknown()
      if (request.operation === 'thread.messages.send') dispatches.push(request.params)
      return Response.json({ result: { ok: true } })
    })
    const client = new ConsoleClient(origin, fetcher, saved)
    await client.login('test')
    available = false
    const params = command(), original = structuredClone(params)
    const pending = client.request('thread.messages.send', params)
    await vi.waitFor(() => expect(client.connectionState).toBe('offline'))
    params.body = 'later unsent text'
    const before = fetcher.mock.calls.length
    await expect(client.request('threads.create', command())).rejects.toThrow('恢复连接')
    await expect(client.files('read', {})).rejects.toThrow('恢复连接')
    await expect(client.avatar('save', {})).rejects.toThrow('恢复连接')
    expect(fetcher.mock.calls.length).toBe(before)
    expect(client.pendingCommandCount).toBe(1)
    expect(JSON.parse(saved.getItem(RECOVERY_KEY)!).pending[0].params).toEqual(original)
    await expect(client.retryPending()).rejects.toThrow('service stopped')
    expect(client.authenticated).toBe(true)
    available = true
    await client.retryPending()
    await expect(pending).resolves.toEqual({ ok: true })
    expect(dispatches).toEqual([original])
    expect(client.connectionState).toBe('live')
    expect(client.pendingCommandCount).toBe(0)
    await client.request('thread.messages.send', { ...command(), threadId: 'another conversation' })
    expect(dispatches).toHaveLength(2)
    client.clear()
  })

  it.each(['thread.messages.send', 'nativeInteractions.respond'] as const)('recovers %s after response loss without resending or clearing unrelated draft storage', async operation => {
    const saved = storage()
    saved.setItem('rovai.web.edits.v1', 'unsent draft')
    let recorded = false, sends = 0
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/login')) return Response.json(identity)
      const request = rpc(init)
      if (request.operation === operation) { sends++; throw new TypeError('reply lost') }
      if (request.operation === 'commands.reconcile') return recorded ? Response.json({ result: { state: 'recorded', result: { id: 'original-result' } } }) : unknown()
      return Response.json({ result: {} })
    })
    const client = new ConsoleClient(origin, fetcher, saved)
    await client.login('test')
    const pending = client.request(operation, command())
    await vi.waitFor(() => expect(client.connectionState).toBe('offline'))
    recorded = true
    await client.retryPending()
    await expect(pending).resolves.toEqual({ id: 'original-result' })
    expect(sends).toBe(1)
    expect(saved.getItem('rovai.web.edits.v1')).toBe('unsent draft')
    expect(JSON.parse(saved.getItem(RECOVERY_KEY)!).pending).toEqual([])
    client.clear()
  })

  it('settles a definitive Core rejection during retry and releases both the original promise and recovery gate', async () => {
    let sends = 0
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/login')) return Response.json(identity)
      const request = rpc(init)
      if (request.operation === 'commands.reconcile') return unknown()
      if (request.operation === 'thread.messages.send') {
        if (++sends === 1) throw new TypeError('lost')
        return Response.json({ error: { code: 'draft_changed', message: '草稿已变化' } })
      }
      return Response.json({ result: {} })
    })
    const client = new ConsoleClient(origin, fetcher)
    await client.login('test')
    const settled = client.request('thread.messages.send', command()).catch(error => error)
    await vi.waitFor(() => expect(client.connectionState).toBe('offline'))
    await client.retryPending()
    expect(await settled).toMatchObject({ code: 'draft_changed' })
    expect(client.pendingCommandCount).toBe(0)
    expect(client.connectionState).toBe('live')
    await expect(client.request('thread.messages.send', command())).rejects.toThrow('草稿已变化')
    expect(client.pendingCommandCount).toBe(0)
    client.clear()
  })

  it('waits for an already-running receipt lookup and coalesces repeated recovery clicks', async () => {
    let release: ((response: Response) => void) | undefined
    let sends = 0
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/login')) return Response.json(identity)
      const request = rpc(init)
      if (request.operation === 'commands.reconcile') return new Promise(resolve => { release = resolve })
      if (request.operation === 'thread.messages.send') { sends++; throw new TypeError('lost after commit') }
      return Response.json({ result: {} })
    })
    const client = new ConsoleClient(origin, fetcher)
    await client.login('test')
    const pending = client.request('thread.messages.send', command())
    await vi.waitFor(() => expect(release).toBeDefined())
    const first = client.retryPending(), second = client.retryPending()
    expect(first).toBe(second)
    await Promise.resolve()
    expect(sends).toBe(1)
    release!(Response.json({ result: { state: 'recorded', result: 'original' } }))
    await first
    await expect(pending).resolves.toBe('original')
    expect(sends).toBe(1)
    client.clear()
  })

  it('does not treat rejection of a retry at Host admission as proof that the earlier command failed', async () => {
    let sends = 0, recorded = false
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/login')) return Response.json(identity)
      const request = rpc(init)
      if (request.operation === 'commands.reconcile') return recorded ? Response.json({ result: { state: 'recorded', result: 'original' } }) : unknown()
      if (request.operation === 'thread.messages.send') {
        if (++sends === 1) throw new TypeError('lost')
        return Response.json({ error: { code: 'request_capacity' } }, { status: 429 })
      }
      return Response.json({ result: {} })
    })
    const client = new ConsoleClient(origin, fetcher)
    await client.login('test')
    const pending = client.request('thread.messages.send', command())
    await vi.waitFor(() => expect(client.connectionState).toBe('offline'))
    await expect(client.retryPending()).rejects.toThrow('恢复连接')
    expect(client.pendingCommandCount).toBe(1)
    recorded = true
    await client.retryPending()
    await expect(pending).resolves.toBe('original')
    expect(sends).toBe(2)
    client.clear()
  })

  it('reports SSE disconnects and reconnects promptly on recovery without dispatching a command', async () => {
    const streams: ReadableStreamDefaultController<Uint8Array>[] = []
    const states: string[] = []
    const changes: ThreadReadInvalidation[] = []
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/login')) return Response.json(identity)
      if (String(url).endsWith('/events')) return new Response(new ReadableStream({ start(controller) { streams.push(controller) } }))
      return Response.json({ result: {} })
    })
    const client = new ConsoleClient(origin, fetcher)
    await client.login('test')
    const unsubscribe = client.subscribe(change => changes.push(change), state => states.push(state))
    await vi.waitFor(() => expect(states.at(-1)).toBe('live'))
    streams[0].enqueue(new TextEncoder().encode('event: invalidate\ndata: {"teamsChanged":true,"referencesChanged":true}\n\nevent: invalidate\ndata: {"messages":[]}\n\n'))
    await vi.waitFor(() => expect(changes).toEqual([{ resync: false, teamsChanged: true, referencesChanged: true, messages: [] }]))
    streams[0].close()
    await vi.waitFor(() => expect(states.at(-1)).toBe('offline'))
    await client.retryPending()
    await vi.waitFor(() => expect(streams).toHaveLength(2))
    expect(states.at(-1)).toBe('live')
    streams[1].enqueue(new TextEncoder().encode('event: resync\ndata: {}\n\n'))
    await vi.waitFor(() => expect(changes.at(-1)?.resync).toBe(true))
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/request')).map(([, init]) => rpc(init).operation)).toEqual(['app.info'])
    unsubscribe(); streams[1].close(); client.clear()
  })

  it('opens recovery when a successful HTTP response loses its body', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).endsWith('/login') ? Response.json(identity)
      : new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('truncated body')) } })))
    const client = new ConsoleClient(origin, fetcher)
    await client.login('test')
    await expect(client.request('app.info')).rejects.toThrow('truncated body')
    expect(client.connectionState).toBe('offline')
    client.clear()
  })

  it('keeps new operations blocked while an automatic SSE reconnect is still opening', async () => {
    let attempts = 0
    let first: ReadableStreamDefaultController<Uint8Array> | undefined
    let second: ReadableStreamDefaultController<Uint8Array> | undefined
    let open: ((response: Response) => void) | undefined
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/login')) return Response.json(identity)
      if (++attempts === 1) return new Response(new ReadableStream({ start(controller) { first = controller } }))
      return new Promise(resolve => { open = resolve })
    })
    const client = new ConsoleClient(origin, fetcher)
    await client.login('test')
    const unsubscribe = client.subscribe(() => undefined, () => undefined)
    await vi.waitFor(() => expect(first).toBeDefined())
    first!.close()
    await vi.waitFor(() => expect(open).toBeDefined(), { timeout: 2000 })
    expect(client.connectionState).toBe('offline')
    await expect(client.request('threads.create', command())).rejects.toThrow('恢复连接')
    expect(client.pendingCommandCount).toBe(0)
    open!(new Response(new ReadableStream({ start(controller) { second = controller } })))
    await vi.waitFor(() => expect(client.connectionState).toBe('live'))
    unsubscribe(); second!.close(); client.clear()
  })

  it('ignores an old HTTP error body arriving after reauthentication', async () => {
    let body: ReadableStreamDefaultController<Uint8Array> | undefined
    const fetcher = vi.fn<typeof fetch>(async url => String(url).endsWith('/login') ? Response.json(identity)
      : new Response(new ReadableStream({ start(controller) { body = controller } }), { status: 503 }))
    const client = new ConsoleClient(origin, fetcher)
    await client.login('test')
    const old = client.request('app.info')
    await vi.waitFor(() => expect(body).toBeDefined())
    await client.login('test')
    body!.enqueue(new TextEncoder().encode('{"error":{"code":"core_unavailable"}}')); body!.close()
    await expect(old).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.connectionState).toBe('live')
    client.clear()
  })

  it('settles a definitive upload rejection on retry instead of trapping the page', async () => {
    let uploads = 0
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/login')) return Response.json(identity)
      if (String(url).endsWith('/uploads')) {
        if (++uploads === 1) throw new TypeError('lost')
        return Response.json({ error: { code: 'draft_changed' } }, { status: 409 })
      }
      return Response.json({ result: {}, state: 'unknown' })
    })
    const client = new ConsoleClient(origin, fetcher)
    await client.login('test')
    const pending = client.uploadFile('t', 1, new File(['original'], 'test.txt')).catch(error => error)
    await vi.waitFor(() => expect(client.connectionState).toBe('offline'))
    await client.retryPending()
    expect(await pending).toMatchObject({ code: 'draft_changed' })
    expect(client.pendingCommandCount).toBe(0)
    expect(client.connectionState).toBe('live')
    client.clear()
  })

  it.each([undefined, { kind: 'pasted_text' as const }])('keeps an unknown upload intent after refresh and reuses it on exact-file selection (%j)', async target => {
    const saved = storage(), intents: unknown[] = []
    let completed = false
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/login') || String(url).endsWith('/session')) return Response.json(identity)
      if (String(url).endsWith('/uploads')) {
        intents.push(JSON.parse(String((init?.body as FormData).get('intent'))))
        if (!completed) throw new TypeError('lost')
        return Response.json({ draft: { id: 'source', displayName: 'test.txt', sourcePath: '/fixture/test.txt', kind: 'file', mediaType: 'text/plain', observedByteSize: 8 } })
      }
      return Response.json({ result: {}, state: 'unknown' })
    })
    const first = new ConsoleClient(origin, fetcher, saved)
    await first.login('test')
    void first.uploadFile('t', 1, new File(['original'], 'test.txt'), target)
    await vi.waitFor(() => expect(first.connectionState).toBe('offline'))
    const restored = new ConsoleClient(origin, fetcher, saved)
    await restored.restore()
    expect(await restored.retryPending()).toBe(true)
    expect(restored.connectionState).toBe('live')
    expect(restored.pendingCommandCount).toBe(1)
    expect(JSON.parse(saved.getItem(RECOVERY_KEY)!).uploads).toEqual(intents)
    completed = true
    await restored.uploadFile('t', 99, new File(['original'], 'test.txt'), target)
    expect(intents).toHaveLength(2)
    expect(intents[1]).toEqual(intents[0])
    expect(restored.pendingCommandCount).toBe(0)
    restored.clear()
  })
})
