import type { AppUpdateSnapshot, AppUpdatesApi } from '@contracts'
import type { ConsoleClient } from './client'

/** Same presentation contract as Desktop; only authenticated Server operations cross HTTP. */
export function createServerUpdates(transport: ConsoleClient, reload = () => location.reload()): AppUpdatesApi {
  let snapshot: AppUpdateSnapshot | null = null
  let restartingFrom: string | null = null
  let restartingAt: number | null = null
  let polling = false
  let issued = 0, accepted = 0
  const listeners = new Set<(value: AppUpdateSnapshot) => void>()
  const request = async (operation: 'get' | 'check' | 'download' | 'install'): Promise<AppUpdateSnapshot> => {
    const generation = ++issued
    const version = operation === 'download' || operation === 'install' ? snapshot?.availableRelease?.version : undefined
    const next = normalizeServerReleaseIdentity(await transport.updates(operation, version), snapshot)
    if (generation < accepted && snapshot) return snapshot
    accepted = generation
    if ((restartingFrom && next.currentVersion !== restartingFrom) || (snapshot && next.currentVersion !== snapshot.currentVersion)) {
      restartingFrom = null
      reload()
    }
    if (next.status === 'installing') {
      restartingFrom = next.currentVersion
      restartingAt ??= Date.now()
    } else { restartingAt = null }
    snapshot = next
    for (const listener of listeners) listener(next)
    return next
  }
  return {
    get: () => request('get'),
    check: () => request(snapshot?.failureReason === 'restart_unconfirmed' ? 'get' : 'check'),
    download: () => request('download'),
    install: async () => {
      restartingFrom = snapshot?.currentVersion ?? null
      restartingAt = Date.now()
      return (await request('install')).status === 'installing'
    },
    dismissPrompt: async () => false,
    onChanged(listener) {
      listeners.add(listener)
      const timer = setInterval(() => {
        if (polling || !transport.authenticated || document.visibilityState !== 'visible') return
        polling = true
        void request('get').catch(() => {
          // A restart temporarily closes HTTP; session recovery belongs to the transport.
          if (snapshot && restartingAt !== null && Date.now() - restartingAt >= 60_000) {
            snapshot = { ...snapshot, status: 'install_failed', failureReason: 'restart_unconfirmed' }
            for (const listener of listeners) listener(snapshot)
            restartingAt = null
          }
        }).finally(() => { polling = false })
      }, 1000)
      return () => { clearInterval(timer); listeners.delete(listener) }
    }
  }
}

/** Older Servers may report the installed release under availableRelease. */
function normalizeServerReleaseIdentity(raw: AppUpdateSnapshot, previous: AppUpdateSnapshot | null): AppUpdateSnapshot {
  const snapshot = {
    ...raw,
    currentRelease: raw.currentRelease
      ?? (previous?.currentVersion === raw.currentVersion ? previous.currentRelease : null)
  }
  const release = snapshot.availableRelease
  if (!release) return snapshot
  const comparison = compareVersions(release.version, snapshot.currentVersion)
  if (comparison === 1) return snapshot
  return {
    ...snapshot,
    currentRelease: comparison === 0 ? release : snapshot.currentRelease,
    availableRelease: null
  }
}

function compareVersions(candidate: string, installed: string): -1 | 0 | 1 | null {
  const coordinates = (value: string): readonly [bigint, bigint, bigint] | null => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(value.trim().replace(/^v/iu, ''))
    return match ? [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])] : null
  }
  const left = coordinates(candidate)
  const right = coordinates(installed)
  if (!left || !right) return null
  for (const index of [0, 1, 2] as const) {
    if (left[index] > right[index]) return 1
    if (left[index] < right[index]) return -1
  }
  return 0
}
