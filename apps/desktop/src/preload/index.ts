import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppearanceSnapshot,
  CoreEvent,
  CoreMethod,
  RestorableLocation,
  SettingsSection,
  StartupLocationMode,
  NavigationPin,
  NavigationPinsSnapshot,
  RovaiApi,
  ThemePreference
} from '@contracts'

const api: RovaiApi = {
  request<T>(method: CoreMethod, params?: unknown): Promise<T> {
    return ipcRenderer.invoke('rovai:request', method, params) as Promise<T>
  },
  onEvent(listener: (event: CoreEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, value: CoreEvent): void => listener(value)
    ipcRenderer.on('rovai:event', handler)
    return () => ipcRenderer.removeListener('rovai:event', handler)
  },
  appearance: {
    get() {
      return ipcRenderer.invoke('rovai:appearance-get') as Promise<AppearanceSnapshot>
    },
    setPreference(preference: ThemePreference) {
      return ipcRenderer.invoke('rovai:appearance-set', preference) as Promise<AppearanceSnapshot>
    },
    onChanged(listener: (snapshot: AppearanceSnapshot) => void): () => void {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: AppearanceSnapshot
      ): void => listener(value)
      ipcRenderer.on('rovai:appearance-changed', handler)
      return () => ipcRenderer.removeListener('rovai:appearance-changed', handler)
    }
  },
  desktopSession: {
    getStartupSnapshot() {
      return ipcRenderer.invoke('rovai:desktop-session-get-startup')
    },
    commitRestorableLocation(location: RestorableLocation) {
      return ipcRenderer.invoke('rovai:desktop-session-commit-location', location)
    }
  },
  generalPreferences: {
    get() {
      return ipcRenderer.invoke('rovai:general-preferences-get')
    },
    setStartupLocationMode(mode: StartupLocationMode) {
      return ipcRenderer.invoke('rovai:general-preferences-set-startup', mode)
    },
    setLastSettingsSection(section: SettingsSection) {
      return ipcRenderer.invoke('rovai:general-preferences-set-section', section)
    },
    setNewConversationDefaults(defaults) {
      return ipcRenderer.invoke('rovai:general-preferences-set-new-conversation-defaults', defaults)
    },
    setOneClickNewConversationEnabled(enabled: boolean) {
      return ipcRenderer.invoke('rovai:general-preferences-set-one-click-new-conversation', enabled)
    },
    invalidateNewConversationDefaults() {
      return ipcRenderer.invoke('rovai:general-preferences-invalidate-new-conversation-defaults')
    }
  },
  loginItem: {
    get() {
      return ipcRenderer.invoke('rovai:login-item-get')
    },
    setEnabled(enabled: boolean) {
      return ipcRenderer.invoke('rovai:login-item-set-enabled', enabled)
    },
    openSystemSettings() {
      return ipcRenderer.invoke('rovai:login-item-open-system-settings')
    }
  },
  windowControls: {
    getResetCapability() {
      return ipcRenderer.invoke('rovai:window-reset-capability')
    },
    resetBounds() {
      return ipcRenderer.invoke('rovai:window-reset-bounds')
    }
  },
  navigationPins: {
    get() {
      return ipcRenderer.invoke('rovai:navigation-pins-get') as Promise<NavigationPinsSnapshot>
    },
    replace(pins: NavigationPin[]) {
      return ipcRenderer.invoke('rovai:navigation-pins-replace', pins) as Promise<NavigationPinsSnapshot>
    }
  },
  memberAvatars: {
    selectSource() {
      return ipcRenderer.invoke('rovai:member-avatar-select-source')
    },
    save(input) {
      return ipcRenderer.invoke('rovai:member-avatar-save', input)
    },
    read(avatarRef, rendition) {
      return ipcRenderer.invoke('rovai:member-avatar-read', avatarRef, rendition)
    }
  },
  composerAttachments: {
    async prepare(campId, expectedRevision, file) {
      const sourcePath = webUtils.getPathForFile(file)
      if (sourcePath) {
        return ipcRenderer.invoke(
          'rovai:composer-attachment-prepare-path',
          campId,
          expectedRevision,
          sourcePath,
          file.name
        )
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      return ipcRenderer.invoke(
        'rovai:composer-attachment-prepare-bytes',
        campId,
        expectedRevision,
        file.name,
        bytes
      )
    },
    preview(attachmentId) {
      return ipcRenderer.invoke('rovai:composer-attachment-preview', attachmentId)
    }
  },
  selectWorkspaceDirectory() {
    return ipcRenderer.invoke('rovai:select-workspace-directory')
  },
  selectRuntimeExecutable() {
    return ipcRenderer.invoke('rovai:select-runtime-executable')
  },
  selectSkillImportDirectory() {
    return ipcRenderer.invoke('rovai:select-skill-import-directory')
  },
  revealSkill(skillId: string) {
    return ipcRenderer.invoke('rovai:reveal-skill', skillId)
  },
  revealMcpConfig() {
    return ipcRenderer.invoke('rovai:reveal-mcp-config')
  },
  exportMemory() {
    return ipcRenderer.invoke('rovai:export-memory')
  },
  exportDiagnostics() {
    return ipcRenderer.invoke('rovai:export-diagnostics')
  },
  revealDiagnosticsExport(path: string) {
    return ipcRenderer.invoke('rovai:reveal-diagnostics-export', path)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('rovai', api)
