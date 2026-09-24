import type {
  ChannelKind,
  ChannelLoginViewBounds,
  ChannelSettingsSnapshot,
  CoreEvent
} from '@contracts'
import type { ChannelSettingsService } from './channel-settings'
import type { DingTalkChannelSettingsService } from './dingtalk-channel-settings'

export function hasPublishedChannelBot(snapshot: {
  channels: ReadonlyArray<{ memberBots: ReadonlyArray<{ publicationStatus: string }> }>
}): boolean {
  return snapshot.channels.some((channel) => (
    channel.memberBots.some((bot) => bot.publicationStatus === 'published')
  ))
}

type OpenPlatformKind = Exclude<ChannelKind, 'dingtalk'>

export class ChannelSettingsCoordinator {
  // Snapshot order is fixed: Feishu, Lark, DingTalk.
  readonly #openPlatform: ReadonlyArray<readonly [OpenPlatformKind, ChannelSettingsService]>
  readonly #dingtalk: DingTalkChannelSettingsService
  readonly #publications = new Set<ChannelKind>()
  readonly #listeners = new Set<(snapshot: ChannelSettingsSnapshot) => void>()
  readonly #unsubscribeChildren: Array<() => void>

  constructor(input: {
    feishu: ChannelSettingsService
    lark: ChannelSettingsService
    dingtalk: DingTalkChannelSettingsService
  }) {
    this.#openPlatform = [['feishu', input.feishu], ['lark', input.lark]]
    this.#dingtalk = input.dingtalk
    this.#unsubscribeChildren = [
      ...this.#openPlatform.map(([, service]) => service.onChanged(() => { void this.#emit() })),
      this.#dingtalk.onChanged(() => { void this.#emit() })
    ]
  }

  async start(): Promise<void> {
    const hosts = [
      ...this.#openPlatform.map(([kind, service]) => [kind, service.start()] as const),
      ['dingtalk', this.#dingtalk.start()] as const
    ]
    const results = await Promise.allSettled(hosts.map(([, started]) => started))
    const failures: unknown[] = []
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') return
      console.warn(`[rovai] ${HOST_LABELS[hosts[index]![0]]} Channel Host startup failed.`, result.reason)
      failures.push(result.reason)
    })
    if (failures.length === results.length) {
      throw new AggregateError(failures, 'All Channel Hosts failed to start')
    }
  }

  async stop(): Promise<void> {
    await Promise.allSettled([
      ...this.#openPlatform.map(([, service]) => service.stop()),
      this.#dingtalk.stop()
    ])
  }

  handleCoreEvent(event: CoreEvent): void {
    for (const [, service] of this.#openPlatform) service.handleCoreEvent(event)
    this.#dingtalk.handleCoreEvent(event)
  }

  async get(): Promise<ChannelSettingsSnapshot> {
    const [openPlatform, dingtalk] = await Promise.all([
      Promise.all(this.#openPlatform.map(async ([kind, service]) => ({ kind, snapshot: await service.get() }))),
      this.#dingtalk.get()
    ])
    const activeQr = dingtalk.activeQrAttempt
      ? { ...dingtalk.activeQrAttempt, kind: 'dingtalk' as const }
      : openPlatform.flatMap(({ kind, snapshot }) => snapshot.activeQrAttempt
        ? [{ ...snapshot.activeQrAttempt, kind }] : [])[0] ?? null
    const activeProvisioning = dingtalk.activeProvisioning
      ? { ...dingtalk.activeProvisioning, kind: 'dingtalk' as const }
      : openPlatform.flatMap(({ kind, snapshot }) => snapshot.activeProvisioning
        ? [{ ...snapshot.activeProvisioning, kind }] : [])[0] ?? null
    return {
      schemaVersion: 4,
      channels: [
        ...openPlatform.flatMap(({ kind, snapshot }) => snapshot.channels.map(provider => ({
          ...provider,
          provisioning: snapshot.activeProvisioning ? { ...snapshot.activeProvisioning, kind } : null
        }))),
        { ...dingtalk.provider, provisioning: dingtalk.activeProvisioning
          ? { ...dingtalk.activeProvisioning, kind: 'dingtalk' as const } : null }
      ],
      pendingBindingCount: openPlatform.reduce((sum, { snapshot }) => sum + snapshot.pendingBindingCount, 0)
        + dingtalk.pendingBindingCount,
      bindingIssueCount: openPlatform.reduce((sum, { snapshot }) => sum + snapshot.bindingIssueCount, 0)
        + dingtalk.bindingIssueCount,
      activeQrAttempt: activeQr,
      activeProvisioning
    }
  }

  onChanged(listener: (snapshot: ChannelSettingsSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async connect(kind: ChannelKind = 'feishu'): Promise<ChannelSettingsSnapshot> {
    if (kind === 'dingtalk') await this.#dingtalk.connect()
    else await this.#service(kind).connect()
    return this.get()
  }

  async disconnect(kind: ChannelKind = 'feishu'): Promise<ChannelSettingsSnapshot> {
    if (kind === 'dingtalk') await this.#dingtalk.disconnect()
    else await this.#service(kind).disconnect()
    return this.get()
  }

  async publishMemberBot(
    agentId: string,
    kind: ChannelKind = 'feishu'
  ): Promise<ChannelSettingsSnapshot> {
    return this.#publication(kind, async () => {
      if (kind === 'dingtalk') await this.#dingtalk.publish(agentId)
      else await this.#service(kind).publishMemberBot(agentId)
    })
  }

  async retryMemberBot(
    agentId: string,
    kind: ChannelKind = 'feishu'
  ): Promise<ChannelSettingsSnapshot> {
    return this.#publication(kind, async () => {
      if (kind === 'dingtalk') await this.#dingtalk.publish(agentId)
      else await this.#service(kind).retryMemberBot(agentId)
    })
  }

  async selectPublicationApprover(
    agentId: string,
    userId: string,
    kind: ChannelKind = 'feishu'
  ): Promise<ChannelSettingsSnapshot> {
    if (kind !== 'dingtalk') throw new Error(`${kind}_publication_approver_not_supported`)
    return this.#publication(kind, () => this.#dingtalk.selectApprover(agentId, userId))
  }

  async #publication(kind: ChannelKind, action: () => Promise<unknown>): Promise<ChannelSettingsSnapshot> {
    // Desktop IPC and hosted Web use the same coordinator. Admit before the
    // first asynchronous Core read so simultaneous callers cannot both create.
    if (this.#publications.has(kind)) throw new Error('channel_publication_busy')
    this.#publications.add(kind)
    try { await action(); return await this.get() }
    finally { this.#publications.delete(kind) }
  }

  async cancelQrAttempt(attemptId: string): Promise<ChannelSettingsSnapshot> {
    const dingtalk = await this.#dingtalk.get()
    if (dingtalk.activeQrAttempt?.attemptId === attemptId) {
      await this.#dingtalk.cancelLogin(attemptId)
    } else {
      // Each open-platform Host ignores an attempt it does not own.
      await Promise.all(this.#openPlatform.map(([, service]) => service.cancelQrAttempt(attemptId)))
    }
    return this.get()
  }

  setLoginViewBounds(attemptId: string, bounds: ChannelLoginViewBounds | null): void {
    this.#dingtalk.setLoginViewBounds(attemptId, bounds)
  }

  async refreshLoginQr(attemptId: string): Promise<void> {
    for (const [, service] of this.#openPlatform) {
      if (await service.refreshLoginQr(attemptId)) return
    }
    await this.#dingtalk.refreshLoginQr(attemptId)
  }

  dispose(): void {
    for (const unsubscribe of this.#unsubscribeChildren) unsubscribe()
    this.#listeners.clear()
  }

  #service(kind: OpenPlatformKind): ChannelSettingsService {
    return this.#openPlatform.find(([candidate]) => candidate === kind)![1]
  }

  async #emit(): Promise<ChannelSettingsSnapshot> {
    const snapshot = await this.get()
    for (const listener of this.#listeners) listener(structuredClone(snapshot))
    return snapshot
  }
}

const HOST_LABELS: Readonly<Record<ChannelKind, string>> = {
  feishu: 'Feishu',
  lark: 'Lark',
  dingtalk: 'DingTalk'
}
