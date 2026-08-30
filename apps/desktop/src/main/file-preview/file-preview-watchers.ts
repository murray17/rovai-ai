import { watch, type FSWatcher } from 'node:fs'
import { relative, sep } from 'node:path'
import type { FilePreviewExternalUpdateEvent } from '@contracts'

export interface RootWatchSubscription {
  handleId: string
  webContentsId: number
  campId: string
  previewKey: string
  canonicalFilePath: string
}

export interface RootWatchNotification extends FilePreviewExternalUpdateEvent {
  webContentsId: number
}

type WatchFactory = (
  root: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
) => FSWatcher

interface RootWatchEntry {
  root: string
  watcher: FSWatcher
  subscriptions: Map<string, RootWatchSubscription & { relativeIdentity: string }>
  pending: Map<string, Set<string>>
  flushTimer: ReturnType<typeof setTimeout> | null
  eventSequence: number
}

function normalizeIdentity(value: string, platform: NodeJS.Platform): string {
  const normalized = value
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== '.')
    .join('/')
  return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

function pathEventMatches(changed: string | null, relativeIdentity: string): boolean {
  if (changed === null || changed.length === 0) return true
  return changed === relativeIdentity
    || relativeIdentity.startsWith(`${changed}/`)
}

export class RootWatchRegistry {
  readonly #entries = new Map<string, RootWatchEntry>()
  readonly #subscriptionRoots = new Map<string, string>()
  readonly #watchFactory: WatchFactory
  readonly #notify: (notification: RootWatchNotification) => void
  readonly #platform: NodeJS.Platform

  constructor({
    notify,
    platform = process.platform,
    watchFactory = (root, listener) => watch(root, { recursive: true }, listener)
  }: {
    notify(notification: RootWatchNotification): void
    platform?: NodeJS.Platform
    watchFactory?: WatchFactory
  }) {
    this.#notify = notify
    this.#platform = platform
    this.#watchFactory = watchFactory
  }

  subscribe(root: string, subscription: RootWatchSubscription): number {
    this.unsubscribe(subscription.handleId)
    const rootKey = normalizeIdentity(root, this.#platform)
    let entry = this.#entries.get(rootKey)
    if (!entry) {
      const watcher = this.#watchFactory(root, (eventType, filename) => {
        this.#handleEvent(rootKey, eventType, filename)
      })
      entry = {
        root,
        watcher,
        subscriptions: new Map(),
        pending: new Map(),
        flushTimer: null,
        eventSequence: 0
      }
      watcher.on('error', () => this.#dropEntry(rootKey))
      this.#entries.set(rootKey, entry)
    }
    const relativeIdentity = normalizeIdentity(
      relative(entry.root, subscription.canonicalFilePath).split(sep).join('/'),
      this.#platform
    )
    entry.subscriptions.set(subscription.handleId, { ...subscription, relativeIdentity })
    this.#subscriptionRoots.set(subscription.handleId, rootKey)
    return entry.eventSequence
  }

  sequence(root: string): number {
    return this.#entries.get(normalizeIdentity(root, this.#platform))?.eventSequence ?? 0
  }

  unsubscribe(handleId: string): void {
    const rootKey = this.#subscriptionRoots.get(handleId)
    if (!rootKey) return
    this.#subscriptionRoots.delete(handleId)
    const entry = this.#entries.get(rootKey)
    if (!entry) return
    entry.subscriptions.delete(handleId)
    if (entry.subscriptions.size === 0) this.#dropEntry(rootKey)
  }

  releaseCamp(webContentsId: number, campId: string): void {
    const handles: string[] = []
    for (const entry of this.#entries.values()) {
      for (const subscription of entry.subscriptions.values()) {
        if (subscription.webContentsId === webContentsId && subscription.campId === campId) {
          handles.push(subscription.handleId)
        }
      }
    }
    for (const handleId of handles) this.unsubscribe(handleId)
  }

  releaseWindow(webContentsId: number): void {
    const handles: string[] = []
    for (const entry of this.#entries.values()) {
      for (const subscription of entry.subscriptions.values()) {
        if (subscription.webContentsId === webContentsId) handles.push(subscription.handleId)
      }
    }
    for (const handleId of handles) this.unsubscribe(handleId)
  }

  closeAll(): void {
    for (const rootKey of [...this.#entries.keys()]) this.#dropEntry(rootKey)
    this.#subscriptionRoots.clear()
  }

  get rootCount(): number {
    return this.#entries.size
  }

  #handleEvent(rootKey: string, _eventType: string, filename: string | Buffer | null): void {
    const entry = this.#entries.get(rootKey)
    if (!entry) return
    entry.eventSequence += 1
    const decoded = typeof filename === 'string'
      ? normalizeIdentity(filename, this.#platform)
      : Buffer.isBuffer(filename)
        ? normalizeIdentity(filename.toString('utf8'), this.#platform)
        : null
    for (const subscription of entry.subscriptions.values()) {
      if (!pathEventMatches(decoded, subscription.relativeIdentity)) continue
      const key = `${subscription.webContentsId}\0${subscription.campId}`
      const previewKeys = entry.pending.get(key) ?? new Set<string>()
      previewKeys.add(subscription.previewKey)
      entry.pending.set(key, previewKeys)
    }
    if (entry.pending.size === 0 || entry.flushTimer) return
    entry.flushTimer = setTimeout(() => this.#flush(rootKey), 50)
  }

  #flush(rootKey: string): void {
    const entry = this.#entries.get(rootKey)
    if (!entry) return
    entry.flushTimer = null
    const pending = entry.pending
    entry.pending = new Map()
    for (const [key, previewKeys] of pending) {
      const [webContentsId, campId] = key.split('\0')
      this.#notify({
        webContentsId: Number(webContentsId),
        campId,
        previewKeys: [...previewKeys]
      })
    }
  }

  #dropEntry(rootKey: string): void {
    const entry = this.#entries.get(rootKey)
    if (!entry) return
    if (entry.flushTimer) clearTimeout(entry.flushTimer)
    entry.watcher.close()
    for (const handleId of entry.subscriptions.keys()) this.#subscriptionRoots.delete(handleId)
    this.#entries.delete(rootKey)
  }
}
