import type { ShortcutActionId, ShortcutMouseSide, ShortcutPreferences } from '@contracts'
import { reservedPageZoomShortcut } from './page-zoom-shortcut'

export interface ShortcutDefinition {
  id: ShortcutActionId
  name: string
  group: 'workspace' | 'navigation' | 'files'
  binding: string | null
  editable?: boolean
}
export const SHORTCUTS: readonly ShortcutDefinition[] = [
  { id: 'execution', name: '展开／收起执行台', group: 'workspace', binding: 'Mod+1', editable: true },
  { id: 'members', name: '打开／收起队员', group: 'workspace', binding: 'Mod+2', editable: true },
  { id: 'dm', name: '打开／收起单聊', group: 'workspace', binding: 'Mod+3', editable: true },
  { id: 'tasks', name: '打开／收起任务', group: 'workspace', binding: 'Mod+4', editable: true },
  { id: 'preview', name: '显示／收起文件预览区', group: 'workspace', binding: 'Mod+Shift+B', editable: true },
  { id: 'composer', name: '聚焦消息输入框', group: 'workspace', binding: 'Mod+L', editable: true },
  { id: 'latest', name: '回到最新消息', group: 'workspace', binding: null, editable: true },
  { id: 'attach', name: '添加附件', group: 'workspace', binding: null, editable: true },
  { id: 'jump', name: '跳转到对话', group: 'navigation', binding: 'Mod+K', editable: true },
  { id: 'new', name: '新建对话', group: 'navigation', binding: 'Mod+N', editable: true },
  { id: 'sidebar', name: '收起／展开导航侧栏', group: 'navigation', binding: 'Mod+B' },
  { id: 'settings', name: '打开设置', group: 'navigation', binding: 'Mod+,', editable: true },
  { id: 'back', name: '后退', group: 'navigation', binding: 'Mod+[' },
  { id: 'forward', name: '前进', group: 'navigation', binding: 'Mod+]' },
  { id: 'missions', name: '打开使命页', group: 'navigation', binding: null },
  { id: 'automations', name: '打开定时任务页', group: 'navigation', binding: null },
  { id: 'save-file', name: '保存当前文件', group: 'files', binding: 'Mod+S', editable: true },
  { id: 'find', name: '查找当前内容', group: 'files', binding: 'Mod+F', editable: true },
  { id: 'next', name: '下一个查找结果', group: 'files', binding: 'Mod+G', editable: true },
  { id: 'previous', name: '上一个查找结果', group: 'files', binding: 'Mod+Shift+G', editable: true },
  { id: 'previous-tab', name: '切换上一个文件标签', group: 'files', binding: null },
  { id: 'next-tab', name: '切换下一个文件标签', group: 'files', binding: null },
  { id: 'reveal-file', name: '在文件夹中显示当前文件', group: 'files', binding: null },
  { id: 'open-file', name: '用默认应用打开当前文件', group: 'files', binding: null }
]
export const SHORTCUT_MOUSE_SIDES: readonly ShortcutMouseSide[] = ['side1', 'side2']
export const shortcutDefaults = (): ShortcutPreferences => ({ schemaVersion: 2, bindings: Object.fromEntries(SHORTCUTS.map(row => [row.id, row.binding])) as ShortcutPreferences['bindings'], mouse: { side1: null, side2: null }, sendMode: 'enter' })
export const shortcutMouseSide = (button: number): ShortcutMouseSide | null => button === 3 ? 'side1' : button === 4 ? 'side2' : null
export function shouldSendComposerKey(event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'repeat' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, platform: NodeJS.Platform, mode: ShortcutPreferences['sendMode']): boolean {
  if (event.key !== 'Enter' || event.isComposing || event.repeat || event.shiftKey || event.altKey) return false
  const primary = platform === 'darwin' ? event.metaKey : event.ctrlKey
  const other = platform === 'darwin' ? event.ctrlKey : event.metaKey
  return !other && (mode === 'enter' ? !primary : primary)
}
export { normalizeShortcut, type ShortcutKeyEvent } from '../../../../packages/contracts/src/shortcut-key'
const RESERVED: Record<string, string> = { 'Mod+W': '关闭当前文件标签／窗口', 'Mod+C': '复制', 'Mod+X': '剪切', 'Mod+V': '粘贴', 'Mod+Z': '撤销', 'Mod+Shift+Z': '重做', 'Mod+A': '全选' }
export function validateShortcut(binding: string, platform: NodeJS.Platform): string | null {
  const parts = binding.split('+'), key = parts.at(-1) ?? ''
  if (platform !== 'darwin' && parts.includes('Meta')) return '暂不支持 Win 组合，请使用 Ctrl 或 Alt。'
  const modifiers = platform === 'darwin' ? ['Mod', 'Ctrl', 'Alt', 'Shift'] : ['Mod', 'Alt', 'Shift']
  const given = parts.slice(0, -1)
  if (!key || binding.length > 100 || given.some((part, i) => !modifiers.includes(part) || (i > 0 && modifiers.indexOf(part) <= modifiers.indexOf(given[i - 1])))) return '暂不支持这个组合，请换一个。'
  if (!given.some(part => part !== 'Shift') && !/^F([1-9]|1[0-2])$/.test(binding)) {
    if (key.length !== 1 && key !== 'Space' && key !== 'Plus') return '暂不支持这个组合，请换一个。'
    return platform === 'darwin' ? '请搭配 ⌘、⌃ 或 ⌥ 使用。' : '请搭配 Ctrl 或 Alt 使用。'
  }
  if (!/^(?:[A-Z0-9]|[^\p{L}\p{N}\s]|F(?:[1-9]|1[0-2])|Enter|Tab|Space|Plus|Backspace|Delete|Insert|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/u.test(key)) return '暂不支持这个组合，请换一个。'
  if (['Mod+Q', 'Mod+Tab', 'Mod+Space', 'Alt+Tab', 'Alt+F4', 'Mod+Alt+Delete'].includes(binding)) return '这个组合由系统使用，请换一个。'
  if (['Mod+Enter', 'Mod+Shift+Enter', 'Alt+Enter'].includes(binding)) return '请在「发送消息」中设置发送方式。'
  const zoom = reservedPageZoomShortcut(binding, platform)
  const reserved = zoom ? { in: '放大界面', out: '缩小界面', reset: '恢复默认缩放' }[zoom] : RESERVED[binding]
  return reserved ? `「${reserved}」使用这个系统快捷键，请换一个。` : null
}
export function shortcutKeyParts(binding: string | null, platform: NodeJS.Platform): string[] {
  if (!binding) return []
  const labels: Record<string, string> = { Mod: platform === 'darwin' ? '⌘' : 'Ctrl', Ctrl: platform === 'darwin' ? '⌃' : 'Ctrl', Meta: platform === 'darwin' ? '⌘' : 'Win', Alt: platform === 'darwin' ? '⌥' : 'Alt', Shift: platform === 'darwin' ? '⇧' : 'Shift', Enter: '↵', ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→', Space: '空格', Plus: '+', Backspace: '⌫' }
  return binding.split('+').map(part => labels[part] ?? part)
}
export function parseShortcutPreferences(value: unknown, platform: NodeJS.Platform): ShortcutPreferences | null {
  if (!record(value) || !exact(value, ['schemaVersion', 'bindings', 'mouse', 'sendMode']) || value.schemaVersion !== 2 || !record(value.bindings) || !record(value.mouse)) return null
  if (!exact(value.bindings, SHORTCUTS.map(row => row.id)) || !exact(value.mouse, SHORTCUT_MOUSE_SIDES)) return null
  if (value.sendMode !== 'enter' && value.sendMode !== 'primary-enter') return null
  const used = new Set<string>()
  for (const binding of Object.values(value.bindings)) {
    if (binding === null) continue
    if (typeof binding !== 'string' || validateShortcut(binding, platform) || used.has(binding)) return null
    used.add(binding)
  }
  for (const id of Object.values(value.mouse)) if (id !== null && !SHORTCUTS.some(row => row.id === id)) return null
  return structuredClone(value) as unknown as ShortcutPreferences
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

/** One full catalog/configuration; capability affects only action availability. */
export const shortcutAvailable = (id: ShortcutActionId | null | undefined, tasksEnabled: boolean): boolean => !!id && (id !== 'tasks' || tasksEnabled)

export function migrateLegacyShortcutPreferences(value: unknown, platform: NodeJS.Platform): ShortcutPreferences | null {
  if (!record(value) || value.schemaVersion !== 1) return null
  const next = parseShortcutPreferences({ ...value, schemaVersion: 2 }, platform)
  if (!next) return null
  const ordered: ShortcutActionId[] = ['execution', 'members', 'dm', 'tasks']
  const combinations = new Set(['Mod+1', 'Mod+2', 'Mod+3', 'Mod+4'])
  for (const row of SHORTCUTS) if (!ordered.includes(row.id) && combinations.has(next.bindings[row.id] ?? '')) next.bindings[row.id] = null
  ordered.forEach((id, index) => { next.bindings[id] = `Mod+${index + 1}` })
  return next
}
