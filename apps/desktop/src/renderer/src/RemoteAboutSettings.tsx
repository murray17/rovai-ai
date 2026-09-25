import { useEffect, useState } from 'react'
import type { AppUpdateSnapshot, AppUpdatesApi } from '@contracts'
import { useCampClient } from './camp-client'
import { AboutUpdatesSettingsView } from './AboutUpdatesSettings'
import { useAppUpdates } from './useAppUpdates'
import { currentReleaseFromBundledNotes } from '../../shared/app-current-release'
import releaseNotes from '../../../../../build/release-notes.md?raw'

export function RemoteAboutSettings({ updatesApi }: { updatesApi?: AppUpdatesApi }): React.JSX.Element {
  const client = useCampClient()
  const desktopHosted = Boolean(client.channels)
  const updates = useAppUpdates(desktopHosted ? null : updatesApi ?? null)
  const [current, setCurrent] = useState<AppUpdateSnapshot | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void client.request<{ version: string }>('app.info').then(info => {
      if (!active) return
      setCurrent({ currentVersion: info.version, status: 'idle',
        currentRelease: currentReleaseFromBundledNotes(info.version, desktopHosted ? releaseNotes : null),
        availableRelease: null,
        lastCheckSource: null, checkedAt: null, lastSuccessfulCheckAt: null,
        downloadPercent: null, transferredBytes: null, totalBytes: null, bytesPerSecond: null,
        failureReason: null, pendingPrompt: null })
    }, () => { if (active) setFailed(true) })
    return () => { active = false }
  }, [client, desktopHosted])
  const snapshot = desktopHosted ? current : updates.snapshot && {
    ...updates.snapshot, currentRelease: updates.snapshot.currentRelease ?? current?.currentRelease ?? null
  }
  return <AboutUpdatesSettingsView snapshot={snapshot} product={desktopHosted ? 'desktop' : 'server'} readOnly={desktopHosted}
    canUpdate={!desktopHosted && !!updatesApi} loading={desktopHosted ? !current && !failed : updates.loading}
    loadError={desktopHosted ? failed : updates.loadError} actionError={desktopHosted ? null : updates.actionError}
    onCheck={() => { void updates.check() }} onDownload={() => { void updates.download() }} onInstall={() => { void updates.install() }} />
}
