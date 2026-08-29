import { DWClient, TOPIC_CARD, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream'
import { normalizeDingTalkRobotMessage, type DingTalkInboundMessage } from './dingtalk-inbound'

type DingTalkStreamClient = {
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
}

export class DingTalkStreamRegistry {
  readonly #options: DingTalkStreamRegistryOptions
  readonly #clients = new Map<string, DingTalkStreamClient>()

  constructor(options: DingTalkStreamRegistryOptions) {
    this.#options = options
  }

  async start(input: {
    appKey: string
    appSecret: string
    robotCode: string
  }): Promise<void> {
    if (this.#clients.has(input.appKey)) return
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
        () => this.#options.onMessage(normalizeDingTalkRobotMessage(
          JSON.parse(message.data),
          { appKey: input.appKey, robotCode: input.robotCode }
        )),
        (error) => this.#options.onFailure?.(input.appKey, error)
      )
    })
    client.registerCallbackListener(TOPIC_CARD, (message) => {
      acknowledge(client, message)
      defer(async () => {
        const payload = JSON.parse(message.data) as Record<string, unknown>
        await this.#options.onCard({
          appKey: input.appKey,
          messageId: message.headers.messageId,
          payload
        })
      }, (error) => this.#options.onFailure?.(input.appKey, error))
    })
    this.#clients.set(input.appKey, client)
    try {
      await client.connect()
    } catch (error) {
      this.#clients.delete(input.appKey)
      client.disconnect()
      throw error
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
    return this.#clients.has(appKey)
  }
}

function acknowledge(client: DingTalkStreamClient, message: DWClientDownStream): void {
  client.socketCallBackResponse(message.headers.messageId, { status: 'SUCCESS' })
}

function defer(work: () => Promise<void>, onFailure: (error: unknown) => void): void {
  queueMicrotask(() => { void Promise.resolve().then(work).catch(onFailure) })
}
