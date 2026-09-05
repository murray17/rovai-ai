import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  APP_PREPARE_QUIT_CHANNEL,
  type AppQuitPreparationResponse
} from '../shared/app-lifecycle'
import type {
  AppearanceSnapshot,
  AppUpdateSnapshot,
  ChannelSettingsSnapshot,
  CoreEvent,
  CoreMethod,
  ExecutionWebSettingsSnapshot,
  ExecutionConsolePlacement,
  RestorableLocation,
  SettingsSection,
  StartupLocationMode,
  NavigationPin,
  NavigationPreferencesSnapshot,
  RovaiRequestTransport,
  RovaiApi,
  SupervisorSnapshot,
  ThemePreference
} from '@contracts'

let appQuitPreparationListener: (() => void | Promise<void>) | null = null

ipcRenderer.on(APP_PREPARE_QUIT_CHANNEL, (event) => {
  const port = event.ports[0]
  if (!port) return
  void (async () => {
    let response: AppQuitPreparationResponse
    try {
      await appQuitPreparationListener?.()
      response = { status: 'prepared' }
    } catch (error) {
      response = {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
    try {
      port.postMessage(response)
    } finally {
      port.close()
    }
  })().catch(() => {
    port.close()
  })
})

const api: RovaiApi = {
  async request<T>(method: CoreMethod, params?: unknown): Promise<T> {
    const transport = await ipcRenderer.invoke(
      'rovai:request',
      method,
      params
    ) as RovaiRequestTransport<T>
    if (transport.kind === 'failure') {
      // contextBridge drops custom Error properties; keep the rejection cloneable.
      // Any Error instance must be constructed after the Renderer receives it.
      return Promise.reject(transport.failure)
    }
    return transport.value
  },
  onEvent(listener: (event: CoreEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, value: CoreEvent): void => listener(value)
    ipcRenderer.on('rovai:event', handler)
    return () => ipcRenderer.removeListener('rovai:event', handler)
  },
  appLifecycle: {
    onPrepareQuit(listener) {
      appQuitPreparationListener = listener
      return () => {
        if (appQuitPreparationListener === listener) appQuitPreparationListener = null
      }
    }
  },
  supervisor: {
    getSnapshot() {
      return ipcRenderer.invoke('rovai:supervisor-get-snapshot') as Promise<SupervisorSnapshot>
    },
    retryFullCore() {
      return ipcRenderer.invoke('rovai:supervisor-retry') as Promise<SupervisorSnapshot>
    },
    onChanged(listener: (snapshot: SupervisorSnapshot) => void): () => void {
      const handler = (
        _event: Electron.IpcRendererEvent,
        snapshot: SupervisorSnapshot
      ): void => listener(snapshot)
      ipcRenderer.on('rovai:supervisor-changed', handler)
      return () => ipcRenderer.removeListener('rovai:supervisor-changed', handler)
    }
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
  channels: {
    get() {
      return ipcRenderer.invoke('rovai:channels-get') as Promise<ChannelSettingsSnapshot>
    },
    getExecutionWebSettings() {
      return ipcRenderer.invoke('rovai:execution-web-settings-get') as Promise<ExecutionWebSettingsSnapshot>
    },
    setExecutionWebSettings(settings) {
      return ipcRenderer.invoke('rovai:execution-web-settings-set', settings)
    },
    connect(kind) {
      return ipcRenderer.invoke('rovai:channels-connect', kind)
    },
    disconnect(kind) {
      return ipcRenderer.invoke('rovai:channels-disconnect', kind)
    },
    publishMemberBot(agentId, kind) {
      return ipcRenderer.invoke('rovai:channels-publish-member-bot', agentId, kind)
    },
    retryMemberBot(agentId, kind) {
      return ipcRenderer.invoke('rovai:channels-retry-member-bot', agentId, kind)
    },
    selectPublicationApprover(agentId, userId, kind) {
      return ipcRenderer.invoke(
        'rovai:channels-select-publication-approver',
        agentId,
        userId,
        kind
      )
    },
    cancelQrAttempt(attemptId) {
      return ipcRenderer.invoke('rovai:channels-cancel-qr', attemptId)
    },
    setLoginViewBounds(attemptId, bounds) {
      return ipcRenderer.invoke('rovai:channels-login-view-bounds', attemptId, bounds)
    },
    refreshLoginQr(attemptId) {
      return ipcRenderer.invoke('rovai:channels-refresh-login-qr', attemptId)
    },
    onChanged(listener) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: ChannelSettingsSnapshot
      ): void => listener(value)
      ipcRenderer.on('rovai:channels-changed', handler)
      return () => ipcRenderer.removeListener('rovai:channels-changed', handler)
    },
    onExecutionWebSettingsChanged(listener) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: ExecutionWebSettingsSnapshot
      ): void => listener(value)
      ipcRenderer.on('rovai:execution-web-settings-changed', handler)
      return () => ipcRenderer.removeListener('rovai:execution-web-settings-changed', handler)
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
    synchronizeProjectOrder(projectKeys: string[]) {
      return ipcRenderer.invoke(
        'rovai:navigation-preferences-synchronize-project-order',
        projectKeys
      ) as Promise<NavigationPreferencesSnapshot>
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
          file.name,
          file.type || null
        )
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      return ipcRenderer.invoke(
        'rovai:composer-attachment-prepare-bytes',
        campId,
        expectedRevision,
        file.name,
        file.type || null,
        bytes
      )
    },
    async preparePending(input, file) {
      const sourcePath = webUtils.getPathForFile(file)
      if (sourcePath) {
        return ipcRenderer.invoke(
          'rovai:pending-attachment-prepare-path',
          input,
          sourcePath,
          file.name,
          file.type || null
        )
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      return ipcRenderer.invoke(
        'rovai:pending-attachment-prepare-bytes',
        input,
        file.name,
        file.type || null,
        bytes
      )
    },
    preview(locator) {
      return ipcRenderer.invoke('rovai:composer-attachment-preview', locator)
    }
  },
  singleChatAttachments: {
    async prepare(conversationId, expectedDraftRevision, file) {
      const sourcePath = webUtils.getPathForFile(file)
      if (sourcePath) {
        return ipcRenderer.invoke(
          'rovai:single-chat-attachment-prepare-path',
          conversationId,
          expectedDraftRevision,
          sourcePath,
          file.name,
          file.type || null
        )
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      return ipcRenderer.invoke(
        'rovai:single-chat-attachment-prepare-bytes',
        conversationId,
        expectedDraftRevision,
        file.name,
        file.type || null,
        bytes
      )
    },
    async preparePending(input, file) {
      const sourcePath = webUtils.getPathForFile(file)
      if (sourcePath) {
        return ipcRenderer.invoke(
          'rovai:single-chat-pending-attachment-prepare-path',
          input,
          sourcePath,
          file.name,
          file.type || null
        )
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      return ipcRenderer.invoke(
        'rovai:single-chat-pending-attachment-prepare-bytes',
        input,
        file.name,
        file.type || null,
        bytes
      )
    },
    remove(conversationId, expectedDraftRevision, attachmentRefId) {
      return ipcRenderer.invoke(
        'rovai:single-chat-attachment-remove',
        conversationId,
        expectedDraftRevision,
        attachmentRefId
      )
    }
  },
  attachments: {
    open(locator) {
      return ipcRenderer.invoke('rovai:attachment-open', locator)
    },
    reveal(locator) {
      return ipcRenderer.invoke('rovai:attachment-reveal', locator)
    }
  },
  filePreview: {
    bindCamp(campId) {
      return ipcRenderer.invoke('rovai:file-preview-bind-camp', campId)
    },
    open(request) {
      return ipcRenderer.invoke('rovai:file-preview-open', request)
    },
    restore(request) {
      return ipcRenderer.invoke('rovai:file-preview-restore', request)
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
