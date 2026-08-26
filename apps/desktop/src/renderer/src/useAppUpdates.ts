import { useCallback, useEffect, useState } from 'react'
import type { AppUpdateSnapshot, AppUpdatesApi } from '@contracts'

export type AppUpdateActionError = 'check' | 'download' | 'install' | 'dismiss' | null

export interface AppUpdatesController {
  snapshot: AppUpdateSnapshot | null
  loading: boolean
  loadError: boolean
  actionError: AppUpdateActionError
  check(): Promise<boolean>
  download(): Promise<boolean>
  install(): Promise<boolean>
  dismissPrompt(promptId: string): Promise<boolean>
}

export function useAppUpdates(api?: AppUpdatesApi | null): AppUpdatesController {
  const resolvedApi = api ?? (typeof window === 'undefined' ? null : window.rovai.appUpdates)
  const [snapshot, setSnapshot] = useState<AppUpdateSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState<AppUpdateActionError>(null)

  useEffect(() => {
    let active = true
    let receivedChange = false
    if (!resolvedApi) {
      setLoading(false)
      setLoadError(true)
      return () => { active = false }
    }
    const unsubscribe = resolvedApi.onChanged((next) => {
      if (!active) return
      receivedChange = true
      setSnapshot(next)
      setLoadError(false)
      setActionError(null)
    })
    void resolvedApi.get()
      .then((next) => {
        if (!active || receivedChange) return
        setSnapshot(next)
        setLoadError(false)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [resolvedApi])

  const runSnapshotAction = useCallback(async (
    kind: Exclude<AppUpdateActionError, 'install' | 'dismiss' | null>,
    action: (() => Promise<AppUpdateSnapshot>) | undefined,
    accepted: (snapshot: AppUpdateSnapshot) => boolean = () => true
  ): Promise<boolean> => {
    if (!action) return false
    setActionError(null)
    try {
      const next = await action()
      setSnapshot(next)
      setLoadError(false)
      const succeeded = accepted(next)
      if (!succeeded) setActionError(kind)
      return succeeded
    } catch {
      setActionError(kind)
      return false
    }
  }, [])

  const check = useCallback(() => runSnapshotAction(
    'check',
    resolvedApi ? () => resolvedApi.check() : undefined
  ), [resolvedApi, runSnapshotAction])

  const download = useCallback(() => runSnapshotAction(
    'download',
    resolvedApi ? () => resolvedApi.download() : undefined,
    (next) => next.status === 'downloading' || next.status === 'ready_to_install'
  ), [resolvedApi, runSnapshotAction])

  const install = useCallback(async (): Promise<boolean> => {
    if (!resolvedApi) return false
    setActionError(null)
    try {
      const accepted = await resolvedApi.install()
      if (!accepted) setActionError('install')
      return accepted
    } catch {
      setActionError('install')
      return false
    }
  }, [resolvedApi])

  const dismissPrompt = useCallback(async (promptId: string): Promise<boolean> => {
    if (!resolvedApi) return false
    setActionError(null)
    try {
      return await resolvedApi.dismissPrompt(promptId)
    } catch {
      setActionError('dismiss')
      return false
    }
  }, [resolvedApi])

  return {
    snapshot,
    loading,
    loadError,
    actionError,
    check,
    download,
    install,
    dismissPrompt
  }
}
