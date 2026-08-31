import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOPIC_CARD, TOPIC_ROBOT } from 'dingtalk-stream'
import { DingTalkStreamRegistry } from './dingtalk-stream-registry'

afterEach(() => vi.useRealTimers())

describe('DingTalk Stream registry', () => {
  it('ACKs Robot callbacks before deferring application work', async () => {
    const order: string[] = []
    const client = new FakeStreamClient(order)
    const registry = new DingTalkStreamRegistry({
      createClient: () => client,
      onMessage: async () => { order.push('handled') },
      onCard: async () => undefined
    })
    await registry.start({ appKey: 'ding-app', appSecret: 'secret', robotCode: 'ding-app' })

    client.emit(TOPIC_ROBOT, {
      msgId: 'msg-1',
      senderCorpId: 'corp-1',
      senderStaffId: 'owner-1',
      conversationType: '1',
      conversationId: 'dm-1',
      robotCode: 'ding-app',
      text: { content: 'hello' }
    })
    expect(order).toEqual(['ack'])
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['ack', 'handled'])
  })

  it('routes card callbacks on the same app connection', async () => {
    const client = new FakeStreamClient([])
    const onCard = vi.fn(async () => undefined)
    const registry = new DingTalkStreamRegistry({
      createClient: () => client,
      onMessage: async () => undefined,
      onCard
    })
    await registry.start({ appKey: 'ding-app', appSecret: 'secret', robotCode: 'ding-app' })
    client.emit(TOPIC_CARD, { outTrackId: 'card-1', value: { action: 'next' } })
    await Promise.resolve()
    await Promise.resolve()
    expect(onCard).toHaveBeenCalledWith({
      appKey: 'ding-app',
      messageId: 'stream-message-1',
      payload: { outTrackId: 'card-1', value: { action: 'next' } }
    })
  })

  it('reports malformed Robot payloads after ACK instead of throwing from the callback', async () => {
    const order: string[] = []
    const client = new FakeStreamClient(order)
    const onFailure = vi.fn()
    const registry = new DingTalkStreamRegistry({
      createClient: () => client,
      onMessage: async () => undefined,
      onCard: async () => undefined,
      onFailure
    })
    await registry.start({ appKey: 'ding-app', appSecret: 'secret', robotCode: 'ding-app' })

    client.emitRaw(TOPIC_ROBOT, '{')
    expect(order).toEqual(['ack'])
    await new Promise((resolve) => setImmediate(resolve))
    expect(onFailure).toHaveBeenCalledOnce()
  })

  it('removes and disconnects a client whose handshake fails', async () => {
    const client = new FakeStreamClient([], new Error('connect_failed'))
    const registry = new DingTalkStreamRegistry({
      createClient: () => client,
      onMessage: async () => undefined,
      onCard: async () => undefined
    })
    await expect(registry.start({
      appKey: 'ding-app', appSecret: 'secret', robotCode: 'ding-app'
    })).rejects.toThrow('dingtalk_stream_not_connected')
    expect(registry.has('ding-app')).toBe(false)
    expect(client.disconnect).toHaveBeenCalledOnce()
  })

  it('does not mark SDK connect() resolved without a live socket as online', async () => {
    const client = new FakeStreamClient([])
    vi.spyOn(client, 'connect').mockResolvedValue(undefined)
    const registry = registryFor(client)
    await expect(registry.start(credential)).rejects.toThrow('dingtalk_stream_not_connected')
    expect(registry.has('ding-app')).toBe(false)
    expect(client.disconnect).toHaveBeenCalledOnce()
  })

  it('shares concurrent startup readiness and does not require the SDK registered flag', async () => {
    const client = new FakeStreamClient([])
    let resolve!: () => void
    const connect = vi.spyOn(client, 'connect').mockImplementation(() => new Promise<void>((done) => {
      resolve = () => { client.connected = true; done() }
    }))
    const registry = registryFor(client)
    const first = registry.start(credential)
    const second = registry.start(credential)
    expect(registry.has('ding-app')).toBe(false)
    expect(connect).toHaveBeenCalledOnce()
    resolve()
    await Promise.all([first, second])
    expect(registry.has('ding-app')).toBe(true)
    client.connected = false
    expect(registry.has('ding-app')).toBe(false)
  })

  it('bounds handshake time, disconnects, and fences a late completion or callback', async () => {
    vi.useFakeTimers()
    const client = new FakeStreamClient([])
    let resolve!: () => void
    vi.spyOn(client, 'connect').mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    const onCard = vi.fn(async () => undefined)
    const registry = new DingTalkStreamRegistry({
      createClient: () => client, onCard, onMessage: async () => undefined, connectTimeoutMs: 25
    })
    const pending = expect(registry.start(credential)).rejects.toThrow('dingtalk_stream_not_connected')
    await vi.advanceTimersByTimeAsync(25)
    await pending
    expect(client.disconnect).toHaveBeenCalledOnce()
    client.connected = true
    resolve()
    client.emit(TOPIC_CARD, { outTrackId: 'late-card' })
    await vi.advanceTimersByTimeAsync(0)
    expect(registry.has('ding-app')).toBe(false)
    expect(onCard).not.toHaveBeenCalled()
  })

  it('does not accept a connection that finished after stop', async () => {
    const client = new FakeStreamClient([])
    let resolve!: () => void
    vi.spyOn(client, 'connect').mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    const registry = registryFor(client)
    const pending = expect(registry.start(credential)).rejects.toThrow('dingtalk_stream_not_connected')
    registry.stop('ding-app')
    client.connected = true
    resolve()
    await pending
    expect(registry.has('ding-app')).toBe(false)
  })
})

const credential = { appKey: 'ding-app', appSecret: 'secret', robotCode: 'ding-app' }

function registryFor(client: FakeStreamClient) {
  return new DingTalkStreamRegistry({
    createClient: () => client, onMessage: async () => undefined, onCard: async () => undefined
  })
}

class FakeStreamClient {
  connected = false
  readonly #listeners = new Map<string, (message: any) => void>()
  readonly #order: string[]
  readonly #connectError: Error | null
  readonly disconnect = vi.fn(() => { this.connected = false })

  constructor(order: string[], connectError: Error | null = null) {
    this.#order = order
    this.#connectError = connectError
  }

  registerCallbackListener(topic: string, listener: (message: any) => void): void {
    this.#listeners.set(topic, listener)
  }

  async connect(): Promise<void> {
    if (this.#connectError) throw this.#connectError
    this.connected = true
  }

  socketCallBackResponse(): void {
    this.#order.push('ack')
  }

  emit(topic: string, payload: Record<string, unknown>): void {
    this.emitRaw(topic, JSON.stringify(payload))
  }

  emitRaw(topic: string, data: string): void {
    this.#listeners.get(topic)?.({
      headers: { messageId: 'stream-message-1' },
      data
    })
  }
}
