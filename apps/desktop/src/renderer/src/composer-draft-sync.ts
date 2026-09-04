import type { ComposerDocument } from '@contracts'
import {
  $getNodeByKey,
  $getRoot,
  $isTextNode,
  $nodesOfType,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type UpdateListenerPayload
} from 'lexical'
import { $isComposerAtomNode, ComposerAtomNode } from './ComposerAtomNode'
import { editorStateToComposerDocument } from './composer-editor-state'
import type { ComposerLocalStatus } from './composer-document'

export const COMPOSER_DRAFT_DEBOUNCE_MS = 350
export const COMPOSER_DRAFT_MAX_WAIT_MS = 1_500
export const COMPOSER_DRAFT_RETRY_DELAYS_MS = [500, 1_500] as const

export const ROVAI_ATOM_PRESENTATION_TAG = 'rovai:atom-presentation'
export const ROVAI_COMPOSER_INITIALIZE_TAG = 'rovai:composer-initialize'
export const ROVAI_COMPOSER_REPLACE_TAG = 'rovai:composer-replace'

export interface ComposerPersistContext {
  localVersion: number
}

export interface ComposerFlushResult<Draft = unknown> {
  document: ComposerDocument
  localVersion: number
  savedVersion: number
  draft: Draft | null
}

export interface ComposerFlushOptions {
  holdPersistence?: boolean
}

export interface ComposerDraftSyncBindings<Draft = unknown> {
  persist?: (document: ComposerDocument, context: ComposerPersistContext) => Promise<void>
  waitForAuthority?: () => Promise<void>
  currentDraft?: () => Draft | null
  atomIsAvailable(node: ComposerAtomNode): boolean
  onSaved?: (localVersion: number) => void
  onStatusChange?: (status: ComposerLocalStatus) => void
  onDirtyChange?: (dirty: boolean) => void
  onPersistenceStatusChange?: (status: ComposerDraftPersistenceStatus) => void
}

export type ComposerDraftPersistenceStatus =
  | { state: 'saved' }
  | { state: 'dirty' }
  | { state: 'saving' }
  | { state: 'error'; error: Error }

export class StaleComposerSyncEpochError extends Error {
  constructor() {
    super('Composer persistence operation belongs to a stale editing epoch.')
    this.name = 'StaleComposerSyncEpochError'
  }
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

export class ComposerDraftSync<Draft = unknown> {
  readonly editor: LexicalEditor
  private bindings: ComposerDraftSyncBindings<Draft>
  private latestEditorState: EditorState
  private localVersion = 0
  private savedVersion = 0
  private savingVersion: number | null = null
  private epoch = 0
  private dirty = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0
  private inFlight: { epoch: number; promise: Promise<void> } | null = null
  private persistenceHeld = false
  private persistenceStatus: ComposerDraftPersistenceStatus = { state: 'saved' }
  private contributions = new Map<NodeKey, NodeContribution>()
  private totals: NodeContribution = { ...EMPTY_CONTRIBUTION }
  private lastStatus: ComposerLocalStatus | null = null

  constructor(
    editor: LexicalEditor,
    editorState: EditorState,
    bindings: ComposerDraftSyncBindings<Draft>
  ) {
    this.editor = editor
    this.latestEditorState = editorState
    this.bindings = bindings
    this.rebuildContributions(editorState)
  }

  updateBindings(bindings: ComposerDraftSyncBindings<Draft>): void {
    this.bindings = bindings
    this.refreshAtomAvailability()
  }

  acceptAuthoritativeState(editorState: EditorState): void {
    this.clearTimers()
    this.epoch += 1
    this.latestEditorState = editorState
    this.localVersion = 0
    this.savedVersion = 0
    this.savingVersion = null
    this.inFlight = null
    this.retryAttempt = 0
    this.persistenceHeld = false
    this.setDirty(false)
    this.setPersistenceStatus({ state: 'saved' })
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
    this.retryAttempt = 0
    this.clearRetryTimer()
    this.setDirty(true)
    this.setPersistenceStatus({ state: 'dirty' })
    if (this.bindings.persist) this.scheduleSave()
  }

  getLocalVersion(): number {
    return this.localVersion
  }

  isDirty(): boolean {
    return this.dirty
  }

  getSavedVersion(): number {
    return this.savedVersion
  }

  getPersistenceStatus(): ComposerDraftPersistenceStatus {
    return this.persistenceStatus
  }

  getStatus(): ComposerLocalStatus {
    return this.statusFromTotals()
  }

  async flush(options: ComposerFlushOptions = {}): Promise<ComposerFlushResult<Draft>> {
    if (options.holdPersistence) this.persistenceHeld = true
    this.clearTimers()
    const targetVersion = this.localVersion
    const targetEditorState = this.latestEditorState
    const targetEpoch = this.epoch
    if (this.bindings.persist) {
      const preceding = this.inFlight?.epoch === targetEpoch ? this.inFlight.promise : null
      if (preceding) await preceding.catch(() => undefined)
      this.assertEpoch(targetEpoch)
      if (this.savedVersion < targetVersion) {
        await this.startSave(targetEpoch, targetVersion, targetEditorState, false)
      }
      this.assertEpoch(targetEpoch)
    }
    await this.bindings.waitForAuthority?.()
    this.assertEpoch(targetEpoch)
    return {
      document: editorStateToComposerDocument(targetEditorState),
      localVersion: targetVersion,
      savedVersion: this.savedVersion,
      draft: this.bindings.currentDraft?.() ?? null
    }
  }

  resumePersistence(): void {
    if (!this.persistenceHeld) return
    this.persistenceHeld = false
    if (this.bindings.persist && this.savedVersion < this.localVersion) this.scheduleSave()
  }

  advancePersistenceEpoch(savedLocalVersion = this.savedVersion): void {
    this.clearTimers()
    this.epoch += 1
    this.inFlight = null
    this.savingVersion = null
    this.savedVersion = Math.min(savedLocalVersion, this.localVersion)
    this.retryAttempt = 0
    const dirty = this.localVersion > this.savedVersion
    this.setDirty(dirty)
    this.setPersistenceStatus(dirty ? { state: 'dirty' } : { state: 'saved' })
  }

  destroy(): void {
    this.clearTimers()
    this.epoch += 1
    this.inFlight = null
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
    const existing = this.inFlight?.epoch === this.epoch ? this.inFlight.promise : null
    if (existing) return existing
    if (this.savedVersion >= this.localVersion) return
    return this.startSave(this.epoch, this.localVersion, this.latestEditorState, true)
  }

  private startSave(
    epoch: number,
    version: number,
    editorState: EditorState,
    allowRetry: boolean
  ): Promise<void> {
    const persist = this.bindings.persist
    if (!persist) return Promise.resolve()
    const existing = this.inFlight?.epoch === epoch ? this.inFlight.promise : null
    if (existing) return existing
    const document = editorStateToComposerDocument(editorState)
    this.savingVersion = version
    this.setPersistenceStatus({ state: 'saving' })
    const operation = persist(document, { localVersion: version })
      .then(() => {
        if (epoch !== this.epoch) return
        this.savedVersion = Math.max(this.savedVersion, version)
        this.retryAttempt = 0
        this.bindings.onSaved?.(version)
        const clean = this.localVersion === version
        if (clean) this.setDirty(false)
        this.setPersistenceStatus(clean ? { state: 'saved' } : { state: 'dirty' })
      }, (error: unknown) => {
        if (epoch !== this.epoch) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        this.setDirty(true)
        this.setPersistenceStatus({ state: 'error', error: normalized })
        if (allowRetry) this.scheduleRetry(epoch)
        throw error
      })
      .finally(() => {
        if (this.inFlight?.promise !== operation) return
        this.inFlight = null
        if (epoch !== this.epoch) return
        this.savingVersion = null
        if (!this.persistenceHeld && this.localVersion > version && this.bindings.persist) {
          void this.startSave(
            epoch,
            this.localVersion,
            this.latestEditorState,
            true
          ).catch(() => undefined)
        }
      })
    this.inFlight = { epoch, promise: operation }
    return operation
  }

  private scheduleRetry(epoch: number): void {
    if (this.persistenceHeld || this.retryTimer || epoch !== this.epoch) return
    const delay = COMPOSER_DRAFT_RETRY_DELAYS_MS[this.retryAttempt]
    if (delay === undefined) return
    this.retryAttempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (epoch !== this.epoch || this.persistenceHeld) return
      void this.saveLatest().catch(() => undefined)
    }, delay)
  }

  private clearTimers(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer)
    this.debounceTimer = null
    this.maxWaitTimer = null
    this.clearRetryTimer()
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private setDirty(dirty: boolean): void {
    if (this.dirty === dirty) return
    this.dirty = dirty
    this.bindings.onDirtyChange?.(dirty)
  }

  private setPersistenceStatus(status: ComposerDraftPersistenceStatus): void {
    if (
      this.persistenceStatus.state === status.state
      && (status.state !== 'error'
        || (this.persistenceStatus.state === 'error'
          && this.persistenceStatus.error === status.error))
    ) return
    this.persistenceStatus = status
    this.bindings.onPersistenceStatusChange?.(status)
  }

  private assertEpoch(epoch: number): void {
    if (epoch !== this.epoch) throw new StaleComposerSyncEpochError()
  }

  private rebuildContributions(editorState: EditorState): void {
    this.contributions.clear()
    this.totals = { ...EMPTY_CONTRIBUTION }
    editorState.read(() => {
      for (const node of $getRoot().getAllTextNodes()) {
        this.replaceContribution(node.getKey(), contributionForNode(node, this.bindings))
      }
      for (const node of $nodesOfType(ComposerAtomNode)) {
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
          node && ($isTextNode(node) || $isComposerAtomNode(node))
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
  node: LexicalNode,
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
  if (!$isTextNode(node)) return EMPTY_CONTRIBUTION
  return {
    content: node.getTextContent().trim().length > 0 ? 1 : 0,
    explicitRecipient: 0,
    unavailableAtom: 0
  }
}
