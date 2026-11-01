import { pageZoomAction } from '../main/page-zoom'
import { describe, expect, it } from 'vitest'
import { normalizeShortcut, parseShortcutPreferences, shortcutDefaults, shortcutKeyParts, shouldSendComposerKey, validateShortcut, type ShortcutKeyEvent } from './shortcuts'

const key = (overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({ key: 'k', code: 'KeyK', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, ...overrides })
describe('shortcut identity and admission', () => {
  it('round trips defaults with side buttons unbound on both platforms', () => {
    for (const platform of ['darwin', 'win32'] as const) expect(parseShortcutPreferences(shortcutDefaults(), platform)).toEqual(shortcutDefaults())
    expect(shortcutDefaults().mouse).toEqual({ side1: null, side2: null })
    expect(shortcutDefaults().bindings).not.toHaveProperty('quick-open')
    expect(Object.values(shortcutDefaults().bindings)).not.toContain('Mod+P')
  })
  it('keeps macOS Control distinct from Command through capture, persistence and display', () => {
    const control = normalizeShortcut(key({ ctrlKey: true }), 'darwin')!
    const command = normalizeShortcut(key({ metaKey: true }), 'darwin')!
    expect(control).toBe('Ctrl+K'); expect(command).toBe('Mod+K')
    expect(shortcutKeyParts(control, 'darwin')).toEqual(['⌃', 'K'])
    const preferences = shortcutDefaults(); preferences.bindings.latest = control
    expect(parseShortcutPreferences(preferences, 'darwin')?.bindings.latest).toBe(control)
    expect(validateShortcut('Mod+Ctrl+Alt+Shift+K', 'darwin')).toBeNull()
    expect(normalizeShortcut(key({ ctrlKey: true, metaKey: true, altKey: true, shiftKey: true }), 'darwin')).toBe('Mod+Ctrl+Alt+Shift+K')
  })
  it.each(['K', '9', '/', 'Shift+K', 'Shift+9', 'Shift+/'])('requires an allowed modifier for %s', binding => {
    expect(validateShortcut(binding, 'darwin')).toBe('请搭配 ⌘、⌃ 或 ⌥ 使用。')
    expect(validateShortcut(binding, 'win32')).toBe('请搭配 Ctrl 或 Alt 使用。')
  })
  it.each(['Control', 'Meta', 'Shift', 'Alt', 'Dead', 'Process', 'AltGraph'])('waits on %s without producing a candidate', value => {
    expect(normalizeShortcut(key({ key: value, code: value }), 'darwin')).toBeNull()
  })
  it('allows Control / Alt / Shift on Windows but still rejects Win', () => {
    expect(normalizeShortcut(key({ ctrlKey: true, altKey: true, shiftKey: true }), 'win32')).toBe('Mod+Alt+Shift+K')
    expect(shortcutKeyParts('Mod+Alt+Shift+K', 'win32')).toEqual(['Ctrl', 'Alt', 'Shift', 'K'])
    expect(validateShortcut('Mod+Alt+Shift+K', 'win32')).toBeNull()
    expect(validateShortcut(normalizeShortcut(key({ metaKey: true }), 'win32')!, 'win32')).toBe('暂不支持 Win 组合，请使用 Ctrl 或 Alt。')
  })
  it('retains function keys and reserved combinations and ignores IME / repeats', () => {
    expect(validateShortcut('F8', 'darwin')).toBeNull()
    expect(validateShortcut('Mod+W', 'darwin')).toContain('关闭当前文件')
    expect(validateShortcut('Mod+Enter', 'win32')).toContain('发送消息')
    expect(normalizeShortcut(key({ ctrlKey: true, repeat: true }), 'darwin')).toBeNull()
    expect(normalizeShortcut(key({ isComposing: true }), 'darwin')).toBeNull()
  })
  it.each(['darwin', 'win32'] as const)('rejects the actual native zoom inputs at recording and persistence on %s', platform => {
    const primary = platform === 'darwin' ? { metaKey: true } : { ctrlKey: true }
    for (const [value, code] of [['0', 'Digit0'], [')', 'Digit0'], ['0', 'Numpad0'], ['Insert', 'Numpad0'],
      ['-', 'Minus'], ['_', 'Minus'], ['-', 'NumpadSubtract'], ['=', 'Equal'], ['+', 'Equal'], ['+', 'NumpadAdd']]) {
      for (const shiftKey of [false, true]) {
        const event = key({ key: value, code, ...primary, shiftKey })
        const binding = normalizeShortcut(event, platform)!
        expect(pageZoomAction({ type: 'keyDown', key: value, code, isComposing: false,
          meta: event.metaKey, control: event.ctrlKey, alt: event.altKey }, platform)).not.toBeNull()
        expect(validateShortcut(binding, platform), binding).not.toBeNull()
        const preferences = shortcutDefaults(); preferences.bindings.tasks = binding
        expect(parseShortcutPreferences(preferences, platform), binding).toBeNull()
      }
    }
    for (const binding of ['Mod+Alt+Shift+0', 'Alt+Shift+0', 'Mod+Shift+9', ...(platform === 'darwin' ? ['Ctrl+Shift+0', 'Mod+Ctrl+Shift+0'] : [])]) {
      expect(validateShortcut(binding, platform), binding).toBeNull()
    }
  })
  it('rejects duplicates, unknown actions, noncanonical modifiers and invalid mouse targets at the persistence boundary', () => {
    const preferences = shortcutDefaults()
    expect(parseShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, latest: 'Mod+1' } }, 'darwin')).toBeNull()
    expect(parseShortcutPreferences({ ...preferences, extra: true }, 'darwin')).toBeNull()
    expect(parseShortcutPreferences({ ...preferences, mouse: { side1: 'unknown', side2: null } }, 'darwin')).toBeNull()
    expect(parseShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, latest: 'Shift+Ctrl+K' } }, 'darwin')).toBeNull()
    expect(parseShortcutPreferences({ ...preferences, sendMode: 'other' }, 'darwin')).toBeNull()
  })
})
describe('send mode', () => {
  it.each(['darwin', 'win32'] as const)('sends only the exact selected combination on %s', platform => {
    const enter = key({ key: 'Enter', code: 'Enter' })
    const primary = key({ ...enter, ...(platform === 'darwin' ? { metaKey: true } : { ctrlKey: true }) })
    const other = key({ ...enter, ...(platform === 'darwin' ? { ctrlKey: true } : { metaKey: true }) })
    expect(shouldSendComposerKey(enter, platform, 'enter')).toBe(true)
    expect(shouldSendComposerKey(primary, platform, 'enter')).toBe(false)
    expect(shouldSendComposerKey(primary, platform, 'primary-enter')).toBe(true)
    expect(shouldSendComposerKey(enter, platform, 'primary-enter')).toBe(false)
    for (const mode of ['enter', 'primary-enter'] as const) {
      expect(shouldSendComposerKey(other, platform, mode)).toBe(false)
      for (const flag of ['shiftKey', 'altKey', 'isComposing', 'repeat']) expect(shouldSendComposerKey({ ...primary, [flag]: true }, platform, mode)).toBe(false)
    }
  })
})
