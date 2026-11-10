import type {
  ComposerDocument, SingleChatMessageView, SingleChatPendingInputView, ThreadMessageView
} from '@contracts'
import { composerDocumentFromLegacyContent, composerDocumentFromText } from './composer-document'

/** Extract independent editable documents in the message collection's existing order. */
export function threadInputHistory(messages: readonly Pick<ThreadMessageView,
  'authorType' | 'authorId' | 'withdrawn' | 'content' | 'body'>[]): ComposerDocument[] {
  return messages.flatMap(message => {
    if (message.authorType !== 'user' || message.authorId !== 'local_user' || message.withdrawn) return []
    // An otherwise empty structured message must not resurrect quote text from body.
    const content = message.content.length ? composerDocumentFromLegacyContent(message.content.filter(segment =>
      segment.kind === 'text' || segment.kind === 'member_mention'
      || segment.kind === 'all_members_mention' || segment.kind === 'skill_mention' || segment.kind === 'thread_reference' || segment.kind === 'mission_reference' || segment.kind === 'project_file_reference'
    )) : composerDocumentFromText(message.body)
    return content.segments.some(segment => segment.kind === 'atom' || segment.text.trim()) ? [content] : []
  })
}

/** The existing queue follows formal messages; neither source is sorted or loaded here. */
export function singleInputHistory(
  messages: readonly Pick<SingleChatMessageView, 'authorType' | 'authorId' | 'body'>[],
  pending: readonly Pick<SingleChatPendingInputView, 'body'>[]
): string[] {
  return [
    ...messages.filter(message => message.authorType === 'user' && message.authorId === 'local_user'),
    ...pending
  ].filter(input => input.body.trim()).map(input => input.body)
}

export interface InputHistoryAdapter<Content, Snapshot> {
  capture(): Snapshot
  preview(content: Content, boundary: 'start' | 'end'): void
  restore(snapshot: Snapshot): void
}

/** One browsing round: a fixed content array, its index, and the original draft/selection. */
export class InputHistoryNavigation<Content, Snapshot> {
  private round: { items: readonly Content[]; index: number; original: Snapshot } | null = null

  constructor(
    private readonly read: () => readonly Content[],
    private readonly adapter: InputHistoryAdapter<Content, Snapshot>
  ) {}

  get browsing(): boolean { return this.round !== null }

  older(): boolean {
    if (!this.round) {
      const items = this.read()
      if (!items.length) return false
      this.round = { items, index: items.length, original: this.adapter.capture() }
    }
    const round = this.round
    if (round.index === 0) return false
    this.adapter.preview(round.items[--round.index], 'start')
    return true
  }

  newer(): boolean {
    const round = this.round
    if (!round) return false
    if (round.index === round.items.length - 1) return this.cancel()
    this.adapter.preview(round.items[++round.index], 'end')
    return true
  }

  cancel(): boolean {
    const round = this.round
    this.adopt()
    if (round) this.adapter.restore(round.original)
    return round !== null
  }

  /** Editing, sending, explicit draft replacement or leaving releases the round. */
  adopt(): void { this.round = null }
}

export function isInputHistoryKey(event: {
  key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean
  isComposing?: boolean; keyCode?: number; defaultPrevented: boolean
}): boolean {
  return !event.defaultPrevented && !event.isComposing && event.keyCode !== 229
    && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
    && ['ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)
}
