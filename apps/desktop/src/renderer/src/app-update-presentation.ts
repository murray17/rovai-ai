import type { AppUpdateSnapshot } from '@contracts'

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
        label: '更新可用',
        accessibleLabel: `Rovai AI ${displayedVersion} 更新可用`
      }
    case 'checking':
    case 'check_failed':
      return {
        kind: snapshot.status === 'checking' ? 'downloading' : 'failed',
        label: snapshot.status === 'checking' ? '检查中' : '检查失败',
        accessibleLabel: snapshot.status === 'checking'
          ? `正在重新检查 Rovai AI 更新，已知 ${displayedVersion} 可用`
          : `Rovai AI ${displayedVersion} 仍可用，本次检查失败`
      }
    case 'downloading':
      return {
        kind: 'downloading',
        label: `${Math.round(snapshot.downloadPercent ?? 0)}%`,
        accessibleLabel: `正在下载 Rovai AI ${displayedVersion}，${Math.round(snapshot.downloadPercent ?? 0)}%`
      }
    case 'ready_to_install':
      return {
        kind: 'ready',
        label: '可安装',
        accessibleLabel: `Rovai AI ${displayedVersion} 已下载，可以安装并重启`
      }
    case 'installing':
      return {
        kind: 'installing',
        label: '重启中',
        accessibleLabel: `Rovai AI ${displayedVersion} 正在准备安装并重启`
      }
    case 'download_failed':
      return {
        kind: 'failed',
        label: '重试下载',
        accessibleLabel: `Rovai AI ${displayedVersion} 下载失败，需要重试`
      }
    case 'install_failed':
      return {
        kind: 'failed',
        label: '重试安装',
        accessibleLabel: `Rovai AI ${displayedVersion} 安装失败，需要重试`
      }
    case 'idle':
    case 'up_to_date':
      return null
  }
}
