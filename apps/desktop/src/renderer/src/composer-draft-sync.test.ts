import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComposerDocument } from '@contracts'
import {
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  createEditor,
  type LexicalEditor
} from 'lexical'
import { ComposerAtomNode } from './ComposerAtomNode'
import {
  ComposerDraftSync,
  COMPOSER_DRAFT_RETRY_DELAYS_MS,
  ROVAI_ATOM_PRESENTATION_TAG,
  ROVAI_COMPOSER_INITIALIZE_TAG,
  ROVAI_INPUT_HISTORY_PREVIEW_TAG,
  StaleComposerSyncEpochError
} from './composer-draft-sync'
import {
  $replaceEditorWithComposerDocument
} from './composer-editor-state'

function createComposerEditor(text = ''): LexicalEditor {
  const editor = createEditor({
    namespace: `ComposerSyncTest-${crypto.randomUUID()}`,
    nodes: [ComposerAtomNode],
    onError(error) { throw error }
  })
  editor.update(() => {
    $replaceEditorWithComposerDocument({
      version: 2,
      segments: text ? [{ kind: 'text', text }] : []
    })
  }, { discrete: true })
  return editor
}

function replaceText(editor: LexicalEditor, value: string): void {
  editor.update(() => {
    const paragraph = $getRoot().getFirstChildOrThrow()
    if (!$isElementNode(paragraph)) throw new Error('expected paragraph')
    const first = paragraph.getFirstChild()
    if ($isTextNode(first)) first.setTextContent(value)
    else paragraph.append($createTextNode(value))
  }, { discrete: true })
}

afterEach(() => vi.useRealTimers())

describe('ComposerDraftSync', () => {
  it('counts a file-only live edit as input and refreshes its availability without changing recipients', () => {
    const editor = createComposerEditor()
    const bindings = { atomIsAvailable: () => true }
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), bindings)
    const stop = editor.registerUpdateListener(payload => sync.handleEditorUpdate(payload))
    editor.update(() => $replaceEditorWithComposerDocument({ version: 2, segments: [
      { kind: 'atom', atom: { type: 'project_file_reference', threadId: 'thread', rawReference: 'opaque', labelFallback: 'src/file.test.ts' } },
      { kind: 'text', text: ' ' }
    ] }), { discrete: true })
    expect(sync.getStatus()).toMatchObject({ hasContent: true, hasExplicitRecipient: false, hasUnavailableAtom: false, memberAgentIds: [] })
    sync.updateBindings({ atomIsAvailable: () => false })
    expect(sync.getStatus()).toMatchObject({ hasContent: true, hasUnavailableAtom: true, memberAgentIds: [] })
    stop(); sync.destroy()
  })
  it('publishes effective reference identities when unsaved edits recover before persistence', async () => {
    vi.useFakeTimers()
    const editor = createComposerEditor()
    const effective = vi.fn()
    const persist = vi.fn(async (_document: ComposerDocument) => {})
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      atomIsAvailable: () => true, persist, onEffectiveDocumentChange: effective
    })
    const unregister = editor.registerUpdateListener(payload => sync.handleEditorUpdate(payload))
    const recovered: ComposerDocument = { version: 2, segments: [
      { kind: 'atom', atom: { type: 'mission_reference', missionId: 'rvm_0199f2ec587a70008000000000000001', labelFallback: '恢复使命' } }
    ] }
    editor.update(() => $replaceEditorWithComposerDocument(recovered), { discrete: true, tag: ROVAI_COMPOSER_INITIALIZE_TAG })
    expect(effective).not.toHaveBeenCalled()
    sync.restoreLocalState(editor.getEditorState())
    expect(effective).toHaveBeenLastCalledWith(recovered)
    expect(persist).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(350)
    expect(persist).toHaveBeenCalledWith(recovered, { localVersion: 1 })
    unregister(); sync.destroy()
  })

  it('previews live recipients while autosave and leave flush retain the original dirty draft', async () => {
    vi.useFakeTimers()
    const editor = createComposerEditor('saved')
    const persist = vi.fn(async (_document: ComposerDocument) => {})
    const localChange = vi.fn()
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      atomIsAvailable: () => true, persist, onLocalDocumentChange: localChange
    })
    const unregister = editor.registerUpdateListener(payload => sync.handleEditorUpdate(payload))
    replaceText(editor, 'unsaved draft')
    const draft = editor.getEditorState()
    const historical: ComposerDocument = { version: 2, segments: [
      { kind: 'atom', atom: { type: 'member', agentId: 'history-recipient' } },
      { kind: 'text', text: ' history' }
    ] }
    editor.update(() => $replaceEditorWithComposerDocument(historical),
      { discrete: true, tag: ROVAI_INPUT_HISTORY_PREVIEW_TAG })
    expect(sync.getStatus().memberAgentIds).toEqual(['history-recipient'])
    expect(localChange).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(350)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(editorStateText(persist.mock.calls[0][0])).toBe('unsaved draft')
    expect(editorStateText((await sync.flush()).document)).toBe('unsaved draft')
    editor.setEditorState(draft, { tag: ROVAI_INPUT_HISTORY_PREVIEW_TAG })
    sync.restoreHistoryDraft()
    expect(sync.getStatus().memberAgentIds).toEqual([])
    expect(editorStateText((await sync.flush()).document)).toBe('unsaved draft')
    unregister()
    sync.destroy()
  })

  it('adopts preview before sending and lets ordinary edits leave preview without losing persistence', async () => {
    const editor = createComposerEditor('original')
    const persist = vi.fn(async (_document: ComposerDocument) => {})
    const localChange = vi.fn()
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      atomIsAvailable: () => true, persist, onLocalDocumentChange: localChange
    })
    const unregister = editor.registerUpdateListener(payload => sync.handleEditorUpdate(payload))
    const show = (text: string) => editor.update(() => $replaceEditorWithComposerDocument({
      version: 2, segments: [{ kind: 'text', text }]
    }), { discrete: true, tag: ROVAI_INPUT_HISTORY_PREVIEW_TAG })
    show('send this')
    sync.adoptHistoryPreview()
    expect(editorStateText((await sync.flush()).document)).toBe('send this')
    expect(localChange).toHaveBeenCalledTimes(1)
    show('second history')
    replaceText(editor, 'second history edited')
    expect(editorStateText((await sync.flush()).document)).toBe('second history edited')
    expect(persist.mock.calls.map(([document]) => editorStateText(document))).toEqual(['send this', 'second history edited'])
    unregister()
    sync.destroy()
  })

  it('derives pending member identities from the live editor after each atom removal', () => {
    const editor = createComposerEditor()
    const seen: string[][] = []
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      currentDraft: () => ({ revision: 0 }),
      atomIsAvailable: () => true,
      onStatusChange: (status) => seen.push(status.memberAgentIds)
    })
    const unregister = editor.registerUpdateListener((payload) => sync.handleEditorUpdate(payload))
    const replace = (count: number): void => {
      editor.update(() => $replaceEditorWithComposerDocument({
        version: 2,
        segments: Array.from({ length: count }, () => ({
          kind: 'atom' as const,
          atom: { type: 'member' as const, agentId: 'outside', labelFallback: 'Alice' }
        }))
      }), { discrete: true })
    }

    replace(2)
    expect(sync.getStatus().memberAgentIds).toEqual(['outside'])
    replace(1)
    expect(sync.getStatus().memberAgentIds).toEqual(['outside'])
    replace(0)
    expect(sync.getStatus().memberAgentIds).toEqual([])
    expect(seen).toEqual([[], ['outside'], []])

    unregister()
    sync.destroy()
  })

  it('does not serialize on a key update and snapshots only at the debounce boundary', async () => {
    vi.useFakeTimers()
    const editor = createComposerEditor()
    const persisted: string[] = []
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      currentDraft: () => ({ revision: 0 }),
      atomIsAvailable: () => true,
      persist: async (document) => {
        persisted.push(editorStateText(document))
      }
    })
    const unregister = editor.registerUpdateListener((payload) => sync.handleEditorUpdate(payload))

    replaceText(editor, '本地输入')
    expect(sync.getLocalVersion()).toBe(1)
    expect(sync.isDirty()).toBe(true)
    expect(persisted).toEqual([])

    await vi.advanceTimersByTimeAsync(349)
    expect(persisted).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(persisted).toEqual(['本地输入'])
    expect(sync.isDirty()).toBe(false)

    unregister()
    sync.destroy()
  })

  it('coalesces edits made during one save into the newest single-flight snapshot', async () => {
    const editor = createComposerEditor()
    const persisted: string[] = []
    const releases: Array<() => void> = []
    let concurrent = 0
    let maxConcurrent = 0
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      currentDraft: () => ({ revision: 0 }),
      atomIsAvailable: () => true,
      persist: async (document) => {
        persisted.push(editorStateText(document))
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise<void>((resolve) => releases.push(resolve))
        concurrent -= 1
      }
    })
    const unregister = editor.registerUpdateListener((payload) => sync.handleEditorUpdate(payload))

    replaceText(editor, '版本 1')
    const first = sync.flush()
    await vi.waitFor(() => expect(persisted).toEqual(['版本 1']))
    replaceText(editor, '版本 2')
    replaceText(editor, '版本 3')
    releases.shift()?.()
    await vi.waitFor(() => expect(persisted).toEqual(['版本 1', '版本 3']))
    expect(maxConcurrent).toBe(1)
    releases.shift()?.()
    await first
    await sync.flush()
    expect(sync.isDirty()).toBe(false)

    unregister()
    sync.destroy()
  })

  it('persists by max-wait even while successive edits keep resetting debounce', async () => {
    vi.useFakeTimers()
    const editor = createComposerEditor()
    const persisted: string[] = []
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      currentDraft: () => ({ revision: 0 }),
      atomIsAvailable: () => true,
      persist: async (document) => {
        persisted.push(editorStateText(document))
      }
    })
    const unregister = editor.registerUpdateListener((payload) => sync.handleEditorUpdate(payload))

    for (let version = 1; version <= 5; version += 1) {
      replaceText(editor, `版本 ${version}`)
      await vi.advanceTimersByTimeAsync(300)
    }
    expect(persisted).toEqual(['版本 5'])

    unregister()
    sync.destroy()
  })

  it('starts a fresh max-wait window after a debounced snapshot completes', async () => {
    vi.useFakeTimers()
    const editor = createComposerEditor()
    const persisted: string[] = []
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      currentDraft: () => ({ revision: 0 }),
      atomIsAvailable: () => true,
      persist: async (document) => {
        persisted.push(editorStateText(document))
      }
    })
    const unregister = editor.registerUpdateListener((payload) => sync.handleEditorUpdate(payload))

    replaceText(editor, '第一轮')
    await vi.advanceTimersByTimeAsync(350)
    expect(persisted).toEqual(['第一轮'])

    for (let version = 2; version <= 5; version += 1) {
      await vi.advanceTimersByTimeAsync(version === 2 ? 50 : 300)
      replaceText(editor, `第二轮 ${version}`)
    }
    await vi.advanceTimersByTimeAsync(200)
    expect(persisted).toEqual(['第一轮'])
    await vi.advanceTimersByTimeAsync(400)
    expect(persisted).toEqual(['第一轮', '第二轮 5'])

    unregister()
    sync.destroy()
  })

  it('refreshes Atom availability without changing content version or dirty state', () => {
    const editor = createComposerEditor()
    editor.update(() => {
      $replaceEditorWithComposerDocument({
        version: 2,
        segments: [{ kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } }]
      })
    }, { discrete: true })
    let available = true
    const statuses: boolean[] = []
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      currentDraft: () => ({ revision: 1 }),
      atomIsAvailable: () => available,
      onStatusChange: (status) => statuses.push(status.hasUnavailableAtom)
    })
    const unregister = editor.registerUpdateListener((payload) => sync.handleEditorUpdate(payload))

    available = false
    sync.updateBindings({
      currentDraft: () => ({ revision: 1 }),
      atomIsAvailable: () => available,
      onStatusChange: (status) => statuses.push(status.hasUnavailableAtom)
    })
    editor.update(() => {
      const atom = $getRoot().getFirstDescendant()
      if ($isTextNode(atom)) atom.markDirty()
    }, { discrete: true, tag: ROVAI_ATOM_PRESENTATION_TAG })

    expect(statuses).toEqual([false, true])
    expect(sync.getLocalVersion()).toBe(0)
    expect(sync.isDirty()).toBe(false)

    unregister()
    sync.destroy()
  })

  it('keeps a failed autosave dirty, exposes an error, and retries with a finite backoff', async () => {
    vi.useFakeTimers()
    const editor = createComposerEditor()
    const errors: Array<Error | null> = []
    let attempts = 0
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      atomIsAvailable: () => true,
      persist: async () => {
        attempts += 1
        if (attempts < 3) throw new Error(`save ${attempts} failed`)
      },
      onPersistenceErrorChange: (error) => errors.push(error)
    })
    const unregister = editor.registerUpdateListener((payload) => sync.handleEditorUpdate(payload))

    replaceText(editor, '需要重试')
    await vi.advanceTimersByTimeAsync(350)
    expect(attempts).toBe(1)
    expect(sync.isDirty()).toBe(true)
    expect(sync.getPersistenceStatus()).toMatchObject({ state: 'error' })

    await vi.advanceTimersByTimeAsync(COMPOSER_DRAFT_RETRY_DELAYS_MS[0])
    expect(attempts).toBe(2)
    await vi.advanceTimersByTimeAsync(COMPOSER_DRAFT_RETRY_DELAYS_MS[1])
    expect(attempts).toBe(3)
    expect(sync.isDirty()).toBe(false)
    expect(sync.getPersistenceStatus()).toEqual({ state: 'saved' })
    expect(errors.map((error) => error?.message ?? null)).toEqual([
      'save 1 failed', 'save 2 failed', null
    ])

    unregister()
    sync.destroy()
  })

  it('does not let an old epoch save completion mark replacement content as saved', async () => {
    const editor = createComposerEditor()
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      atomIsAvailable: () => true,
      persist: async () => pending
    })
    const unregister = editor.registerUpdateListener((payload) => sync.handleEditorUpdate(payload))

    replaceText(editor, 'old draft')
    const oldFlush = sync.flush()
    await Promise.resolve()
    const replacement = createComposerEditor('new draft').getEditorState()
    sync.acceptAuthoritativeState(replacement)
    release()
    await expect(oldFlush).rejects.toBeInstanceOf(StaleComposerSyncEpochError)

    expect(sync.getLocalVersion()).toBe(0)
    expect(sync.getSavedVersion()).toBe(0)
    expect(sync.isDirty()).toBe(false)
    expect(sync.getPersistenceStatus()).toEqual({ state: 'saved' })

    unregister()
    sync.destroy()
  })

  it('returns the authoritative value read after the captured snapshot is persisted', async () => {
    const editor = createComposerEditor()
    let authority = { revision: 3 }
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      atomIsAvailable: () => true,
      currentDraft: () => authority,
      waitForAuthority: async () => { authority = { revision: 4 } }
    })

    const flushed = await sync.flush()

    expect(flushed.draft).toEqual({ revision: 4 })
    sync.destroy()
  })
})

function editorStateText(document: ComposerDocument): string {
  return document.segments.map((segment) => segment.kind === 'text' ? segment.text : '').join('')
}
