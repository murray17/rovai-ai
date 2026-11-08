import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('cleans only drafts in the same public or private conversation scope, including after reload', async () => {
  const stored = new Map<string, string>()
  vi.stubGlobal('window', { sessionStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) }
  } })
  let drafts = await import('./native-interaction-drafts')
  const publicScope = { threadId: 'thread', conversationId: null }
  const privateScope = { threadId: 'thread', conversationId: 'conversation' }
  const otherPrivateScope = { threadId: 'thread', conversationId: 'another-conversation' }
  drafts.saveInteractionDraft(publicScope, 'A', '  公屏草稿  ')
  drafts.saveInteractionDraft(privateScope, 'B', '私聊\n草稿')
  drafts.saveInteractionDraft(otherPrivateScope, 'C', '')
  drafts.retainInteractionDrafts(publicScope, new Set(['A']))
  drafts.retainInteractionDrafts(privateScope, new Set(['B']))
  vi.resetModules()
  drafts = await import('./native-interaction-drafts')
  expect(drafts.interactionDraft(publicScope, 'A', 'prefill')).toBe('  公屏草稿  ')
  expect(drafts.interactionDraft(privateScope, 'B', 'prefill')).toBe('私聊\n草稿')
  expect(drafts.interactionDraft(otherPrivateScope, 'C', 'prefill')).toBe('')
  drafts.retainInteractionDrafts(publicScope, new Set())
  drafts.retainInteractionDrafts(otherPrivateScope, new Set())
  vi.resetModules()
  drafts = await import('./native-interaction-drafts')
  expect(drafts.interactionDraft(publicScope, 'A', 'prefill')).toBe('prefill')
  expect(drafts.interactionDraft(otherPrivateScope, 'C', 'prefill')).toBe('prefill')
  expect(drafts.interactionDraft(privateScope, 'B', 'prefill')).toBe('私聊\n草稿')
})
