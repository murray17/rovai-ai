import type { ComposerDocument } from '@contracts'
import {
  $getNodeByKey,
  $getRoot,
  $isTextNode,
  type EditorState,
  type LexicalEditor,
  type NodeKey,
  type TextNode,
  type UpdateListenerPayload
} from 'lexical'
import { $isComposerAtomNode, type ComposerAtomNode } from './ComposerAtomNode'
import { editorStateToComposerDocument } from './composer-editor-state'
import type { ComposerLocalStatus } from './composer-document'

export const COMPOSER_DRAFT_DEBOUNCE_MS = 350
export const COMPOSER_DRAFT_MAX_WAIT_MS = 1_500

export const ROVAI_ATOM_PRESENTATION_TAG = 'rovai:atom-presentation'
export const ROVAI_COMPOSER_INITIALIZE_TAG = 'rovai:composer-initialize'
export const ROVAI_COMPOSER_REPLACE_TAG = 'rovai:composer-replace'

export interface ComposerPersistContext {
  localVersion: number
}

export interface ComposerFlushResult<Result = unknown> {
  document: ComposerDocument
  localVersion: number
  savedVersion: number
  result: Result | null
}

export interface ComposerFlushOptions {
  holdPersistence?: boolean
}

export interface ComposerDraftSyncBindings<Result = unknown> {
  persist?: (document: ComposerDocument, context: ComposerPersistContext) => Promise<Result>
  currentResult?: () => Result | null
  atomIsAvailable(node: ComposerAtomNode): boolean
  onSaved?: (result: Result, localVersion: number) => void
  onStatusChange?: (status: ComposerLocalStatus) => void
  onDirtyChange?: (dirty: boolean) => void
}

interface NodeContribution {
  content: number
  explicitRecipient: number
  unavailableAtom: number
}

type AtomAvailabilityBinding = Pick<ComposerDraftSyncBindings<never>, 'atomIsAvailable'>

const EMPTY_CONTRIBUTION: NodeContribution = {
  content: 0,
  explicitRecipient: 0,
  unavailableAtom: 0
}

export class ComposerDraftSync<Result = unknown> {
  readonly editor: LexicalEditor
  private bindings: ComposerDraftSyncBindings<Result>
  private latestEditorState: EditorState
  private localVersion = 0
  private savedVersion = 0
  private savingVersion: number | null = null
  private latestResult: Result | null = null
  private dirty = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private persistenceHeld = false
  private contributions = new Map<NodeKey, NodeContribution>()
  private totals: NodeContribution = { ...EMPTY_CONTRIBUTION }
  private lastStatus: ComposerLocalStatus | null = null

  constructor(
    editor: LexicalEditor,
    editorState: EditorState,
    bindings: ComposerDraftSyncBindings<Result>
  ) {
    this.editor = editor
    this.latestEditorState = editorState
    this.bindings = bindings
    this.latestResult = bindings.currentResult?.() ?? null
    this.rebuildContributions(editorState)
  }

  updateBindings(bindings: ComposerDraftSyncBindings<Result>): void {
    this.bindings = bindings
    this.refreshAtomAvailability()
  }

  acceptAuthoritativeState(editorState: EditorState, result: Result | null): void {
    this.clearTimers()
    this.latestEditorState = editorState
    this.localVersion = 0
    this.savedVersion = 0
    this.savingVersion = null
    this.latestResult = result
    this.persistenceHeld = false
    this.setDirty(false)
    this.rebuildContributions(editorState)
  }

  handleEditorUpdate(payload: UpdateListenerPayload): void {
    this.latestEditorState = payload.editorState
    if (
      payload.tags.has(ROVAI_ATOM_PRESENTATION_TAG)
      || payload.tags.has(ROVAI_COMPOSER_INITIALIZE_TAG)
      || payload.tags.has(ROVAI_COMPOSER_REPLACE_TAG)
    ) return
    if (payload.dirtyLeaves.size === 0 && payload.dirtyElements.size === 0) return

    this.applyDirtyLeaves(payload.editorState, payload.dirtyLeaves)
    this.localVersion += 1
    this.setDirty(true)
    if (this.bindings.persist) this.scheduleSave()
  }

  getLocalVersion(): number {
    return this.localVersion
  }

  isDirty(): boolean {
    return this.dirty
  }

  getStatus(): ComposerLocalStatus {
    return this.statusFromTotals()
  }

  async flush(options: ComposerFlushOptions = {}): Promise<ComposerFlushResult<Result>> {
    if (options.holdPersistence) this.persistenceHeld = true
    this.clearTimers()
    const targetVersion = this.localVersion
    const targetEditorState = this.latestEditorState
    if (this.bindings.persist) {
      if (this.inFlight) await this.inFlight.catch(() => undefined)
      if (this.savedVersion < targetVersion || this.latestResult === null) {
        await this.startSave(targetVersion, targetEditorState)
      }
      if (this.inFlight) await this.inFlight
    }
    return {
      document: editorStateToComposerDocument(targetEditorState),
      localVersion: targetVersion,
      savedVersion: this.savedVersion,
      result: this.latestResult ?? this.bindings.currentResult?.() ?? null
    }
  }

  resumePersistence(): void {
    if (!this.persistenceHeld) return
    this.persistenceHeld = false
    if (this.bindings.persist && this.savedVersion < this.localVersion) this.scheduleSave()
  }

  destroy(): void {
    this.clearTimers()
  }

  private scheduleSave(): void {
    if (this.persistenceHeld) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer)
      this.maxWaitTimer = null
      void this.saveLatest().catch(() => undefined)
    }, COMPOSER_DRAFT_DEBOUNCE_MS)
    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => {
        this.maxWaitTimer = null
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer)
          this.debounceTimer = null
        }
        void this.saveLatest().catch(() => undefined)
      }, COMPOSER_DRAFT_MAX_WAIT_MS)
    }
  }

  private async saveLatest(): Promise<void> {
    if (!this.bindings.persist) return
    if (this.inFlight) return this.inFlight
    if (this.savedVersion >= this.localVersion && this.latestResult !== null) return
    return this.startSave(this.localVersion, this.latestEditorState)
  }

  private startSave(version: number, editorState: EditorState): Promise<void> {
    const persist = this.bindings.persist
    if (!persist) return Promise.resolve()
    if (this.inFlight) return this.inFlight
    const document = editorStateToComposerDocument(editorState)
    this.savingVersion = version
    const operation = persist(document, { localVersion: version })
      .then((result) => {
        this.savedVersion = Math.max(this.savedVersion, version)
        this.latestResult = result
        this.bindings.onSaved?.(result, version)
        if (this.localVersion === version) this.setDirty(false)
      })
      .finally(() => {
        this.savingVersion = null
        this.inFlight = null
        if (!this.persistenceHeld && this.localVersion > version && this.bindings.persist) {
          void this.startSave(this.localVersion, this.latestEditorState).catch(() => undefined)
        }
      })
    this.inFlight = operation
    return operation
  }

  private clearTimers(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer)
    this.debounceTimer = null
    this.maxWaitTimer = null
  }

  private setDirty(dirty: boolean): void {
    if (this.dirty === dirty) return
    this.dirty = dirty
    this.bindings.onDirtyChange?.(dirty)
  }

  private rebuildContributions(editorState: EditorState): void {
    this.contributions.clear()
    this.totals = { ...EMPTY_CONTRIBUTION }
    editorState.read(() => {
      for (const node of $getRoot().getAllTextNodes()) {
        this.replaceContribution(node.getKey(), contributionForNode(node, this.bindings))
      }
    })
    this.emitStatusIfChanged()
  }

  private applyDirtyLeaves(editorState: EditorState, dirtyLeaves: ReadonlySet<NodeKey>): void {
    editorState.read(() => {
      for (const key of dirtyLeaves) {
        const node = $getNodeByKey(key)
        this.replaceContribution(
          key,
          node && $isTextNode(node)
            ? contributionForNode(node, this.bindings)
            : null
        )
      }
    })
    this.emitStatusIfChanged()
  }

  private refreshAtomAvailability(): void {
    this.latestEditorState.read(() => {
      for (const key of this.contributions.keys()) {
        const node = $getNodeByKey(key)
        if ($isComposerAtomNode(node)) {
          this.replaceContribution(key, contributionForNode(node, this.bindings))
        }
      }
    })
    this.emitStatusIfChanged()
  }

  private replaceContribution(key: NodeKey, next: NodeContribution | null): void {
    const previous = this.contributions.get(key)
    if (previous) {
      this.totals.content -= previous.content
      this.totals.explicitRecipient -= previous.explicitRecipient
      this.totals.unavailableAtom -= previous.unavailableAtom
    }
    if (!next) {
      this.contributions.delete(key)
      return
    }
    this.contributions.set(key, next)
    this.totals.content += next.content
    this.totals.explicitRecipient += next.explicitRecipient
    this.totals.unavailableAtom += next.unavailableAtom
  }

  private statusFromTotals(): ComposerLocalStatus {
    return {
      hasContent: this.totals.content > 0,
      hasExplicitRecipient: this.totals.explicitRecipient > 0,
      hasUnavailableAtom: this.totals.unavailableAtom > 0
    }
  }

  private emitStatusIfChanged(): void {
    const status = this.statusFromTotals()
    if (
      this.lastStatus?.hasContent === status.hasContent
      && this.lastStatus.hasExplicitRecipient === status.hasExplicitRecipient
      && this.lastStatus.hasUnavailableAtom === status.hasUnavailableAtom
    ) return
    this.lastStatus = status
    this.bindings.onStatusChange?.(status)
  }
}

function contributionForNode(
  node: TextNode,
  bindings: AtomAvailabilityBinding
): NodeContribution {
  if ($isComposerAtomNode(node)) {
    const type = node.getAtomType()
    return {
      content: 1,
      explicitRecipient: type === 'member' || type === 'all_members' ? 1 : 0,
      unavailableAtom: bindings.atomIsAvailable(node) ? 0 : 1
    }
  }
  return {
    content: node.getTextContent().trim().length > 0 ? 1 : 0,
    explicitRecipient: 0,
    unavailableAtom: 0
  }
}
