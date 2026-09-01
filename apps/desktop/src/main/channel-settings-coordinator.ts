import type {
  ChannelKind,
  ChannelLoginViewBounds,
  ChannelSettingsSnapshot,
  CoreEvent
} from '@contracts'
import type { ChannelSettingsService } from './channel-settings'
import type { DingTalkChannelSettingsService } from './dingtalk-channel-settings'

export class ChannelSettingsCoordinator {
  readonly #feishu: ChannelSettingsService
  readonly #dingtalk: DingTalkChannelSettingsService
  readonly #listeners = new Set<(snapshot: ChannelSettingsSnapshot) => void>()
  readonly #unsubscribeChildren: Array<() => void>

  constructor(input: {
    feishu: ChannelSettingsService
    dingtalk: DingTalkChannelSettingsService
  }) {
    this.#feishu = input.feishu
    this.#dingtalk = input.dingtalk
    this.#unsubscribeChildren = [
      this.#feishu.onChanged(() => { void this.#emit() }),
      this.#dingtalk.onChanged(() => { void this.#emit() })
    ]
  }

  async start(): Promise<void> {
    const [feishu, dingtalk] = await Promise.allSettled([
      this.#feishu.start(),
      this.#dingtalk.start()
    ])
    if (feishu.status === 'rejected') {
      console.warn('[rovai] Feishu Channel Host startup failed.', feishu.reason)
    }
    if (dingtalk.status === 'rejected') {
      console.warn('[rovai] DingTalk Channel Host startup failed.', dingtalk.reason)
    }
    if (feishu.status === 'rejected' && dingtalk.status === 'rejected') {
      throw new AggregateError(
        [feishu.reason, dingtalk.reason],
        'All Channel Hosts failed to start'
      )
    }
  }

  async stop(): Promise<void> {
    await Promise.allSettled([this.#feishu.stop(), this.#dingtalk.stop()])
  }

  handleCoreEvent(event: CoreEvent): void {
    this.#feishu.handleCoreEvent(event)
    this.#dingtalk.handleCoreEvent(event)
  }

  async get(): Promise<ChannelSettingsSnapshot> {
    const [feishu, dingtalk] = await Promise.all([
      this.#feishu.get(),
      this.#dingtalk.get()
    ])
    return {
      schemaVersion: 4,
      channels: [...feishu.channels, dingtalk.provider],
      pendingBindingCount: feishu.pendingBindingCount + dingtalk.pendingBindingCount,
      bindingIssueCount: feishu.bindingIssueCount + dingtalk.bindingIssueCount,
      activeQrAttempt: dingtalk.activeQrAttempt
        ? { ...dingtalk.activeQrAttempt, kind: 'dingtalk' }
        : feishu.activeQrAttempt
          ? { ...feishu.activeQrAttempt, kind: 'feishu' }
          : null,
      activeProvisioning: dingtalk.activeProvisioning
        ? { ...dingtalk.activeProvisioning, kind: 'dingtalk' }
        : feishu.activeProvisioning
          ? { ...feishu.activeProvisioning, kind: 'feishu' }
          : null
    }
  }

  onChanged(listener: (snapshot: ChannelSettingsSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async connect(kind: ChannelKind = 'feishu'): Promise<ChannelSettingsSnapshot> {
    if (kind === 'dingtalk') await this.#dingtalk.connect()
    else await this.#feishu.connect()
    return this.get()
  }

  async disconnect(kind: ChannelKind = 'feishu'): Promise<ChannelSettingsSnapshot> {
    if (kind === 'dingtalk') await this.#dingtalk.disconnect()
    else await this.#feishu.disconnect()
    return this.get()
  }

  async publishMemberBot(
    agentId: string,
    kind: ChannelKind = 'feishu'
  ): Promise<ChannelSettingsSnapshot> {
    if (kind === 'dingtalk') await this.#dingtalk.publish(agentId)
    else await this.#feishu.publishMemberBot(agentId)
    return this.get()
  }

  async retryMemberBot(
    agentId: string,
    kind: ChannelKind = 'feishu'
  ): Promise<ChannelSettingsSnapshot> {
    if (kind === 'dingtalk') await this.#dingtalk.publish(agentId)
    else await this.#feishu.retryMemberBot(agentId)
    return this.get()
  }

  async selectPublicationApprover(
    agentId: string,
    userId: string,
    kind: ChannelKind = 'feishu'
  ): Promise<ChannelSettingsSnapshot> {
    if (kind !== 'dingtalk') throw new Error('feishu_publication_approver_not_supported')
    await this.#dingtalk.selectApprover(agentId, userId)
    return this.get()
  }

  async cancelQrAttempt(attemptId: string): Promise<ChannelSettingsSnapshot> {
    const dingtalk = await this.#dingtalk.get()
    if (dingtalk.activeQrAttempt?.attemptId === attemptId) {
      await this.#dingtalk.cancelLogin(attemptId)
    } else {
      await this.#feishu.cancelQrAttempt(attemptId)
    }
    return this.get()
  }

  setLoginViewBounds(attemptId: string, bounds: ChannelLoginViewBounds | null): void {
    this.#dingtalk.setLoginViewBounds(attemptId, bounds)
  }

  refreshLoginQr(attemptId: string): void { this.#dingtalk.refreshLoginQr(attemptId) }

  dispose(): void {
    for (const unsubscribe of this.#unsubscribeChildren) unsubscribe()
    this.#listeners.clear()
  }

  async #emit(): Promise<ChannelSettingsSnapshot> {
    const snapshot = await this.get()
    for (const listener of this.#listeners) listener(structuredClone(snapshot))
    return snapshot
  }
}
