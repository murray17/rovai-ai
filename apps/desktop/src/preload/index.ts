import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppearanceSnapshot,
  AppUpdateSnapshot,
  CoreEvent,
  CoreMethod,
  ExecutionConsolePlacement,
  RestorableLocation,
  SettingsSection,
  StartupLocationMode,
  NavigationPin,
  NavigationPreferencesSnapshot,
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
  userAutomation: {
    onOpenCamp(listener) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        request: { campId: string }
      ): void => listener(request)
      ipcRenderer.on('rovai:user-automation-open-camp', handler)
      return () => ipcRenderer.removeListener('rovai:user-automation-open-camp', handler)
    }
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
  appUpdates: {
    get() {
      return ipcRenderer.invoke('rovai:app-updates-get')
    },
    check() {
      return ipcRenderer.invoke('rovai:app-updates-check')
    },
    download() {
      return ipcRenderer.invoke('rovai:app-updates-download')
    },
    install() {
      return ipcRenderer.invoke('rovai:app-updates-install')
    },
    dismissPrompt(promptId: string) {
      return ipcRenderer.invoke('rovai:app-updates-dismiss-prompt', promptId)
    },
    onChanged(listener: (snapshot: AppUpdateSnapshot) => void): () => void {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: AppUpdateSnapshot
      ): void => listener(value)
      ipcRenderer.on('rovai:app-updates-changed', handler)
      return () => ipcRenderer.removeListener('rovai:app-updates-changed', handler)
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
    setExecutionConsolePlacement(placement: ExecutionConsolePlacement) {
      return ipcRenderer.invoke('rovai:general-preferences-set-execution-placement', placement)
    },
    setNewConversationDefaults(defaults) {
      return ipcRenderer.invoke('rovai:general-preferences-set-new-conversation-defaults', defaults)
    },
    setOneClickNewConversationEnabled(enabled: boolean) {
      return ipcRenderer.invoke('rovai:general-preferences-set-one-click-new-conversation', enabled)
    },
    setWorldMapEnabled(enabled: boolean) {
      return ipcRenderer.invoke('rovai:general-preferences-set-world-map', enabled)
    },
    invalidateNewConversationDefaults() {
      return ipcRenderer.invoke('rovai:general-preferences-invalidate-new-conversation-defaults')
    }
  },
  onboarding: {
    get() {
      return ipcRenderer.invoke('rovai:onboarding-get')
    },
    showWelcome() {
      return ipcRenderer.invoke('rovai:onboarding-show-welcome')
    },
    completeWelcome() {
      return ipcRenderer.invoke('rovai:onboarding-complete-welcome')
    },
    selectMember(role) {
      return ipcRenderer.invoke('rovai:onboarding-select-member', role)
    },
    showMemberSelection() {
      return ipcRenderer.invoke('rovai:onboarding-show-member-selection')
    },
    completeMemberSelection() {
      return ipcRenderer.invoke('rovai:onboarding-complete-member-selection')
    },
    setRuntimeSelection(selection) {
      return ipcRenderer.invoke('rovai:onboarding-set-runtime-selection', selection)
    },
    deferRuntimeSetup() {
      return ipcRenderer.invoke('rovai:onboarding-defer-runtime')
    },
    beginProvisioning(selection, runtimePermissions) {
      return ipcRenderer.invoke(
        'rovai:onboarding-begin-provisioning',
        selection,
        runtimePermissions
      )
    },
    recordProvisionedMember(agentId, version) {
      return ipcRenderer.invoke('rovai:onboarding-record-member', agentId, version)
    },
    recordProvisionedRuntime(version) {
      return ipcRenderer.invoke('rovai:onboarding-record-runtime', version)
    },
    recordProvisionedCamp(campId) {
      return ipcRenderer.invoke('rovai:onboarding-record-camp', campId)
    },
    complete() {
      return ipcRenderer.invoke('rovai:onboarding-complete')
    }
  },
  windowControls: {
    getResetCapability() {
      return ipcRenderer.invoke('rovai:window-reset-capability')
    },
    resetBounds() {
      return ipcRenderer.invoke('rovai:window-reset-bounds')
    },
    popupApplicationMenu(request) {
      return ipcRenderer.invoke('rovai:window-application-menu-popup', request) as Promise<boolean>
    },
    onPageZoomChanged(listener) {
      const handler = (_event: Electron.IpcRendererEvent, percentage: unknown): void => {
        if (typeof percentage === 'number' && Number.isFinite(percentage)) listener(percentage)
      }
      ipcRenderer.on('rovai:page-zoom-changed', handler)
      return () => ipcRenderer.removeListener('rovai:page-zoom-changed', handler)
    }
  },
  navigationPreferences: {
    get() {
      return ipcRenderer.invoke('rovai:navigation-preferences-get') as Promise<NavigationPreferencesSnapshot>
    },
    replacePins(pins: NavigationPin[]) {
      return ipcRenderer.invoke('rovai:navigation-preferences-replace-pins', pins) as Promise<NavigationPreferencesSnapshot>
    },
    removeProject(targetKey: string, relatedCampIds: string[]) {
      return ipcRenderer.invoke(
        'rovai:navigation-preferences-remove-project',
        targetKey,
        relatedCampIds
      ) as Promise<NavigationPreferencesSnapshot>
    },
    restoreProject(targetKey: string) {
      return ipcRenderer.invoke(
        'rovai:navigation-preferences-restore-project',
        targetKey
      ) as Promise<NavigationPreferencesSnapshot>
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
  attachments: {
    open(campId, attachmentId) {
      return ipcRenderer.invoke('rovai:attachment-open', campId, attachmentId)
    },
    reveal(campId, attachmentId) {
      return ipcRenderer.invoke('rovai:attachment-reveal', campId, attachmentId)
    }
  },
  filePreview: {
    bindCamp(campId) {
      return ipcRenderer.invoke('rovai:file-preview-bind-camp', campId)
    },
    open(request) {
      return ipcRenderer.invoke('rovai:file-preview-open', request)
    },
    reopen(request) {
      return ipcRenderer.invoke('rovai:file-preview-reopen', request)
    },
    readText(request) {
      return ipcRenderer.invoke('rovai:file-preview-read-text', request)
    },
    readPage(request) {
      return ipcRenderer.invoke('rovai:file-preview-read-page', request)
    },
    resolveLine(request) {
      return ipcRenderer.invoke('rovai:file-preview-resolve-line', request)
    },
    readBinary(request) {
      return ipcRenderer.invoke('rovai:file-preview-read-binary', request)
    },
    prepareHtml(request) {
      return ipcRenderer.invoke('rovai:file-preview-prepare-html', request)
    },
    reload(request) {
      return ipcRenderer.invoke('rovai:file-preview-reload', request)
    },
    release(request) {
      return ipcRenderer.invoke('rovai:file-preview-release', request)
    },
    openInSystem(request) {
      return ipcRenderer.invoke('rovai:file-preview-open-in-system', request)
    },
    revealInFolder(request) {
      return ipcRenderer.invoke('rovai:file-preview-reveal', request)
    },
    copyPath(request) {
      return ipcRenderer.invoke('rovai:file-preview-copy-path', request)
    },
    attachSelection(request) {
      return ipcRenderer.invoke('rovai:file-preview-attach-selection', request)
    },
    chooseAuthorizedRoot(request) {
      return ipcRenderer.invoke('rovai:file-preview-choose-root', request)
    },
    onExternalUpdate(listener) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: Parameters<typeof listener>[0]
      ): void => listener(value)
      ipcRenderer.on('rovai:file-preview-external-update', handler)
      return () => ipcRenderer.removeListener('rovai:file-preview-external-update', handler)
    }
  },
  clipboard: {
    write(input) {
      return ipcRenderer.invoke('rovai:clipboard-write', input)
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
  exportMonitoring(filter) {
    return ipcRenderer.invoke('rovai:export-monitoring', filter)
  },
  revealMonitoringExport(path: string) {
    return ipcRenderer.invoke('rovai:reveal-monitoring-export', path)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('rovai', api)
