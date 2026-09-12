import { describe, expect, it, vi } from 'vitest'
import { ConsoleClient, InvalidationDecoder, SessionRequired } from './client'
import { newCommandId } from '../../desktop/src/shared/command-id'

// Owns browser credential routing and connection generations. Host HTTP tests
// cannot detect a client adding cookies, following a redirect, or accepting a
// late response from a replaced session.
describe('console transport', () => {
  it('rejects an incompatible Host before installing credentials or admitting business requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ protocolVersion: 1, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' }))
    const client = new ConsoleClient('http://127.0.0.1:4317', fetcher)
    await expect(client.login('b'.repeat(64))).rejects.toThrow('协议')
    await expect(client.request('app.info')).rejects.toBeInstanceOf(SessionRequired)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).protocolVersion).toBe(2)
    const session = { protocolVersion: 2, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' }
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
      if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 2, token, clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
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
      if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 2, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
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
      if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 2, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
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
      if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 2, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
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
      if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 2, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
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
