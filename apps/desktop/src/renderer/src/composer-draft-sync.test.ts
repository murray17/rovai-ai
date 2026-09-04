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

  it('holds persistence at the send snapshot while later input stays local', async () => {
    const editor = createComposerEditor('版本 0')
    const persisted: string[] = []
    let releaseFirst!: () => void
    const firstSave = new Promise<void>((resolve) => { releaseFirst = resolve })
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      currentDraft: () => ({ revision: 0 }),
      atomIsAvailable: () => true,
      persist: async (document) => {
        persisted.push(editorStateText(document))
        if (persisted.length === 1) await firstSave
      }
    })
    const unregister = editor.registerUpdateListener((payload) => sync.handleEditorUpdate(payload))

    replaceText(editor, '发送版本')
    const frozen = sync.flush({ holdPersistence: true })
    await Promise.resolve()
    expect(persisted).toEqual(['发送版本'])

    replaceText(editor, '发送期间的新输入')
    releaseFirst()
    const frozenResult = await frozen
    expect(frozenResult.localVersion).toBe(1)
    expect(editorStateText(frozenResult.document)).toBe('发送版本')
    expect(persisted).toEqual(['发送版本'])

    sync.resumePersistence()
    const current = await sync.flush()
    expect(current.localVersion).toBe(2)
    expect(editorStateText(current.document)).toBe('发送期间的新输入')
    expect(persisted).toEqual(['发送版本', '发送期间的新输入'])

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
    const statuses: string[] = []
    let attempts = 0
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), {
      atomIsAvailable: () => true,
      persist: async () => {
        attempts += 1
        if (attempts < 3) throw new Error(`save ${attempts} failed`)
      },
      onPersistenceStatusChange: (status) => statuses.push(status.state)
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
    expect(statuses).toContain('error')

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
