import type { MessageQuoteSnapshot } from '@contracts'
import type { CampPendingInputsView, ComposerDocument, LocalAttachmentSourceView, PendingCampInputView } from '@contracts'

export type PendingInputSnapshot = {
  quotes: MessageQuoteSnapshot[]
  content: ComposerDocument
  replyToCampMessageId: string | null
  recipientSelectionRequired: boolean
  attachments: LocalAttachmentSourceView[]
}

export type PendingInputLocalEdit = PendingInputSnapshot & {
  item: PendingCampInputView
  token: string
  initial: PendingInputSnapshot
}

export interface PendingInputLeavePreparation {
  complete(didLeave: boolean): void
}

export function ownsPendingInputEdit(edit: PendingInputLocalEdit, queue: CampPendingInputsView): boolean {
  const session = queue.editSession
  return edit.item.campId === queue.campId
    && session?.pendingInputId === edit.item.id
    && session.editToken === edit.token
    && session.basePendingRevision === edit.item.revision
    && !session.recoveryRequired
    && queue.items.some(item => item.id === edit.item.id && item.revision === edit.item.revision)
}

/** Window-local navigation snapshots only. No persistence, Core mutation or lock recovery. */
export function createPendingInputNavigationStore() {
  const drafts = new Map<string, PendingInputLocalEdit>()
  return {
    retain(edit: PendingInputLocalEdit): () => void {
      const campId = edit.item.campId
      drafts.set(campId, edit)
      return () => { if (drafts.get(campId) === edit) drafts.delete(campId) }
    },
    resume(queue: CampPendingInputsView): PendingInputLocalEdit | null {
      const edit = drafts.get(queue.campId)
      drafts.delete(queue.campId)
      if (!edit || !ownsPendingInputEdit(edit, queue)) return null
      return { ...edit, attachments: queue.editSession!.workingAttachments, quotes: queue.editSession!.workingQuotes }
    }
  }
}

export const pendingInputNavigation = createPendingInputNavigationStore()
