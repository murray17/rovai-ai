import { describe, expect, it, vi } from 'vitest'
import { ConsoleClient, InvalidationDecoder, SessionRequired } from './client'
import { newCommandId } from '../../desktop/src/shared/command-id'

// Owns browser credential routing and connection generations. Host HTTP tests
// cannot detect a client adding cookies, following a redirect, or accepting a
// late response from a replaced session.
describe('console transport', () => {
  it('uses Host channel capabilities and fences a channel reply across reauthentication', async () => {
    let pending: ((value: Response) => void) | undefined
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 4, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user', channels: 'desktop' })
      return new Promise(resolve => { pending = resolve })
    })
    const client = new ConsoleClient('http://127.0.0.1:4317', fetcher)
    expect(client.channels).toBe('unsupported')
    await client.login('b'.repeat(64)); expect(client.channels).toBe('desktop')
    const old = client.channel({ operation: 'retry', kind: 'dingtalk', agentId: 'original' })
    await client.login('b'.repeat(64))
    pending!(Response.json({ result: { schemaVersion: 4 } }))
    await expect(old).rejects.toMatchObject({ name: 'AbortError' })
    for (const [code, expected] of [
      ['channel_session_expired', '请在运行此服务的 Rovai Desktop 中重新连接账号'],
      ['channel_operation_failed', '请重新读取发布状态']
    ]) {
      const next = client.channel({ operation: 'get' })
      pending!(Response.json({ error: { code } }, { status: 503 }))
      await expect(next).rejects.toThrow(expected)
    }
    client.clear()
  })

  it('sends the Lark provider kind unchanged for publish and retry', async () => {
    const bodies: unknown[] = []
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 4, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user', channels: 'desktop' })
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ result: { schemaVersion: 4 } })
    })
    const client = new ConsoleClient('http://127.0.0.1:4317', fetcher)
    await client.login('b'.repeat(64))
    await client.channel({ operation: 'publish', kind: 'lark', agentId: 'agent-a' })
    await client.channel({ operation: 'retry', kind: 'lark', agentId: 'agent-a' })
    expect(bodies).toEqual([
      { operation: 'publish', kind: 'lark', agentId: 'agent-a' },
      { operation: 'retry', kind: 'lark', agentId: 'agent-a' }
    ])
    client.clear()
  })

  it('rejects an incompatible Host before installing credentials or admitting business requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ protocolVersion: 2, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' }))
    const client = new ConsoleClient('http://127.0.0.1:4317', fetcher)
    await expect(client.login('b'.repeat(64))).rejects.toThrow('协议')
    await expect(client.request('app.info')).rejects.toBeInstanceOf(SessionRequired)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).protocolVersion).toBe(4)
    const session = { protocolVersion: 4, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' }
    fetcher.mockResolvedValue(Response.json(session))
    await client.login('b'.repeat(64))
    const scope = client.editingScope
    fetcher.mockResolvedValue(Response.json({ ...session, clientId: 'f'.repeat(64) }))
    await expect(client.login('b'.repeat(64))).rejects.toThrow('编辑归属')
    expect(client.authenticated).toBe(false)
    expect(client.editingScope).toBe(scope)
  })

  it('keeps credentials in explicit headers on the fixed origin and rejects old generations', async () => {
    const token = 'a'.repeat(64)
    let delayed: ((value: Response) => void) | undefined
    let delayedLogout: ((value: Response) => void) | undefined
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async function (this: typeof globalThis, url, options) {
      expect(this).toBe(globalThis)
      if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 4, token, clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
      if (String(url).endsWith('/logout')) return new Promise<Response>(resolve => { delayedLogout = resolve })
      if (String(url).endsWith('/request') && JSON.parse(String(options?.body)).params.delayed) {
        return new Promise<Response>((resolve) => { delayed = resolve })
      }
      return Response.json({ result: { name: 'Rovai' } })
    })
    const client = new ConsoleClient('http://127.0.0.1:4317', fetcher)
    await expect(client.request('app.info')).rejects.toBeInstanceOf(SessionRequired)
    await client.login('b'.repeat(64))
    const scope = client.editingScope
    const old = client.request('app.info', { delayed: true })
    await client.login('c'.repeat(64))
    expect(client.editingScope).toBe(scope)
    const resumed = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/login')).at(-1)
    expect(JSON.parse(String(resumed?.[1]?.body)).editor).toEqual({ clientId: 'd'.repeat(64), proof: 'e'.repeat(64) })
    delayed!(new Response('', { status: 401 }))
    await expect(old).rejects.toMatchObject({ name: 'AbortError' })
    await expect(client.request('app.info')).resolves.toEqual({ name: 'Rovai' })
    const oldLogout = client.logout()
    await client.login('c'.repeat(64))
    delayedLogout!(new Response(null, { status: 204 }))
    await expect(oldLogout).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.authenticated).toBe(true)
    for (const [url, options] of fetcher.mock.calls) {
      expect(new URL(String(url)).origin).toBe('http://127.0.0.1:4317')
      expect(new URL(String(url)).search).toBe('')
      expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' })
      const authorization = new Headers(options?.headers).get('Authorization')
      expect(authorization).toBe(String(url).endsWith('/login') ? null : `Bearer ${token}`)
    }
    client.clear()
    await expect(client.request('app.info')).rejects.toBeInstanceOf(SessionRequired)
  })

  it('decodes chunked LF and CRLF invalidations without treating comments or other events as data', () => {
    for (const separator of ['\n', '\r\n']) {
      const source = `:keepalive${separator}${separator}event: resync${separator}data: {}${separator}${separator}event: private${separator}data: secret${separator}${separator}`
      // Every split owns a framing boundary, including the middle of CRLF.
      for (let split = 0; split <= source.length; split++) {
        const decoder = new InvalidationDecoder()
        const first = decoder.push(source.slice(0, split))
        const second = decoder.push(source.slice(split))
        expect(first || second).toBe(true)
        expect(decoder.push(`:keepalive${separator}${separator}`)).toBe(false)
      }
    }
    expect(() => new InvalidationDecoder().push('x'.repeat(65_537))).toThrow('超出限制')
  })

  it('retains an unknown command across reauthentication and only looks up its original receipt', async () => {
    let recorded = false
    const params = { commandId: newCommandId(), campId: 'test', draftRevision: 4, execution: null }
    const result = { commandResult: { status: 'applied', payload: { campMessageId: 'once' } } }
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 4, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
      const body = JSON.parse(String(options?.body))
      if (body.operation === 'camp.messages.send') throw new TypeError('connection lost after admission')
      expect(body).toEqual({ operation: 'commands.reconcile', params: { operation: 'camp.messages.send', params } })
      return Response.json({ result: recorded ? { state: 'recorded', result } : { state: 'unknown' } })
    })
    const client = new ConsoleClient('http://127.0.0.1:4317', fetcher)
    await client.login('b'.repeat(64))
    let settled = false
    const pending = client.request('camp.messages.send', params).then(value => { settled = true; return value })
    await vi.waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(settled).toBe(false)
    expect(client.pendingCommandCount).toBe(1)
    const scope = client.editingScope
    client.clear()
    recorded = true
    await client.login('b'.repeat(64))
    await client.reconcilePending()
    await expect(pending).resolves.toEqual(result)
    expect(client.editingScope).toBe(scope)
    expect(client.pendingCommandCount).toBe(0)
    expect(fetcher.mock.calls.filter(([, init]) => init?.body && JSON.parse(String(init.body)).operation === 'camp.messages.send')).toHaveLength(1)
  })

  it('resumes an unknown source binding without uploading another file', async () => {
    let bound = false
    let intent: unknown
    const draft = { campId: 'test', draftId: 'test/editor', revision: 2, attachments: [{ id: 'bound' }] }
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 4, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
      if (String(url).endsWith('/uploads')) {
        intent = JSON.parse(String((options?.body as FormData).get('intent')))
        expect(intent).toMatchObject({ campId: 'test', expectedRevision: 1, displayName: 'input.txt', byteSize: 5 })
        throw new TypeError('response lost after binding')
      }
      expect(String(url)).toMatch(/\/uploads\/reconcile$/)
      expect(JSON.parse(String(options?.body))).toEqual(intent)
      return Response.json(bound ? { draft } : { state: 'unknown' })
    })
    const client = new ConsoleClient('http://127.0.0.1:4317', fetcher)
    await client.login('b'.repeat(64))
    const pending = client.uploadFile('test', 1, new File(['input'], 'input.txt'))
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/uploads/reconcile'))).toBe(true))
    client.clear(); bound = true
    await client.login('b'.repeat(64))
    await client.reconcilePending()
    await expect(pending).resolves.toEqual(draft)
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/uploads'))).toHaveLength(1)
  })

  it('settles a recorded quote rejection after a lost reply without dispatching it twice', async () => {
    let recorded = false
    let sends = 0
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 4, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
      const body = JSON.parse(String(options?.body))
      if (body.operation === 'messageQuotes.mutateDraft') { sends++; throw new TypeError('reply lost after rejection was recorded') }
      expect(body.operation).toBe('commands.reconcile')
      return Response.json({ result: recorded ? { state: 'recorded', error: { code: 'draft_changed', message: 'draft_changed' } } : { state: 'unknown' } })
    })
    const client = new ConsoleClient('http://127.0.0.1:4317', fetcher)
    await client.login('b'.repeat(64))
    const pending = client.request('messageQuotes.mutateDraft', { commandId: newCommandId(), command: {} }).then(() => 'unexpected success', error => error)
    await vi.waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(client.pendingCommandCount).toBe(1)
    recorded = true
    await client.reconcilePending()
    expect(await pending).toMatchObject({ code: 'draft_changed' })
    expect(client.pendingCommandCount).toBe(0)
    expect(sends).toBe(1)
  })

  it('uses secure random bytes when an HTTP LAN browser has no randomUUID', () => {
    const getRandomValues = vi.fn<Crypto['getRandomValues']>().mockImplementation(value => { new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(255); return value })
    expect(newCommandId({ getRandomValues: getRandomValues as Crypto['getRandomValues'] })).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    expect(getRandomValues).toHaveBeenCalledOnce()
    expect(() => newCommandId({} as Crypto)).toThrow('安全随机数')
  })

  it('only an explicit retry can resend an unknown command and reuses its original payload', async () => {
    const params = { commandId: newCommandId(), campId: 'test', draftRevision: 4, execution: null }
    const original = structuredClone(params)
    let sends = 0
    let allowRetry = false
    const result = { commandResult: { status: 'applied' }, replayed: true }
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 4, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
      const body = JSON.parse(String(options?.body))
      if (body.operation === 'commands.reconcile') return Response.json({ result: { state: 'unknown' } })
      expect(body).toEqual({ operation: 'camp.messages.send', params: original })
      sends++
      if (!allowRetry) throw new TypeError('connection lost before dispatch or reply')
      return Response.json({ result })
    })
    const client = new ConsoleClient('http://127.0.0.1:4317', fetcher)
    await client.login('b'.repeat(64))
    const pending = client.request('camp.messages.send', params)
    await vi.waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(3))
    params.draftRevision = 99
    params.campId = 'later-ui-state'
    await client.login('b'.repeat(64))
    await client.reconcilePending()
    expect(sends).toBe(1)
    allowRetry = true
    await client.retryPending()
    await expect(pending).resolves.toEqual(result)
    expect(sends).toBe(2)
    expect(client.pendingCommandCount).toBe(0)
  })
})

describe('tab session recovery', () => {
  const memory = () => {
    const values = new Map<string, string>()
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  }
  const identity = { protocolVersion: 4, token: 'a'.repeat(64), clientId: 'b'.repeat(64), editorProof: 'c'.repeat(64), ownerId: 'local_user', channels: 'desktop' }
  it('exchanges a scan ticket only in POST and retains this tab editor but never a copied editor', async () => {
    const storage = memory()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(identity))
    const first = new ConsoleClient('http://localhost:4317', fetcher, storage)
    await first.login('d'.repeat(64))
    storage.setItem('rovai.web.edits.v1', 'original unsaved text')
    const next = new ConsoleClient('http://localhost:4317', fetcher, storage)
    const assertTab = vi.fn(async () => undefined)
    fetcher.mockClear()
    await next.restore(false, assertTab, false)
    expect(fetcher).not.toHaveBeenCalled()
    await next.loginTicket('e'.repeat(64))
    expect(next.editingScope).toBe(first.editingScope)
    expect(assertTab).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe('http://localhost:4317/api/v1/login-ticket')
    const options = fetcher.mock.calls[0][1]!
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store' })
    expect(JSON.parse(String(options.body))).toEqual({ protocolVersion: 4, ticket: 'e'.repeat(64), editor: { clientId: identity.clientId, proof: identity.editorProof } })
    expect(storage.getItem('rovai.web.session.v1')).not.toContain('e'.repeat(64))
    expect(storage.getItem('rovai.web.edits.v1')).toBe('original unsaved text')
    const copy = new ConsoleClient('http://localhost:4317', fetcher, storage)
    await copy.restore(true, async () => undefined, false)
    fetcher.mockResolvedValue(Response.json({ ...identity, token: 'f'.repeat(64), clientId: 'f'.repeat(64) }))
    await copy.loginTicket('e'.repeat(64))
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]?.body)).editor).toBeUndefined()
    expect(copy.editingScope).not.toBe(first.editingScope)
    expect(storage.getItem('rovai.web.edits.v1')).toBeNull()
    fetcher.mockResolvedValue(Response.json({ error: { code: 'login_ticket_invalid' } }, { status: 401 }))
    await expect(copy.loginTicket('e'.repeat(64))).rejects.toThrow('过期或已使用')
    expect(copy.authenticated).toBe(false)
  })
  it('validates the saved Bearer and proof before restoring the same editor; logout keeps editing but removes authentication', async () => {
    const storage = memory()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith('/logout') ? new Response(null, { status: 204 }) : Response.json(identity))
    const first = new ConsoleClient('http://localhost:4317', fetcher, storage)
    await first.login('d'.repeat(64))
    expect(storage.getItem('rovai.web.session.v1')).not.toContain('d'.repeat(64))
    const next = new ConsoleClient('http://localhost:4317', fetcher, storage)
    expect(next.authenticated).toBe(false)
    expect(await next.restore()).toBe(true)
    expect(next.editingScope).toBe(first.editingScope)
    const [, options] = fetcher.mock.calls.at(-1)!
    expect(JSON.parse(String(options?.body))).toEqual({ editor: { clientId: identity.clientId, proof: identity.editorProof }, fork: false })
    expect(new Headers(options?.headers).get('Authorization')).toBe(`Bearer ${identity.token}`)
    await next.logout()
    const loggedOut = new ConsoleClient('http://localhost:4317', fetcher, storage)
    expect(await loggedOut.restore()).toBe(false)
    expect(loggedOut.editingScope).toBe(first.editingScope)
    await loggedOut.login('d'.repeat(64))
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]?.body)).editor.clientId).toBe(identity.clientId)
  })
  it('forks copied recovery materials without retaining the source drafts or revoking its Session, including expired copies', async () => {
    for (const expires of [false, true]) {
      const storage = memory()
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(identity))
      await new ConsoleClient('http://localhost:4317', fetcher, storage).login('d'.repeat(64))
      storage.setItem('rovai.web.edits.v1', 'source unsaved text')
      fetcher.mockResolvedValue(expires ? Response.json({}, { status: 401 }) : Response.json({ ...identity, token: 'e'.repeat(64), clientId: 'f'.repeat(64) }))
      const copy = new ConsoleClient('http://localhost:4317', fetcher, storage)
      expect(await copy.restore(true)).toBe(!expires)
      expect(storage.getItem('rovai.web.edits.v1')).toBeNull()
      expect(storage.getItem('rovai.web.session.v1') ?? '').not.toContain(identity.clientId)
      expect(copy.editingScope).toBe(expires ? null : 'http://localhost:4317/local_user/' + 'f'.repeat(64))
      expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/logout'))).toBe(false)
    }
  })
  it('restores unknown command identities and only reconciles on startup; explicit retry reuses exact payload', async () => {
    const storage = memory()
    let recorded = false
    const dispatches: unknown[] = []
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (!String(url).endsWith('/request')) return Response.json(identity)
      const request = JSON.parse(String(options?.body))
      if (request.operation === 'commands.reconcile') return Response.json({ result: recorded ? { state: 'recorded', result: { ok: true } } : { state: 'unknown' } })
      dispatches.push(request.params)
      throw new TypeError('response lost')
    })
    const first = new ConsoleClient('http://localhost:4317', fetcher, storage)
    await first.login('d'.repeat(64))
    const params = { commandId: newCommandId(), campId: 'original', draftRevision: 7 }
    void first.request('camp.messages.send', params)
    await vi.waitFor(() => expect(dispatches).toHaveLength(1))
    const next = new ConsoleClient('http://localhost:4317', fetcher, storage)
    await next.restore()
    expect(next.pendingCommandCount).toBe(1)
    expect(dispatches).toHaveLength(1)
    await expect(next.request('camp.messages.send', { ...params, commandId: newCommandId() })).rejects.toThrow('原提交')
    await next.retryPending()
    expect(dispatches).toEqual([params, params])
    recorded = true
    await vi.waitFor(async () => { await next.reconcilePending(); expect(next.pendingCommandCount).toBe(0) })
    expect(JSON.parse(storage.getItem('rovai.web.session.v1')!).pending).toEqual([])
  })
})

// Extends the browser auth owner with a controlled wall clock and shared durable
// store. No timers, network sockets, real Token or thirty-day waits are involved.
describe('renewable browser authentication', () => {
  const origin = 'http://localhost:4317'
  const day = 86_400_000
  const identity = { protocolVersion: 4, token: 'a'.repeat(64), clientId: 'b'.repeat(64), editorProof: 'c'.repeat(64), ownerId: 'owner' }
  const memory = () => {
    const values = new Map<string, string>()
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  }
  const durable = () => {
    let value: import('./auth-storage').BrowserSession | null = null
    return {
      read: async () => value && structuredClone(value),
      async write(next: import('./auth-storage').BrowserSession, expected?: string, current = () => true) { if (current() && (expected === undefined || value === null || value.token === expected)) value = structuredClone(next) },
      async remove(token: string) { if (value?.token === token) value = null }
    }
  }
  it('renews only inside the seven-day window, keeps the Bearer/editor and coalesces concurrent requests', async () => {
    let now = 1_800_000_000_000
    let expiry = now + 30 * day
    let finish: (() => void) | undefined
    const timing = () => ({ serverTime: now, expiresAt: expiry, renewalWindowSeconds: 604800 })
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/login')) return Response.json({ ...identity, ...timing() })
      if (String(url).endsWith('/session/renew')) {
        await new Promise<void>(resolve => { finish = resolve })
        expiry = now + 30 * day
        return Response.json(timing())
      }
      return Response.json({ result: { name: 'Rovai' } })
    })
    const storage = memory(), auth = durable()
    const client = new ConsoleClient(origin, fetcher, storage, auth, () => now)
    await client.login('d'.repeat(64))
    const scope = client.editingScope
    let changes = 0; client.onAuthenticationChanged(() => { changes++ })
    now = expiry - 7 * day - 1
    await client.request('app.info')
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/session/renew'))).toHaveLength(0)
    now++
    const first = client.request('app.info'), second = client.request('app.info')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/session/renew'))).toHaveLength(1)
    finish!()
    await Promise.all([first, second])
    expect(client.editingScope).toBe(scope)
    expect(changes).toBe(0)
    expect(await auth.read()).toMatchObject({ token: identity.token, expiresAt: now + 30 * day })
    expect(storage.getItem('rovai.web.session.v1')).not.toContain(identity.token)
    expect(JSON.stringify(await auth.read())).not.toContain('d'.repeat(64))
    expect(JSON.stringify(await auth.read())).not.toContain(identity.editorProof)
    for (const [url, options] of fetcher.mock.calls) {
      if (!String(url).endsWith('/login')) expect(new Headers(options?.headers).get('Authorization')).toBe(`Bearer ${identity.token}`)
    }
  })
  it.each(['network', 'storage'] as const)('keeps a valid Session on %s renewal failure and retries with the same Bearer', async failure => {
    let now = 1_800_000_000_000
    const expiry = now + 30 * day
    let unavailable = true
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/login')) return Response.json({ ...identity, serverTime: now, expiresAt: expiry, renewalWindowSeconds: 604800 })
      if (String(url).endsWith('/session/renew')) {
        if (unavailable) { if (failure === 'network') throw new TypeError('offline'); return Response.json({ error: { code: 'session_storage_unavailable' } }, { status: 503 }) }
        return Response.json({ serverTime: now, expiresAt: now + 30 * day, renewalWindowSeconds: 604800 })
      }
      return Response.json({ result: 'usable' })
    })
    const auth = durable(), client = new ConsoleClient(origin, fetcher, memory(), auth, () => now)
    await client.login('d'.repeat(64)); now = expiry - 7 * day
    await expect(client.request('app.info')).resolves.toBe('usable')
    await client.renewIfNeeded()
    expect(client.authenticated).toBe(true)
    expect((await auth.read())?.token).toBe(identity.token)
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/session/renew'))).toHaveLength(1)
    unavailable = false; now += 60_000
    await client.renewIfNeeded()
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/session/renew'))).toHaveLength(2)
    expect((await auth.read())?.expiresAt).toBe(now + 30 * day)
  })
  it('rejects true expiry, preserves drafts and reauthenticates using the original long Token', async () => {
    let now = 1_800_000_000_000
    const expiry = now + 30 * day
    let logins = 0
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/login')) { logins++; return Response.json({ ...identity, token: logins === 1 ? identity.token : 'e'.repeat(64), serverTime: now, expiresAt: now + 30 * day, renewalWindowSeconds: 604800 }) }
      return Response.json({ error: { code: 'session_required' } }, { status: 401 })
    })
    const storage = memory(), auth = durable(), client = new ConsoleClient(origin, fetcher, storage, auth, () => now)
    await client.login('d'.repeat(64)); const scope = client.editingScope
    storage.setItem('rovai.web.edits.v1', 'unsent draft')
    now = expiry
    await expect(client.renewIfNeeded()).rejects.toBeInstanceOf(SessionRequired)
    expect(client.authenticated).toBe(false); expect(await auth.read()).toBeNull()
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/session/renew'))).toBe(false)
    expect(storage.getItem('rovai.web.edits.v1')).toBe('unsent draft')
    await client.login('d'.repeat(64)); expect(client.editingScope).toBe(scope)
    const loginsBody = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/login')).map(([, options]) => JSON.parse(String(options?.body)))
    expect(loginsBody[1]).toMatchObject({ administratorToken: loginsBody[0].administratorToken, editor: { clientId: identity.clientId, proof: identity.editorProof } })
  })
  it('opens a fresh browser editor from durable auth and preserves each tab draft through reload and logout', async () => {
    const now = 1_800_000_000_000
    const timing = { serverTime: now, expiresAt: now + 30 * day, renewalWindowSeconds: 604800 }
    const child = { ...identity, token: 'e'.repeat(64), clientId: 'f'.repeat(64), editorProof: '1'.repeat(64) }
    const fetcher = vi.fn<typeof fetch>(async (url, options) => {
      if (String(url).endsWith('/login')) return Response.json({ ...identity, ...timing })
      if (String(url).endsWith('/logout')) return new Response(null, { status: 204 })
      const body = JSON.parse(String(options?.body))
      return Response.json({ ...(body.fork ? child : identity), ...timing })
    })
    const auth = durable(), tabA = memory(), tabB = memory()
    const first = new ConsoleClient(origin, fetcher, tabA, auth, () => now)
    await first.login('d'.repeat(64)); tabA.setItem('rovai.web.edits.v1', 'draft A')
    const other = new ConsoleClient(origin, fetcher, tabB, auth, () => now)
    expect(await other.restore()).toBe(true)
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toEqual({ fork: true })
    expect(other.editingScope).not.toBe(first.editingScope)
    expect(tabB.getItem('rovai.web.edits.v1')).toBeNull()
    tabB.setItem('rovai.web.edits.v1', 'draft B')
    const reload = new ConsoleClient(origin, fetcher, tabA, auth, () => now)
    expect(await reload.restore()).toBe(true)
    expect(reload.editingScope).toBe(first.editingScope)
    expect(tabA.getItem('rovai.web.edits.v1')).toBe('draft A')
    // A same-tab restore must not take over the other tab's durable candidate.
    // Logout revokes only this Bearer, never the newer independent tab.
    expect((await auth.read())?.token).toBe(child.token)
    await reload.logout()
    expect((await auth.read())?.token).toBe(child.token)
    expect(other.authenticated).toBe(true); expect(tabB.getItem('rovai.web.edits.v1')).toBe('draft B')
    const loggedOut = new ConsoleClient(origin, fetcher, tabA, auth, () => now)
    expect(await loggedOut.restore()).toBe(false)
  })
  it('retains browser credentials after an offline reopen and can retry without a long Token', async () => {
    const auth = durable(), tab = memory()
    const now = 1_800_000_000_000
    await auth.write({ version: 1, origin, token: identity.token, ownerId: identity.ownerId, expiresAt: now + 30 * day })
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue(Response.json({ ...identity, serverTime: now, expiresAt: now + 30 * day, renewalWindowSeconds: 604800 }))
    const client = new ConsoleClient(origin, fetcher, tab, auth, () => now)
    await expect(client.restore()).rejects.toThrow('offline')
    expect((await auth.read())?.token).toBe(identity.token)
    expect(await client.restore()).toBe(true)
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/login'))).toBe(false)
  })
  it('migrates a legacy tab Bearer before an offline validation without losing its editor or login', async () => {
    const tab = memory(), auth = durable()
    tab.setItem('rovai.web.session.v1', JSON.stringify({ version: 1, origin, token: identity.token, editor: { clientId: identity.clientId, proof: identity.editorProof }, ownerId: identity.ownerId }))
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(Response.json(identity))
    const client = new ConsoleClient(origin, fetcher, tab, auth)
    await expect(client.restore()).rejects.toThrow('offline')
    expect(JSON.parse(tab.getItem('rovai.web.session.v1')!)).toMatchObject({ version: 2, editor: { clientId: identity.clientId } })
    expect(tab.getItem('rovai.web.session.v1')).not.toContain(identity.token)
    const reopened = new ConsoleClient(origin, fetcher, tab, auth)
    expect(await reopened.restore()).toBe(true)
    expect((await auth.read())?.token).toBe(identity.token)
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toEqual({ editor: { clientId: identity.clientId, proof: identity.editorProof }, fork: false })
  })
  it('notifies logout and removes durable auth even when tab storage becomes unavailable', async () => {
    const tab = memory(), auth = durable()
    const fetcher = vi.fn<typeof fetch>(async url => String(url).endsWith('/login') ? Response.json(identity) : new Response(null, { status: 204 }))
    const client = new ConsoleClient(origin, fetcher, tab, auth)
    await client.login('d'.repeat(64))
    const notified = vi.fn(); client.onAuthenticationChanged(notified)
    tab.setItem = () => { throw new Error('storage unavailable') }
    await expect(client.logout()).rejects.toThrow('storage unavailable')
    expect(client.authenticated).toBe(false); expect(notified).toHaveBeenCalledOnce()
    expect(await auth.read()).toBeNull()
  })
  it('fences a renewal reply after logout and keeps a failed logout retryable', async () => {
    let now = 1_800_000_000_000
    const expiry = now + 30 * day
    let finish: ((value: Response) => void) | undefined
    let offline = true
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/login')) return Response.json({ ...identity, serverTime: now, expiresAt: expiry, renewalWindowSeconds: 604800 })
      if (String(url).endsWith('/session/renew')) return new Promise(resolve => { finish = resolve })
      if (offline) throw new TypeError('offline')
      return new Response(null, { status: 204 })
    })
    const auth = durable(), client = new ConsoleClient(origin, fetcher, memory(), auth, () => now)
    await client.login('d'.repeat(64)); now = expiry - 7 * day
    await expect(client.logout()).rejects.toThrow('退出未完成')
    expect(client.authenticated).toBe(true)
    const renewing = client.renewIfNeeded()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    offline = false; await client.logout()
    finish!(Response.json({ serverTime: now, expiresAt: now + 30 * day, renewalWindowSeconds: 604800 }))
    await renewing
    expect(client.authenticated).toBe(false); expect(await auth.read()).toBeNull()
  })
})
