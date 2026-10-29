export type ShortcutActionId =
  | 'save-file' | 'execution' | 'tasks' | 'members' | 'dm' | 'preview' | 'composer' | 'latest' | 'attach'
  | 'jump' | 'new' | 'sidebar' | 'settings' | 'back' | 'forward' | 'missions' | 'automations'
  | 'find' | 'next' | 'previous' | 'previous-tab' | 'next-tab' | 'reveal-file' | 'open-file'
export type ShortcutMouseSide = 'side1' | 'side2'
export type ComposerSendMode = 'enter' | 'primary-enter'
export interface ShortcutPreferences {
  schemaVersion: 2
  bindings: Record<ShortcutActionId, string | null>
  mouse: Record<ShortcutMouseSide, ShortcutActionId | null>
  sendMode: ComposerSendMode
}
export interface ShortcutPreferencesSnapshot {
  revision: number
  preferences: ShortcutPreferences
  degraded: boolean
  migrationPending?: boolean
}
/** Local Desktop preference; never a Core command or an OS-wide shortcut registration. */
export interface ShortcutPreferencesApi {
  get(): Promise<ShortcutPreferencesSnapshot>
  save(input: { expectedRevision: number; preferences: ShortcutPreferences }): Promise<ShortcutPreferencesSnapshot>
  onChanged(listener: (snapshot: ShortcutPreferencesSnapshot) => void): () => void
  setRecording(recording: boolean): Promise<void>
  setTasksEnabled?(enabled: boolean): Promise<void>
  onMouseSide(listener: (side: ShortcutMouseSide) => void): () => void
}
