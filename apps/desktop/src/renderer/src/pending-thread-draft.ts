import type { ThreadComposerDraftView } from '@contracts'
import type { ThreadClient } from './camp-client'
import { saveLocalThreadComposerDraft } from './camp-composer-local-store'

export function hasPendingThreadDraftInput(draft: ThreadComposerDraftView): boolean {
  return Boolean(draft.body.trim() || draft.attachments.length || draft.quotes.length || draft.replyIntent)
}

/** The local snapshot owns content; Core presence protects its Thread from startup cleanup.
 * The Composer coordinator serializes calls. An unacknowledged presence change remains retryable.
 */
export class PendingThreadDraftPersistence {
  private readonly acknowledged = new Map<string, boolean>()

  constructor(
    private readonly client: Pick<ThreadClient, 'request'>,
    private readonly save = (draft: ThreadComposerDraftView): void => {
      const storage = window.localStorage
      if (!storage) throw new Error('Local draft storage is unavailable')
      saveLocalThreadComposerDraft(draft, storage)
    }
  ) {}

  async persist(draft: ThreadComposerDraftView): Promise<void> {
    this.save(draft)
    const present = hasPendingThreadDraftInput(draft)
    if (this.acknowledged.get(draft.threadId) === present) return
    await this.client.request('threads.pendingDraft.setPresence', { threadId: draft.threadId, present })
    this.acknowledged.set(draft.threadId, present)
  }
}
