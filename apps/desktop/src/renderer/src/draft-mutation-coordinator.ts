import { newCommandId } from '../../shared/command-id'
import type {
  ThreadComposerDraftView,
  ThreadComposerReplyRecipient,
  ThreadMessageView,
  ComposerDocument,
  MessageQuoteAction
} from '@contracts'
import { composerDocumentsEqualDirect } from './composer-document'

export type DraftMutation =
  | { kind: 'return_pending_input'; pendingInputId: string; expectedRevision: number; editToken: string | null; commandId: string }
  | { kind: 'quote'; action: MessageQuoteAction; commandId: string }
  | { kind: 'save_content'; content: ComposerDocument }
  | { kind: 'add_source_attachment'; file: File }
  | { kind: 'remove_source_attachment'; attachmentId: string }
  | { kind: 'start_reply'; message: ThreadMessageView }
  | { kind: 'cancel_reply' }
  | { kind: 'resolve_reply_recipient'; recipient: ThreadComposerReplyRecipient }
  | { kind: 'dismiss_continuation'; sourceThreadMessageId: string }
  | { kind: 'resolve_continuation_recipient'; agentId: string }

export type DraftCoordinatorChangeKind = DraftMutation['kind']
  | 'begin_epoch'
  | 'load'
  | 'authoritative_replacement'

export function draftCoordinatorChangeRefreshesProjection(
  kind: DraftCoordinatorChangeKind
): boolean {
  return kind !== 'save_content'
}

export interface DraftMutationCoordinatorBindings {
  load(threadId: string): Promise<ThreadComposerDraftView>
  mutate(
    currentDraft: ThreadComposerDraftView,
    mutation: DraftMutation
  ): Promise<ThreadComposerDraftView>
  onChange?(
    draft: ThreadComposerDraftView | null,
    epoch: number,
    kind: DraftCoordinatorChangeKind
  ): void
}

export class StaleDraftEpochError extends Error {
  constructor() {
    super('Composer Draft operation belongs to a stale editing epoch.')
    this.name = 'StaleDraftEpochError'
  }
}

/**
 * The only Renderer owner of the complete authoritative Thread Draft view.
 * Callers may observe the current value, but every mutation and revision
 * transition is serialized here.
 */
export class DraftMutationCoordinator {
  private readonly bindings: DraftMutationCoordinatorBindings
  private threadId: string | null = null
  private currentDraft: ThreadComposerDraftView | null = null
  private epoch = 0
  private queue: Promise<void> = Promise.resolve()

  constructor(bindings: DraftMutationCoordinatorBindings) {
    this.bindings = bindings
  }

  beginEpoch(threadId: string, draft: ThreadComposerDraftView | null = null): number {
    if (draft && draft.threadId !== threadId) {
      throw new Error('Composer Draft does not belong to the active Thread.')
    }
    this.epoch += 1
    this.threadId = threadId
    this.currentDraft = draft
    this.queue = Promise.resolve()
    this.bindings.onChange?.(draft, this.epoch, 'begin_epoch')
    return this.epoch
  }

  getEpoch(): number {
    return this.epoch
  }

  getCurrentDraft(): ThreadComposerDraftView | null {
    return this.currentDraft
  }

  load(shouldAccept?: () => boolean): Promise<ThreadComposerDraftView> {
    const epoch = this.epoch
    const threadId = this.requireThreadId()
    const result = this.queue.then(async () => {
      this.assertActive(epoch, threadId)
      const loaded = await this.bindings.load(threadId)
      this.assertActive(epoch, threadId)
      // A background route read must not publish after local editing started.
      if (shouldAccept && !shouldAccept()) return this.requireCurrentDraft()
      return this.acceptDraft(loaded, epoch, threadId, 'load')
    })
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  acceptAuthoritativeDraft(draft: ThreadComposerDraftView, advanceEpoch = false): number {
    if (advanceEpoch || this.threadId !== draft.threadId) {
      return this.beginEpoch(draft.threadId, draft)
    }
    this.currentDraft = draft
    this.bindings.onChange?.(draft, this.epoch, 'authoritative_replacement')
    return this.epoch
  }

  saveContent(content: ComposerDocument): Promise<ThreadComposerDraftView> {
    return this.enqueue('save_content', async (current) => {
      if (composerDocumentsEqualDirect(current.content, content)) return current
      return this.bindings.mutate(current, { kind: 'save_content', content })
    })
  }

  addSourceAttachment(file: File): Promise<ThreadComposerDraftView> {
    return this.enqueue('add_source_attachment', (current) => this.bindings.mutate(
      current,
      { kind: 'add_source_attachment', file }
    ))
  }

  removeSourceAttachment(attachmentId: string): Promise<ThreadComposerDraftView> {
    return this.enqueue('remove_source_attachment', (current) => this.bindings.mutate(
      current,
      { kind: 'remove_source_attachment', attachmentId }
    ))
  }

  startReply(message: ThreadMessageView): Promise<ThreadComposerDraftView> {
    return this.enqueue('start_reply', (current) => this.bindings.mutate(
      current,
      { kind: 'start_reply', message }
    ))
  }

  cancelReply(): Promise<ThreadComposerDraftView> {
    return this.enqueue('cancel_reply', (current) =>
      this.bindings.mutate(current, { kind: 'cancel_reply' }))
  }

  resolveReplyRecipient(recipient: ThreadComposerReplyRecipient): Promise<ThreadComposerDraftView> {
    return this.enqueue('resolve_reply_recipient', (current) => this.bindings.mutate(
      current,
      { kind: 'resolve_reply_recipient', recipient }
    ))
  }

  dismissContinuation(sourceThreadMessageId: string): Promise<ThreadComposerDraftView> {
    return this.enqueue('dismiss_continuation', (current) => this.bindings.mutate(
      current,
      { kind: 'dismiss_continuation', sourceThreadMessageId }
    ))
  }

  resolveContinuationRecipient(agentId: string): Promise<ThreadComposerDraftView> {
    return this.enqueue('resolve_continuation_recipient', (current) => this.bindings.mutate(
      current,
      { kind: 'resolve_continuation_recipient', agentId }
    ))
  }

  mutateQuote(action: MessageQuoteAction): Promise<ThreadComposerDraftView> {
    const commandId = newCommandId()
    return this.enqueue('quote', (current) => this.bindings.mutate(current, { kind: 'quote', action, commandId }))
  }

  async waitForIdle(): Promise<ThreadComposerDraftView> {
    const epoch = this.epoch
    const threadId = this.requireThreadId()
    await this.queue
    this.assertActive(epoch, threadId)
    return this.requireCurrentDraft()
  }

  returnPendingInput(pendingInputId: string, expectedRevision: number, editToken: string | null): Promise<ThreadComposerDraftView> {
    const commandId = newCommandId()
    return this.enqueue('return_pending_input', (current) => this.bindings.mutate(current, {
      kind: 'return_pending_input', pendingInputId, expectedRevision, editToken, commandId
    }))
  }

  private enqueue(
    kind: DraftMutation['kind'],
    operation: (current: ThreadComposerDraftView) => Promise<ThreadComposerDraftView>
  ): Promise<ThreadComposerDraftView> {
    const epoch = this.epoch
    const threadId = this.requireThreadId()
    const result = this.queue.then(async () => {
      this.assertActive(epoch, threadId)
      const current = this.currentDraft ?? await this.loadForOperation(epoch, threadId)
      const next = await operation(current)
      this.assertActive(epoch, threadId)
      return next === current ? current : this.acceptDraft(next, epoch, threadId, kind)
    }).catch(async (error: unknown) => {
      if (error instanceof StaleDraftEpochError) throw error
      if (this.isActive(epoch, threadId)) {
        try {
          const refreshed = await this.bindings.load(threadId)
          if (this.isActive(epoch, threadId)) this.acceptDraft(refreshed, epoch, threadId, 'load')
        } catch {
          // Preserve the mutation error; an explicit later operation can reload.
        }
      }
      throw error
    })
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async loadForOperation(epoch: number, threadId: string): Promise<ThreadComposerDraftView> {
    const loaded = await this.bindings.load(threadId)
    this.assertActive(epoch, threadId)
    return this.acceptDraft(loaded, epoch, threadId, 'load')
  }

  private acceptDraft(
    draft: ThreadComposerDraftView,
    epoch: number,
    threadId: string,
    kind: DraftCoordinatorChangeKind
  ): ThreadComposerDraftView {
    this.assertActive(epoch, threadId)
    if (draft.threadId !== threadId) {
      throw new Error('Core returned a Composer Draft for a different Thread.')
    }
    this.currentDraft = draft
    this.bindings.onChange?.(draft, epoch, kind)
    return draft
  }

  private requireThreadId(): string {
    if (!this.threadId) throw new Error('Composer Draft context is not initialized.')
    return this.threadId
  }

  private requireCurrentDraft(): ThreadComposerDraftView {
    if (!this.currentDraft) throw new Error('Composer Draft is not loaded.')
    return this.currentDraft
  }

  private isActive(epoch: number, threadId: string): boolean {
    return this.epoch === epoch && this.threadId === threadId
  }

  private assertActive(epoch: number, threadId: string): void {
    if (!this.isActive(epoch, threadId)) throw new StaleDraftEpochError()
  }
}
