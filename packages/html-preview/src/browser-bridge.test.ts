import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { previewBrowserBridge } from './browser-bridge'
import { HtmlPreviewHostChannel } from './host-channel'
import { parseHtmlPreviewDiagnostic } from './protocol'
import { createFileFindDomIndex } from './find-dom'

const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).forEach(close => close()); vi.useRealTimers(); vi.unstubAllGlobals() })

// Exercise the production page bridge and host validation together. The fixture
// substitutes DOM surfaces and only the HTTP transport; the clock is deterministic.
function fixture(fetcher: typeof fetch) {
  vi.useFakeTimers()
  const preview = { previewId: 'p', generation: 'g', origin: 'http://preview.localhost:9000',
    entryUrl: 'http://preview.localhost:9000/start', documentUrl: 'http://preview.localhost:9000/index.html' }
  const host = Object.assign(new EventTarget(), { location: { origin: 'http://app.localhost:8000' } })
  const frame = Object.assign(new EventTarget(), {
    postMessage(this: EventTarget, data: unknown) {
      const target = this
      queueMicrotask(() => {
        const event = new Event('message')
        Object.assign(event, { data, source: target === host ? frame : host,
          origin: target === host ? preview.origin : host.location.origin })
        target.dispatchEvent(event)
      })
    }
  })
  const document = Object.assign(new EventTarget(), { readyState: 'complete', body: {}, querySelectorAll: () => [],
    currentScript: { getAttribute: () => '/__rovai-preview/bridge/root.js' } })
  for (const [key, value] of Object.entries({ window: frame, parent: host, document, crypto: webcrypto, fetch: fetcher,
    addEventListener: frame.addEventListener.bind(frame), MutationObserver: class { observe() {} disconnect() {} }, scrollTo: vi.fn() })) vi.stubGlobal(key, value)
  const channel = new HtmlPreviewHostChannel(preview, () => frame as unknown as Window)
  const messages: Record<string, unknown>[] = []
  channel.subscribe(message => messages.push(message))
  const detach = channel.attach(host as unknown as Window)
  const close = () => { frame.dispatchEvent(new Event('pagehide')); detach() }
  cleanup.push(close)
  previewBrowserBridge({ ...preview, documentId: 'root', hostOrigin: host.location.origin,
    map: { line: 1, column: 1, length: 0 }, documentError: null }, createFileFindDomIndex, parseHtmlPreviewDiagnostic)
  const policy = (patch: Record<string, unknown> = {}) => {
    const event = new Event('securitypolicyviolation')
    const { isTrusted = true, ...fields } = patch
    Object.assign(event, { effectiveDirective: 'connect-src', disposition: 'enforce',
      blockedURI: preview.origin + '/__rovai-preview/events?documentId=root',
      sourceFile: preview.origin + '/__rovai-preview/bridge/root.js', ...fields })
    Object.defineProperty(event, 'isTrusted', { value: isTrusted })
    document.dispatchEvent(event)
  }
  return { channel, messages, close, preview, frame, host, policy }
}

function responseStream(signal: AbortSignal) {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
  signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true })
  return { response: new Response(body), controller }
}

it('recovers only HTTP diagnostics and preserves the page channel, errors and commands', async () => {
  let stream!: ReturnType<typeof responseStream>
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockImplementation(async (_url, options) => {
    stream = responseStream(options!.signal!); return stream.response
  })
  const { channel, messages, preview } = fixture(fetcher)
  await vi.advanceTimersByTimeAsync(0)
  expect(channel.connected).toBe(true)
  expect(messages).toContainEqual(expect.objectContaining({ type: 'state', document: 'loaded' }))
  expect(messages.at(-1)).toMatchObject({ type: 'server-diagnostics', state: 'unavailable' })
  expect(messages.some(message => message.type === 'channel-unavailable' || message.type === 'diagnostic')).toBe(false)
  channel.connect() // A same-document handshake neither starts a new stream nor resets the delay.
  await vi.advanceTimersByTimeAsync(999)
  expect(fetcher).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(messages.at(-1)).toMatchObject({ type: 'server-diagnostics', state: 'connected' })
  stream.controller.enqueue(new TextEncoder().encode(JSON.stringify({ previewId: preview.previewId, generation: preview.generation,
    kind: 'resource', message: 'HTTP 404', resourceUrl: preview.origin + '/missing.css', status: 404,
    line: null, column: null, stack: null, timestamp: new Date().toISOString() }) + '\n'))
  await vi.advanceTimersByTimeAsync(0)
  const diagnostics = messages.filter(message => message.type === 'diagnostic')
  expect(diagnostics).toHaveLength(1)
  stream.controller.close()
  await vi.advanceTimersByTimeAsync(2000)
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(messages.at(-1)).toMatchObject({ type: 'server-diagnostics', state: 'connected' })
  expect(messages.filter(message => message.type === 'diagnostic')).toEqual(diagnostics)
  channel.send('restore-reading', { top: 123, left: 4 })
  await vi.advanceTimersByTimeAsync(0)
  expect(scrollTo).toHaveBeenCalledWith({ top: 123, left: 4, behavior: 'instant' })
  await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
  expect(fetcher).toHaveBeenCalledTimes(3) // Healthy idle streams have no lifetime deadline.
})

it('bounds retries across handshakes and rejects stale diagnostic recovery messages', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
  const { channel, messages, frame, host, preview } = fixture(fetcher)
  await vi.advanceTimersByTimeAsync(7000)
  expect(fetcher).toHaveBeenCalledTimes(4)
  channel.connect()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(fetcher).toHaveBeenCalledTimes(4)
  const count = messages.length
  const event = new Event('message')
  Object.assign(event, { source: frame, origin: preview.origin, data: { protocol: 'rovai-html-preview-v1',
    ...preview, type: 'server-diagnostics', state: 'connected', documentId: 'old', connectionId: 'old' } })
  host.dispatchEvent(event)
  expect(messages).toHaveLength(count)
  expect(channel.connected).toBe(true)
})

it('times out stalled connection attempts within the same bounded allowance', async () => {
  const signals: AbortSignal[] = []
  const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => {
    const signal = options!.signal!; signals.push(signal)
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  })
  const { channel } = fixture(fetcher)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(fetcher).toHaveBeenCalledTimes(4)
  expect(signals.every(signal => signal.aborted)).toBe(true)
  expect(channel.connected).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['backoff', 'connecting', 'streaming', 'revoked'] as const)('stops diagnostic work after %s disposal', async phase => {
  let signal: AbortSignal | undefined
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    signal = options!.signal!
    if (phase === 'backoff') throw new Error('offline')
    if (phase === 'revoked') return new Response('revoked', { status: 403 })
    if (phase === 'streaming') return responseStream(signal).response
    return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  })
  const { close, messages } = fixture(fetcher)
  await vi.advanceTimersByTimeAsync(0)
  if (phase === 'revoked') {
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
  }
  close()
  const count = messages.length
  await vi.advanceTimersByTimeAsync(60_000)
  expect(signal!.aborted).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(messages).toHaveLength(count)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['connecting', 'backoff'] as const)('stops only internal diagnostics when enforced CSP arrives during %s', async phase => {
  let signal!: AbortSignal
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    signal = options!.signal!
    if (phase === 'backoff') throw new Error('CSP fetch rejected before the policy event')
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  })
  const { channel, messages, frame, policy, close } = fixture(fetcher)
  await vi.advanceTimersByTimeAsync(0)
  policy()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(signal.aborted).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
  expect(messages.at(-1)).toMatchObject({ type: 'server-diagnostics', state: 'unavailable', reason: 'policy' })
  expect(messages.some(message => message.type === 'diagnostic')).toBe(false)
  channel.connect()
  channel.send('restore-reading', { top: 150, left: 0 })
  await vi.advanceTimersByTimeAsync(0)
  channel.send('restore-reading', { top: 150, left: 0 })
  const rejection = new Event('unhandledrejection')
  Object.assign(rejection, { reason: new Error('Author error after internal CSP failure') })
  frame.dispatchEvent(rejection)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(channel.connected).toBe(true)
  expect(scrollTo).toHaveBeenCalledWith({ top: 150, left: 0, behavior: 'instant' })
  expect(messages.filter(message => message.type === 'diagnostic')).toEqual([
    expect.objectContaining({ diagnostic: expect.objectContaining({ kind: 'promise', message: 'Author error after internal CSP failure' }) })
  ])
  expect(messages.filter(message => message.type === 'server-diagnostics').at(-1)).toMatchObject({ reason: 'policy' })
  expect(fetcher).toHaveBeenCalledTimes(1)
  close()
  const count = messages.length
  policy()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(messages).toHaveLength(count)
  expect(vi.getTimerCount()).toBe(0)
})

it.each([
  { blockedURI: 'http://other.localhost:9000/__rovai-preview/events?documentId=root' },
  { blockedURI: 'http://preview.localhost:9000/business/__rovai-preview/events?documentId=root' },
  { blockedURI: 'http://preview.localhost:9000/__rovai-preview/events?documentId=old' },
  { sourceFile: 'http://preview.localhost:9000/index.html' },
  { sourceFile: '' },
  { effectiveDirective: 'script-src' },
  { disposition: 'report' },
  { isTrusted: false },
])('preserves policy events not proven to block this internal request: %j', async patch => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
  const { messages, policy } = fixture(fetcher)
  await vi.advanceTimersByTimeAsync(0)
  policy(patch)
  await vi.advanceTimersByTimeAsync(1000)
  expect(messages.filter(message => message.type === 'diagnostic')).toHaveLength(1)
  expect(messages.find(message => message.type === 'diagnostic')).toMatchObject({ diagnostic: { kind: 'policy' } })
  expect(messages.some(message => message.reason === 'policy')).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
