import type { AppUpdateSnapshot } from '@contracts'
import { uiAttribute } from './interface-language'

export type AppUpdateBadgePresentation = {
  kind: 'available' | 'downloading' | 'ready' | 'installing' | 'failed'
  label: string
  accessibleLabel: string
}

export function appUpdateBadgePresentation(
  snapshot: AppUpdateSnapshot | null
): AppUpdateBadgePresentation | null {
  const version = snapshot?.availableRelease?.version
  if (!snapshot || !version) return null
  const displayedVersion = `v${version}`
  switch (snapshot.status) {
    case 'available':
      return {
        kind: 'available',
        label: uiAttribute('更新可用'),
        accessibleLabel: uiAttribute('Rovai AI {0} 更新可用', displayedVersion)
      }
    case 'checking':
    case 'check_failed':
      return {
        kind: snapshot.status === 'checking' ? 'downloading' : 'failed',
        label: snapshot.status === 'checking' ? uiAttribute('检查中') : uiAttribute('检查失败'),
        accessibleLabel: snapshot.status === 'checking'
          ? uiAttribute('正在重新检查 Rovai AI 更新，已知 {0} 可用', displayedVersion)
          : uiAttribute('Rovai AI {0} 仍可用，本次检查失败', displayedVersion)
      }
    case 'downloading':
      return {
        kind: 'downloading',
        label: `${Math.round(snapshot.downloadPercent ?? 0)}%`,
        accessibleLabel: uiAttribute('正在下载 Rovai AI {0}，{1}%', displayedVersion, Math.round(snapshot.downloadPercent ?? 0))
      }
    case 'ready_to_install':
      return {
        kind: 'ready',
        label: uiAttribute('可安装'),
        accessibleLabel: uiAttribute('Rovai AI {0} 已下载，可以安装并重启', displayedVersion)
      }
    case 'installing':
      return {
        kind: 'installing',
        label: uiAttribute('重启中'),
        accessibleLabel: uiAttribute('Rovai AI {0} 正在准备安装并重启', displayedVersion)
      }
    case 'download_failed':
      return {
        kind: 'failed',
        label: uiAttribute('重试下载'),
        accessibleLabel: uiAttribute('Rovai AI {0} 下载失败，需要重试', displayedVersion)
      }
    case 'install_failed':
      return {
        kind: 'failed',
        label: uiAttribute('重试安装'),
        accessibleLabel: uiAttribute('Rovai AI {0} 安装失败，需要重试', displayedVersion)
      }
    case 'idle':
    case 'up_to_date':
      return null
  }
}
