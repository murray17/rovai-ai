import type {
  CampComposerDraftView,
  CampComposerReplyRecipient,
  ComposerDocument
} from '@contracts'
import { composerDocumentsEqual } from './composer-document'

export type DraftMutation =
  | { kind: 'save_content'; content: ComposerDocument }
  | { kind: 'add_source_attachment'; file: File }
  | { kind: 'remove_source_attachment'; attachmentId: string }
  | { kind: 'start_reply'; replyToCampMessageId: string }
  | { kind: 'cancel_reply' }
  | { kind: 'resolve_reply_recipient'; recipient: CampComposerReplyRecipient }
  | { kind: 'dismiss_continuation'; sourceCampMessageId: string }
  | { kind: 'resolve_continuation_recipient'; agentId: string }

export interface DraftMutationCoordinatorBindings {
  load(campId: string): Promise<CampComposerDraftView>
  mutate(
    currentDraft: CampComposerDraftView,
    mutation: DraftMutation
  ): Promise<CampComposerDraftView>
  onChange?(draft: CampComposerDraftView | null, epoch: number): void
}

export class StaleDraftEpochError extends Error {
  constructor() {
    super('Composer Draft operation belongs to a stale editing epoch.')
    this.name = 'StaleDraftEpochError'
  }
}

/**
 * The only Renderer owner of the complete authoritative Camp Draft view.
 * Callers may observe the current value, but every mutation and revision
 * transition is serialized here.
 */
export class DraftMutationCoordinator {
  private readonly bindings: DraftMutationCoordinatorBindings
  private campId: string | null = null
  private currentDraft: CampComposerDraftView | null = null
  private epoch = 0
  private queue: Promise<void> = Promise.resolve()

  constructor(bindings: DraftMutationCoordinatorBindings) {
    this.bindings = bindings
  }

  beginEpoch(campId: string, draft: CampComposerDraftView | null = null): number {
    if (draft && draft.campId !== campId) {
      throw new Error('Composer Draft does not belong to the active Camp.')
    }
    this.epoch += 1
    this.campId = campId
    this.currentDraft = draft
    this.queue = Promise.resolve()
    this.bindings.onChange?.(draft, this.epoch)
    return this.epoch
  }

  getEpoch(): number {
    return this.epoch
  }

  getCurrentDraft(): CampComposerDraftView | null {
    return this.currentDraft
  }

  load(): Promise<CampComposerDraftView> {
    const epoch = this.epoch
    const campId = this.requireCampId()
    const result = this.queue.then(async () => {
      this.assertActive(epoch, campId)
      const loaded = await this.bindings.load(campId)
      this.assertActive(epoch, campId)
      return this.acceptDraft(loaded, epoch, campId)
    })
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  acceptAuthoritativeDraft(draft: CampComposerDraftView, advanceEpoch = false): number {
    if (advanceEpoch || this.campId !== draft.campId) {
      return this.beginEpoch(draft.campId, draft)
    }
    this.currentDraft = draft
    this.bindings.onChange?.(draft, this.epoch)
    return this.epoch
  }

  saveContent(content: ComposerDocument): Promise<CampComposerDraftView> {
    return this.enqueue(async (current) => {
      if (composerDocumentsEqual(current.content, content)) return current
      return this.bindings.mutate(current, { kind: 'save_content', content })
    })
  }

  addSourceAttachment(file: File): Promise<CampComposerDraftView> {
    return this.enqueue((current) => this.bindings.mutate(
      current,
      { kind: 'add_source_attachment', file }
    ))
  }

  removeSourceAttachment(attachmentId: string): Promise<CampComposerDraftView> {
    return this.enqueue((current) => this.bindings.mutate(
      current,
      { kind: 'remove_source_attachment', attachmentId }
    ))
  }

  startReply(replyToCampMessageId: string): Promise<CampComposerDraftView> {
    return this.enqueue((current) => this.bindings.mutate(
      current,
      { kind: 'start_reply', replyToCampMessageId }
    ))
  }

  cancelReply(): Promise<CampComposerDraftView> {
    return this.enqueue((current) => this.bindings.mutate(current, { kind: 'cancel_reply' }))
  }

  resolveReplyRecipient(recipient: CampComposerReplyRecipient): Promise<CampComposerDraftView> {
    return this.enqueue((current) => this.bindings.mutate(
      current,
      { kind: 'resolve_reply_recipient', recipient }
    ))
  }

  dismissContinuation(sourceCampMessageId: string): Promise<CampComposerDraftView> {
    return this.enqueue((current) => this.bindings.mutate(
      current,
      { kind: 'dismiss_continuation', sourceCampMessageId }
    ))
  }

  resolveContinuationRecipient(agentId: string): Promise<CampComposerDraftView> {
    return this.enqueue((current) => this.bindings.mutate(
      current,
      { kind: 'resolve_continuation_recipient', agentId }
    ))
  }

  async waitForIdle(): Promise<CampComposerDraftView> {
    const epoch = this.epoch
    const campId = this.requireCampId()
    await this.queue
    this.assertActive(epoch, campId)
    return this.requireCurrentDraft()
  }

  private enqueue(
    operation: (current: CampComposerDraftView) => Promise<CampComposerDraftView>
  ): Promise<CampComposerDraftView> {
    const epoch = this.epoch
    const campId = this.requireCampId()
    const result = this.queue.then(async () => {
      this.assertActive(epoch, campId)
      const current = this.currentDraft ?? await this.loadForOperation(epoch, campId)
      const next = await operation(current)
      this.assertActive(epoch, campId)
      return this.acceptDraft(next, epoch, campId)
    }).catch(async (error: unknown) => {
      if (error instanceof StaleDraftEpochError) throw error
      if (this.isActive(epoch, campId)) {
        try {
          const refreshed = await this.bindings.load(campId)
          if (this.isActive(epoch, campId)) this.acceptDraft(refreshed, epoch, campId)
        } catch {
          // Preserve the mutation error; an explicit later operation can reload.
        }
      }
      throw error
    })
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async loadForOperation(epoch: number, campId: string): Promise<CampComposerDraftView> {
    const loaded = await this.bindings.load(campId)
    this.assertActive(epoch, campId)
    return this.acceptDraft(loaded, epoch, campId)
  }

  private acceptDraft(
    draft: CampComposerDraftView,
    epoch: number,
    campId: string
  ): CampComposerDraftView {
    this.assertActive(epoch, campId)
    if (draft.campId !== campId) {
      throw new Error('Core returned a Composer Draft for a different Camp.')
    }
    this.currentDraft = draft
    this.bindings.onChange?.(draft, epoch)
    return draft
  }

  private requireCampId(): string {
    if (!this.campId) throw new Error('Composer Draft context is not initialized.')
    return this.campId
  }

  private requireCurrentDraft(): CampComposerDraftView {
    if (!this.currentDraft) throw new Error('Composer Draft is not loaded.')
    return this.currentDraft
  }

  private isActive(epoch: number, campId: string): boolean {
    return this.epoch === epoch && this.campId === campId
  }

  private assertActive(epoch: number, campId: string): void {
    if (!this.isActive(epoch, campId)) throw new StaleDraftEpochError()
  }
}
