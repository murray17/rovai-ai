import type { ComposerDocument } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import { composerDocumentsEqualDirect, composerDocumentToPlainText, emptyComposerDocument } from './composer-document'
import { clearLocalThreadComposerDraft, emptyLocalThreadComposerDraft, loadLocalThreadComposerDraft, saveLocalThreadComposerDraft } from './camp-composer-local-store'

const generationKey = (agentId: string) => 'rovai.new-chat-generation:' + agentId

export function newChatDraftId(agentId: string): string {
  return agentId + ':' + (localStorage.getItem(generationKey(agentId)) ?? 'initial')
}

export function chatDraftKey(agentId: string, chatId: string | null, draftId: string): string {
  return chatId ? 'chat:' + chatId : 'chat-draft:' + draftId
}

export function hasNewChatDraft(agentId: string): boolean {
  return Boolean(loadLocalThreadComposerDraft(chatDraftKey(agentId, null, newChatDraftId(agentId))))
}

export function readChatDraft(key: string): ComposerDocument {
  return loadLocalThreadComposerDraft(key)?.content ?? emptyComposerDocument()
}

export function saveChatDraft(key: string, content: ComposerDocument): void {
  const draft = loadLocalThreadComposerDraft(key) ?? emptyLocalThreadComposerDraft(key)
  saveLocalThreadComposerDraft({ ...draft, content, body: composerDocumentToPlainText(content), revision: draft.revision + 1, updatedAt: new Date().toISOString() })
}

export function consumeChatDraft(key: string, sent: ComposerDocument, agentId: string, draftId: string, first: boolean): void {
  if (!composerDocumentsEqualDirect(readChatDraft(key), sent)) return
  if (first && newChatDraftId(agentId) === draftId) localStorage.setItem(generationKey(agentId), newCommandId())
  clearLocalThreadComposerDraft(key)
}

export function attachSourceThreadToDraft(agentId: string, chatId: string | null, source: {threadId: string; title: string}): void {
  const key = chatDraftKey(agentId,chatId,newChatDraftId(agentId))
  const current = readChatDraft(key)
  if (current.segments.some(part => part.kind === 'atom' && part.atom.type === 'thread_reference' && part.atom.threadId === source.threadId)) return
  saveChatDraft(key,{...current,segments:[...current.segments,
    {kind:'atom',atom:{type:'thread_reference',threadId:source.threadId,labelFallback:source.title}}, {kind:'text',text:' '}]})
}

type SelectedSkill = { skillId: string; nameAtSend: string; textOffset?: number }

export function chatInputFromDocument(document: ComposerDocument) {
  let body = ''
  const skills: SelectedSkill[] = []
  for (const segment of document.segments) {
    if (segment.kind === 'atom' && segment.atom.type === 'skill') {
      const {skillId, nameAtSend} = segment.atom
      skills.push({skillId, nameAtSend, textOffset:body.length})
    }
    body += composerDocumentToPlainText({version:2,segments:[segment]})
  }
  return {body, skills}
}

export function chatDocumentFromInput(body: string, skills: SelectedSkill[]): ComposerDocument {
  const segments: ComposerDocument['segments'] = []
  let end = 0
  for (const {skillId,nameAtSend,textOffset} of skills) {
    const token = '/' + nameAtSend
    const at = textOffset ?? body.indexOf(token,end)
    if (at < end || !body.startsWith(token,at)) continue
    if (at > end) segments.push({kind:'text',text:body.slice(end,at)})
    segments.push({kind:'atom',atom:{type:'skill',skillId,nameAtSend}})
    end=at+token.length
  }
  if (end < body.length) segments.push({kind:'text',text:body.slice(end)})
  return {version:2,segments}
}
