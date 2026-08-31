import { DWClient, TOPIC_CARD, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream'
import { normalizeDingTalkRobotMessage, type DingTalkInboundMessage } from './dingtalk-inbound'

type DingTalkStreamClient = {
  readonly connected: boolean
  registerCallbackListener(
    topic: string,
    listener: (message: DWClientDownStream) => void
  ): unknown
  connect(): Promise<void>
  disconnect(): void
  socketCallBackResponse(messageId: string, result: unknown): void
}

export type DingTalkCardCallback = {
  appKey: string
  messageId: string
  payload: Record<string, unknown>
}

export type DingTalkStreamRegistryOptions = {
  createClient?: (credential: { appKey: string; appSecret: string }) => DingTalkStreamClient
  onMessage(message: DingTalkInboundMessage): Promise<void>
  onCard(callback: DingTalkCardCallback): Promise<void>
  onFailure?(appKey: string, error: unknown): void
  connectTimeoutMs?: number
}

export class DingTalkStreamRegistry {
  readonly #options: DingTalkStreamRegistryOptions
  readonly #clients = new Map<string, DingTalkStreamClient>()
  readonly #starting = new Map<string, Promise<void>>()

  constructor(options: DingTalkStreamRegistryOptions) {
    this.#options = options
  }

  async start(input: {
    appKey: string
    appSecret: string
    robotCode: string
  }): Promise<void> {
    const starting = this.#starting.get(input.appKey)
    if (starting) return starting
    if (this.has(input.appKey)) return
    this.stop(input.appKey)
    const pending = this.#connect(input)
    this.#starting.set(input.appKey, pending)
    try { await pending } finally {
      if (this.#starting.get(input.appKey) === pending) this.#starting.delete(input.appKey)
    }
  }

  async #connect(input: { appKey: string; appSecret: string; robotCode: string }): Promise<void> {
    const create = this.#options.createClient ?? ((credential) => new DWClient({
      clientId: credential.appKey,
      clientSecret: credential.appSecret,
      debug: false,
      keepAlive: true
    }))
    const client = create(input)
    client.registerCallbackListener(TOPIC_ROBOT, (message) => {
      acknowledge(client, message)
      defer(
        async () => {
          if (this.#clients.get(input.appKey) !== client) return
          await this.#options.onMessage(normalizeDingTalkRobotMessage(
            JSON.parse(message.data), { appKey: input.appKey, robotCode: input.robotCode }
          ))
        },
        (error) => this.#options.onFailure?.(input.appKey, error)
      )
    })
    client.registerCallbackListener(TOPIC_CARD, (message) => {
      acknowledge(client, message)
      defer(async () => {
        if (this.#clients.get(input.appKey) !== client) return
        const payload = JSON.parse(message.data) as Record<string, unknown>
        await this.#options.onCard({
          appKey: input.appKey,
          messageId: message.headers.messageId,
          payload
        })
      }, (error) => this.#options.onFailure?.(input.appKey, error))
    })
    this.#clients.set(input.appKey, client)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('dingtalk_stream_not_connected')),
            this.#options.connectTimeoutMs ?? 20_000)
        })
      ])
      // The SDK resolves connect() even after a failed endpoint/handshake.
      // `registered` is not a readiness signal for current Stream connections.
      if (!client.connected || this.#clients.get(input.appKey) !== client) {
        throw new Error('dingtalk_stream_not_connected')
      }
    } catch {
      if (this.#clients.get(input.appKey) === client) this.#clients.delete(input.appKey)
      client.disconnect()
      throw new Error('dingtalk_stream_not_connected')
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  stop(appKey: string): void {
    const client = this.#clients.get(appKey)
    if (!client) return
    this.#clients.delete(appKey)
    client.disconnect()
  }

  stopAll(): void {
    for (const appKey of [...this.#clients.keys()]) this.stop(appKey)
  }

  has(appKey: string): boolean {
    return this.#clients.get(appKey)?.connected === true
  }
}

function acknowledge(client: DingTalkStreamClient, message: DWClientDownStream): void {
  client.socketCallBackResponse(message.headers.messageId, { status: 'SUCCESS' })
}

function defer(work: () => Promise<void>, onFailure: (error: unknown) => void): void {
  queueMicrotask(() => { void Promise.resolve().then(work).catch(onFailure) })
}
