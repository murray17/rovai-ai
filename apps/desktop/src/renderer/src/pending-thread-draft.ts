import type { ThreadComposerDraftView } from '@contracts'
import type { ThreadClient } from './camp-client'
import { saveLocalThreadComposerDraft } from './camp-composer-local-store'

export function hasPendingThreadDraftInput(draft: ThreadComposerDraftView): boolean {
  return Boolean(draft.body.trim() || draft.attachments.length || draft.quotes.length || draft.replyIntent)
}

// Accepted activation is monotonic. Retain the receipt fact across Composer
// mounts on this transport while its Pending projection is still catching up.
const activatedThreads = new WeakMap<Pick<ThreadClient, 'request'>, Set<string>>()

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

  acknowledgeActivation(threadId: string): void {
    let threads = activatedThreads.get(this.client)
    if (!threads) {
      threads = new Set()
      activatedThreads.set(this.client, threads)
    }
    threads.add(threadId)
    this.acknowledged.delete(threadId)
  }

  isActivated(threadId: string): boolean {
    return activatedThreads.get(this.client)?.has(threadId) ?? false
  }

  async persist(draft: ThreadComposerDraftView): Promise<void> {
    this.save(draft)
    if (this.isActivated(draft.threadId)) return
    const present = hasPendingThreadDraftInput(draft)
    if (this.acknowledged.get(draft.threadId) === present) return
    await this.client.request('threads.pendingDraft.setPresence', { threadId: draft.threadId, present })
    this.acknowledged.set(draft.threadId, present)
  }
}
