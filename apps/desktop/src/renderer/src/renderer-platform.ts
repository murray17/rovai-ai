type PlatformAttributeTarget = {
  setAttribute(name: string, value: string): void
}

export const RENDERER_PLATFORM_ATTRIBUTE = 'data-rovai-platform'

export function applyRendererPlatform(
  target: PlatformAttributeTarget,
  platform: NodeJS.Platform
): void {
  target.setAttribute(RENDERER_PLATFORM_ATTRIBUTE, platform)
}

export function primaryShortcutLabel(platform: NodeJS.Platform, key: string): string {
  return platform === 'darwin' ? `⌘${key}` : `Ctrl+${key}`
}

export function revealInFileManagerLabel(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? '在 Finder 中显示' : '在文件资源管理器中显示'
}

export function localDeviceLabel(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return '这台 Mac'
  if (platform === 'win32') return '这台 Windows 电脑'
  return '这台电脑'
}

export function shouldHandlePrimaryShortcut(
  platform: NodeJS.Platform,
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'isComposing'>,
  key: string
): boolean {
  if (event.isComposing || event.altKey || event.key.toLowerCase() !== key.toLowerCase()) {
    return false
  }
  return platform === 'darwin'
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
}
