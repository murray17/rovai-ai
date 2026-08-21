import { describe, expect, it, vi } from 'vitest'

import {
  applyRendererPlatform,
  localDeviceLabel,
  primaryShortcutLabel,
  revealInFileManagerLabel,
  RENDERER_PLATFORM_ATTRIBUTE,
  shouldHandlePrimaryShortcut
} from './renderer-platform'

describe('Renderer platform projection', () => {
  it('projects the read-only preload platform onto the document root', () => {
    const setAttribute = vi.fn()
    applyRendererPlatform({ setAttribute }, 'win32')
    expect(setAttribute).toHaveBeenCalledExactlyOnceWith(
      RENDERER_PLATFORM_ATTRIBUTE,
      'win32'
    )
  })

  it('uses native Windows labels and Ctrl shortcuts', () => {
    expect(primaryShortcutLabel('win32', 'K')).toBe('Ctrl+K')
    expect(revealInFileManagerLabel('win32')).toBe('在文件资源管理器中显示')
    expect(localDeviceLabel('win32')).toBe('这台 Windows 电脑')
    expect(shouldHandlePrimaryShortcut('win32', {
      key: 'k', ctrlKey: true, metaKey: false, altKey: false, isComposing: false
    }, 'K')).toBe(true)
  })

  it('does not activate a primary shortcut during IME composition or with the wrong modifier', () => {
    expect(shouldHandlePrimaryShortcut('win32', {
      key: 'k', ctrlKey: true, metaKey: false, altKey: false, isComposing: true
    }, 'K')).toBe(false)
    expect(shouldHandlePrimaryShortcut('darwin', {
      key: 'k', ctrlKey: true, metaKey: false, altKey: false, isComposing: false
    }, 'K')).toBe(false)
  })
})
