import type { ComposerDocument, LocalAttachmentSourceView, MessageQuoteSnapshot } from '@contracts'
import { validReferenceAtom } from './thread-reference'
import { newCommandId } from '../../shared/command-id'
import { composerDocumentsEqualDirect, composerDocumentToPlainText, emptyComposerDocument } from './composer-document'
import {
  clearLocalThreadComposerDraft,
  emptyLocalThreadComposerDraft,
  loadLocalThreadComposerDraft,
  saveLocalThreadComposerDraft
} from './camp-composer-local-store'

const generationKey = (agentId: string) => 'rovai.new-chat-generation:' + agentId

function currentGeneration(agentId: string): string | null {
  return localStorage.getItem(generationKey(agentId))
}

export function newChatDraftId(agentId: string): string {
  let generation = currentGeneration(agentId)
  if (!generation) {
    generation = newCommandId()
    const legacy = loadLocalThreadComposerDraft('chat-draft:' + agentId + ':initial')
    if (legacy) {
      saveLocalThreadComposerDraft({ ...legacy, threadId: 'chat-draft:' + agentId + ':' + generation })
      clearLocalThreadComposerDraft(legacy.threadId)
    }
    localStorage.setItem(generationKey(agentId), generation)
  }
  return agentId + ':' + generation
}

export function chatDraftKey(agentId: string, chatId: string | null, draftId: string): string {
  return chatId ? 'chat:' + chatId : 'chat-draft:' + draftId
}

export function hasNewChatDraft(agentId: string): boolean {
  const generation = currentGeneration(agentId) ?? 'initial'
  return Boolean(loadLocalThreadComposerDraft('chat-draft:' + agentId + ':' + generation))
}

export function readChatDraft(key: string): ComposerDocument {
  return loadLocalThreadComposerDraft(key)?.content ?? emptyComposerDocument()
}

export function saveChatDraft(key: string, content: ComposerDocument): void {
  const draft = loadLocalThreadComposerDraft(key) ?? emptyLocalThreadComposerDraft(key)
  saveLocalThreadComposerDraft({
    ...draft,
    content,
    body: composerDocumentToPlainText(content),
    revision: draft.revision + 1,
    updatedAt: new Date().toISOString()
  })
}

export type ChatDraftExtras = { attachments: LocalAttachmentSourceView[]; quotes: MessageQuoteSnapshot[] }

export function saveChatExtras(key: string, extras: ChatDraftExtras): void {
  const draft = loadLocalThreadComposerDraft(key) ?? emptyLocalThreadComposerDraft(key)
  saveLocalThreadComposerDraft({
    ...draft,
    ...extras,
    revision: draft.revision + 1,
    updatedAt: new Date().toISOString()
  })
}

export function forkConflictedChat(agentId: string, draftId: string): string {
  if (newChatDraftId(agentId) === draftId) localStorage.setItem(generationKey(agentId), newCommandId())
  return newChatDraftId(agentId)
}

export function consumeChatDraft(
  key: string,
  sent: ComposerDocument,
  agentId: string,
  draftId: string,
  first: boolean,
  extras?: ChatDraftExtras
): void {
  const saved = loadLocalThreadComposerDraft(key)
  const same =
    !saved ||
    (composerDocumentsEqualDirect(saved.content, sent) &&
      (!extras ||
        (JSON.stringify(saved.attachments) === JSON.stringify(extras.attachments) &&
          JSON.stringify(saved.quotes) === JSON.stringify(extras.quotes))))
  if (first && newChatDraftId(agentId) === draftId) {
    const next = newCommandId()
    if (saved && !same) {
      saveLocalThreadComposerDraft({ ...saved, threadId: chatDraftKey(agentId, null, agentId + ':' + next) })
    }
    localStorage.setItem(generationKey(agentId), next)
    clearLocalThreadComposerDraft(key)
  } else if (same) {
    clearLocalThreadComposerDraft(key)
  }
}

export function attachSourceThreadToDraft(
  agentId: string,
  chatId: string | null,
  source: { threadId: string; title: string }
): void {
  const key = chatDraftKey(agentId, chatId, newChatDraftId(agentId))
  const current = readChatDraft(key)
  if (
    current.segments.some(
      (part) => part.kind === 'atom' && part.atom.type === 'thread_reference' && part.atom.threadId === source.threadId
    )
  )
    return
  saveChatDraft(key, {
    ...current,
    segments: [
      ...current.segments,
      { kind: 'atom', atom: { type: 'thread_reference', threadId: source.threadId, labelFallback: source.title } },
      { kind: 'text', text: ' ' }
    ]
  })
}

type SelectedSkill = { skillId: string; nameAtSend: string; textOffset?: number }

export function chatInputFromDocument(document: ComposerDocument) {
  let body = ''
  const skills: SelectedSkill[] = []
  for (const segment of document.segments) {
    if (segment.kind === 'atom' && segment.atom.type === 'skill') {
      const { skillId, nameAtSend } = segment.atom
      skills.push({ skillId, nameAtSend, textOffset: body.length })
    }
    body += composerDocumentToPlainText({ version: 2, segments: [segment] })
  }
  return { body, skills }
}

export function chatDocumentFromInput(body: string, skills: SelectedSkill[]): ComposerDocument {
  const segments: ComposerDocument['segments'] = []
  let end = 0
  for (const { skillId, nameAtSend, textOffset } of skills) {
    const token = '/' + nameAtSend
    const at = textOffset ?? body.indexOf(token, end)
    if (at < end || !body.startsWith(token, at)) continue
    if (at > end) segments.push({ kind: 'text', text: body.slice(end, at) })
    segments.push({ kind: 'atom', atom: { type: 'skill', skillId, nameAtSend } })
    end = at + token.length
  }
  if (end < body.length) segments.push({ kind: 'text', text: body.slice(end) })
  const restored: ComposerDocument['segments'] = []
  for (const part of segments) {
    if (part.kind !== 'text') {
      restored.push(part)
      continue
    }
    let start = 0
    for (const match of part.text.matchAll(/\[((?:\\.|[^\]\\])+)\]\(rovai:\/\/(thread|mission)\/([a-z0-9_]+)\)/gu)) {
      const [, title, kind, id] = match
      const labelFallback = title.replace(/\\(.)/gu, '$1')
      const atom =
        kind === 'thread'
          ? { type: 'thread_reference', threadId: id, labelFallback }
          : { type: 'mission_reference', missionId: id, labelFallback }
      if (!validReferenceAtom(atom)) continue
      if (match.index > start) restored.push({ kind: 'text', text: part.text.slice(start, match.index) })
      restored.push({ kind: 'atom', atom })
      start = match.index + match[0].length
    }
    if (start < part.text.length) restored.push({ kind: 'text', text: part.text.slice(start) })
  }
  return { version: 2, segments: restored }
}

type ChatFile = Pick<
  LocalAttachmentSourceView,
  'id' | 'displayName' | 'kind' | 'mediaType' | 'sourcePath' | 'pastedTextPreview'
> & { observedByteSize: number | null }
export type ReturnedChatInput = {
  body: string
  skills: SelectedSkill[]
  quotes: MessageQuoteSnapshot[]
  sourceAttachments: ChatFile[]
}

export function chatExtrasFromInput(input: ReturnedChatInput): ChatDraftExtras {
  return {
    quotes: input.quotes,
    attachments: input.sourceAttachments.map((file) => ({
      ...file,
      byteSize: file.observedByteSize,
      fileCount: file.kind === 'file' ? 1 : null,
      previewKind: file.mediaType?.startsWith('image/') ? 'image' : 'none',
      availability: 'unknown'
    }))
  }
}

export function recoverChatEdit(chatId: string, input: ReturnedChatInput) {
  const key = 'chat:' + chatId
  const draft = loadLocalThreadComposerDraft(key) ?? emptyLocalThreadComposerDraft(key)
  const returned = chatDocumentFromInput(input.body, input.skills)
  const content =
    draft.body && !composerDocumentsEqualDirect(draft.content, returned)
      ? {
          version: 2 as const,
          segments: [...returned.segments, { kind: 'text' as const, text: '\n' }, ...draft.content.segments]
        }
      : returned
  const restored = chatExtrasFromInput(input)
  saveLocalThreadComposerDraft({
    ...draft,
    content,
    body: composerDocumentToPlainText(content),
    revision: draft.revision + 1,
    updatedAt: new Date().toISOString(),
    attachments: [...new Map([...restored.attachments, ...draft.attachments].map((item) => [item.id, item])).values()],
    quotes: [...new Map([...restored.quotes, ...draft.quotes].map((item) => [item.quoteId, item])).values()]
  })
}

export function recoverChatSend(
  input: ReturnedChatInput & { chatId?: string; agentId?: string; draftId?: string },
  result: { chatId?: string }
) {
  if (!result.chatId || (!input.chatId && (!input.agentId || !input.draftId))) return
  const key = input.chatId ? 'chat:' + input.chatId : 'chat-draft:' + input.draftId
  const saved = loadLocalThreadComposerDraft(key)
  if (!saved) return
  const sent = chatInputFromDocument(saved.content)
  const same =
    sent.body === input.body &&
    JSON.stringify(sent.skills) === JSON.stringify(input.skills) &&
    JSON.stringify(saved.attachments.map((item) => item.id)) ===
      JSON.stringify(input.sourceAttachments.map((item) => item.id)) &&
    JSON.stringify(saved.quotes.map((item) => item.quoteId)) ===
      JSON.stringify(input.quotes.map((item) => item.quoteId))
  if (same) consumeChatDraft(key, saved.content, input.agentId ?? '', input.draftId ?? '', !input.chatId)
  else if (!input.chatId && newChatDraftId(input.agentId!) === input.draftId) {
    const next = forkConflictedChat(input.agentId!, input.draftId!)
    saveLocalThreadComposerDraft({ ...saved, threadId: 'chat-draft:' + next })
    clearLocalThreadComposerDraft(key)
  }
}
