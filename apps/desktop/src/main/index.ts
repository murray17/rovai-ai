import { chmod, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, protocol, screen, shell } from 'electron'
import { isCampId } from '@contracts'
import type {
  AppearanceSnapshot,
  ChannelKind,
  CoreMethod,
  ExecutionWebSettingsSnapshot,
  ExecutionConsolePlacement,
  MonitoringFilter,
  RuntimeUsageSnapshot,
  NavigationPin,
  SaveMemberAvatarAssetInput,
  SettingsSection,
  StartupLocationMode,
  StructuredError,
  SupervisorSnapshot,
  ThemePreference
} from '@contracts'
import {
  CoreClient,
  RovaiRequestError,
  desktopSkillLibraryRoot,
  resolveCoreBinary,
  resolveDesktopBootstrapBinary
} from './core-client'
import {
  isThemePreference,
  nativeThemeSource,
  readThemePreferenceResult,
  resolvedTheme,
  themeBackground,
  writeThemePreference
} from './appearance-preference'
import {
  readWindowStateFile,
  resetWindowBounds,
  sanitizeWindowState,
  windowResetCapability,
  writeWindowStateFile
} from './window-state'
import {
  inspectMemberAvatarSourceFile,
  MemberAvatarAssetService
} from './member-avatar-assets'
import { legacyUserDataPath } from './user-data-path'
import { deleteRetiredManagedDirectory } from './quick-chat-cutover'
import { NavigationPreferencesStore } from './navigation-preferences'
import {
  ProjectAccessTransactionCoordinator,
  removedProjectRootsFromSnapshot,
  restoreProjectAccessFailClosed
} from './project-access-restore'
import { RUNTIME_RENDERER_CORE_METHODS } from './runtime-core-methods'
import {
  GeneralPreferencesStore,
  isExecutionConsolePlacement,
  isNewConversationDefaults,
  isSettingsSection,
  isStartupLocationMode
} from './general-preferences'
import { RestorableLocationStore, parseRestorableLocation } from './restorable-location'
import { DesktopSessionRegistry } from './desktop-session'
import { parseClipboardWriteRequest } from './clipboard-write'
import { OnboardingStore } from './onboarding-preferences'
import { nextPageZoomPercentage, pageZoomAction, pageZoomPercentage } from './page-zoom'
import { applyWindowChromeAppearance, windowChromeOptions } from './window-chrome'
import {
  parseWindowsApplicationMenuPopupRequest,
  prepareWindowsApplicationMenu,
  windowsApplicationSubmenu
} from './windows-application-menu'
import {
  UserAutomationError,
  UserAutomationServer,
  startUserAutomationOptional,
  userAutomationRoot
} from './user-automation'
import {
  isAttachmentId,
  openDesktopAttachmentTarget,
  parseDesktopAttachmentTarget,
  revealDesktopAttachmentTarget,
  type DesktopAttachmentTarget
} from './attachment-desktop'
import {
  prepareWindowsBootstrapRoot,
  prepareWindowsDataRoot,
  resolveWindowsDataRoot
} from './windows-data-root'
import {
  assessWindowsDesktopBootstrap,
  windowsBootstrapInstanceKey,
  type WindowsBootstrapAssessment
} from './windows-bootstrap'
import {
  AppUpdatesService,
  createAppUpdatesServiceFailOpen,
  type DesktopAutoUpdater
} from './app-updates'
import { AppQuitCoordinator } from './app-quit-coordinator'
import { ChannelSettingsService } from './channel-settings'
import { ExecutionViewService } from './execution-view-service'
import { createFeishuExecutionPreviewHost } from './feishu-execution-preview'
import { ChannelSettingsCoordinator, hasPublishedChannelBot } from './channel-settings-coordinator'
import { parseChannelLoginViewBounds } from './dingtalk-login-view'
import { ChannelHostLifecycle } from './channel-host-lifecycle'
import {
  SqliteChannelCredentialStore,
  SqliteChannelDeveloperSessionStore
} from './channel-credential-store'
import { ElectronFeishuDeveloperSessionService } from './feishu-developer-session'
import { FeishuWebSessionMemberBotProvisioner } from './feishu-member-bot-provisioner'
import { ControlledMemberBotAvatarSourceResolver } from './member-bot-avatar-source'
import {
  DingTalkDeveloperGateway
} from './dingtalk-developer-gateway'
import { ElectronDingTalkDeveloperSessionService } from './dingtalk-developer-session'
import { DingTalkOpenPlatformMemberBotProvisioner } from './dingtalk-member-bot-provisioner'
import {
  DINGTALK_REQUIRED_SCOPE_VALUES,
  DingTalkChannelSettingsService
} from './dingtalk-channel-settings'
import { CoreFilePreviewSourceAuthority } from './file-preview/file-preview-authority'
import { FilePreviewService } from './file-preview/file-preview-service'
import {
  parseChooseRootRequest,
  parseCopyPathRequest,
  parseFilePreviewCamp,
  parseGenerationRequest,
  parseHandleRequest,
  parseLineRequest,
  parseOpenFilePreviewRequest,
  parsePageRequest,
  parseReloadRequest,
  parseReopenRequest
} from './file-preview/file-preview-ipc-input'

function optionalChannelKind(value: unknown): ChannelKind | undefined {
  if (value === undefined) return undefined
  if (value === 'feishu' || value === 'dingtalk') return value
  throw new Error('Invalid channel kind')
}

const mainStartupStartedAt = performance.now()
console.info('[startup] stage=main_module_loaded elapsed_ms=0.0')

const allowedMethods = new Set<CoreMethod>([
  'health.check',
  'diagnostics.check',
  'monitoring.snapshot',
  ...RUNTIME_RENDERER_CORE_METHODS,
  'members.list',
  'members.get',
  'members.camps.list',
  'members.create',
  'members.update',
  'members.avatar.set',
  'members.runtime.set',
  'members.runtime.clear',
  'members.presence.set',
  'members.removalPreview',
  'members.remove',
  'members.reorder',
  'memory.list',
  'memory.get',
  'memory.create',
  'memory.revise',
  'memory.retire',
  'memory.reactivate',
  'memory.forget',
  'memory.supersede',
  'memory.review.schedule',
  'memory.hearthReviewItems.list',
  'memory.hearthReviewItems.accept',
  'memory.hearthReviewItems.reject',
  'runtime.installations.list',
  'runtime.subsystems.get',
  'runtime.subsystems.retry',
  'runtime.installations.create',
  'runtime.installations.update',
  'runtime.installations.refresh',
  'skills.list',
  'skills.get',
  'skills.deliveryGroups.list',
  'skills.import.inspect',
  'skills.import.github.inspect',
  'skills.import.commit',
  'skills.setEnabled',
  'skills.setGroupAssignments',
  'skills.delete',
  'skills.projections.listIssues',
  'skills.reconcile',
  'skills.revealLocation',
  'mcp.config.get',
  'mcp.config.repairPermissions',
  'mcp.servers.create',
  'mcp.servers.update',
  'mcp.servers.setEnabled',
  'mcp.assignments.set',
  'mcp.servers.delete',
  'mcp.import.scan',
  'mcp.import.commit',
  'conversations.restartNativeSession',
  'app.info',
  'camps.creationPreflight',
  'workspaces.inspect',
  'navigation.snapshot',
  'navigation.groupCamps',
  'navigation.campViewed',
  'camps.create',
  'camps.discardPending',
  'camps.rename',
  'camps.members.fast.check',
  'camps.members.fast.set',
  'camps.members.add',
  'camps.members.removalPreview',
  'camps.members.remove',
  'camps.changeDefaultLead',
  'camps.reconcileDefaultLead',
  'camps.exists',
  'camps.enter',
  'camps.open',
  'camps.delete',
  'campTurns.cancel',
  'agentRuns.cancel',
  'agentRuns.resolveRecoveryBlocker',
  'camps.snapshot',
  'agentRunFileChanges.get',
  'agentRunImages.read',
  'camp.messages.page',
  'camp.messages.around',
  'camp.messages.find',
  'agentRunEvidence.getContent',
  'agentRunEvidence.list',
  'tasks.create',
  'tasks.update',
  'tasks.list',
  'tasks.get',
  'camp.composerDraft.get',
  'camp.pendingInputs.get',
  'camp.pendingInputs.edit',
  'camp.composerDraft.save',
  'camp.composerDraft.startReply',
  'camp.composerDraft.cancelReply',
  'camp.composerDraft.resolveReplyRecipient',
  'camp.composerDraft.dismissContinuation',
  'camp.composerDraft.resolveContinuationRecipient',
  'camp.composerDraft.removeAttachment',
  'camp.composerDraft.discard',
  'camp.messages.send',
  'userAutomation.camp.send',
  'action.approvals.resolve',
  'notifications.inbox',
  'notifications.changesSince',
  'notifications.acknowledge',
  'notifications.acknowledgeVisibleSources',
  'notifications.markAllRead',
  'notifications.clear',
  'notifications.preference.get',
  'notifications.preference.update',
  'events.subscribe',
  'diagnostics.export'
])
const APP_NAME = 'Rovai AI'
app.setName(APP_NAME)
protocol.registerSchemesAsPrivileged([{
  scheme: 'rovai-preview',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true
  }
}])
const hasExplicitUserDataDirectory = app.commandLine.hasSwitch('user-data-dir')
const isolatedAcceptanceInstance =
  process.env.ROVAI_ALLOW_ISOLATED_INSTANCE === '1'
  && hasExplicitUserDataDirectory
let coreDataPath: string | null = null
let windowsBootstrap: WindowsBootstrapAssessment | null = null
let primaryInstance: boolean
if (process.platform === 'win32') {
  const explicitRoot = hasExplicitUserDataDirectory ? app.commandLine.getSwitchValue('user-data-dir') : null
  windowsBootstrap = assessWindowsDesktopBootstrap({
    electronApp: app,
    isolatedInstance: isolatedAcceptanceInstance,
    prepareShell: () => prepareWindowsBootstrapRoot(
      resolveDesktopBootstrapBinary(), windowsBootstrapInstanceKey(explicitRoot)
    ),
    prepareAuthority: () => prepareWindowsDataRoot(
      resolveCoreBinary(), resolveWindowsDataRoot(explicitRoot, process.env.LOCALAPPDATA)
    )
  })
  primaryInstance = windowsBootstrap.kind === 'ready' || windowsBootstrap.kind === 'blocked'
  if (windowsBootstrap.kind === 'ready') {
    coreDataPath = windowsBootstrap.layout.core
    console.info(
      `[startup] stage=windows_data_root_ready elapsed_ms=${(performance.now() - mainStartupStartedAt).toFixed(1)}`
    )
  } else if (windowsBootstrap.kind === 'shell_storage_unavailable') {
    // No safe Chromium profile exists. Do not silently switch to a broad-ACL
    // default or write authority into a fallback folder. This is a native dialog,
    // not a thrown module-load exception or a Full Core crash/restart loop.
    dialog.showErrorBox('Rovai 无法准备安全的桌面存储',
      `Core 未启动，也没有创建替代工作区。\n\n${windowsBootstrap.error.message}`)
  }
} else {
  const legacyDataPath = legacyUserDataPath(
    app.getPath('appData'),
    APP_NAME,
    hasExplicitUserDataDirectory
  )
  if (legacyDataPath) app.setPath('userData', legacyDataPath)
  coreDataPath = app.getPath('userData')
  primaryInstance = isolatedAcceptanceInstance || app.requestSingleInstanceLock()
}
if (!primaryInstance) app.quit()
const core = new CoreClient(coreDataPath)
if (windowsBootstrap?.kind === 'blocked') {
  core.blockStartup(windowsBootstrap.error, 'preparing_windows_data_root')
}
let appUpdates: AppUpdatesService | null = null
let mainWindow: BrowserWindow | null = null
let themePreference: ThemePreference = 'system'
let appearanceFilePath = ''
let lastDiagnosticsExportPath: string | null = null
let lastMonitoringExportPath: string | null = null
let lastAppearanceSignature = ''
let generalPreferences: GeneralPreferencesStore | null = null
let onboarding: OnboardingStore | null = null
let restorableLocations: RestorableLocationStore | null = null
let navigationPreferences: NavigationPreferencesStore | null = null
let localStoresReady = false
let resolveLocalStoresLoaded: () => void
const localStoresLoaded = new Promise<void>((resolve) => { resolveLocalStoresLoaded = resolve })
let localDegradations: StructuredError[] = windowsBootstrap?.kind === 'blocked' ? [{
  code: 'windows_bootstrap_profile_active',
  message: '当前使用独立的受保护壳层存储，不含 Core 数据。这里的外观设置不会覆盖正式工作区偏好；重新检查会重启桌面壳层。',
  retryable: true,
  details: {}
}] : []
let onboardingAuthorityKey: string | null = null
let retiredManagedDirectoryCleanupStarted = false
const projectAccessTransactions = new ProjectAccessTransactionCoordinator()
let userAutomation: UserAutomationServer | null = null
const desktopSessions = new DesktopSessionRegistry()
const memberAvatars = coreDataPath === null ? null : new MemberAvatarAssetService(coreDataPath)

function requireMemberAvatars(): MemberAvatarAssetService {
  if (!memberAvatars) throw new Error('Core data directory has not been admitted')
  return memberAvatars
}

const memberBotAvatarSource = new ControlledMemberBotAvatarSourceResolver({
  read: (...args) => requireMemberAvatars().read(...args)
})
const channelCredentialStore = new SqliteChannelCredentialStore(core)
const channelDeveloperSessionStore = new SqliteChannelDeveloperSessionStore(core)
const executionView = new ExecutionViewService({
  core,
  settingsFilePath: join(app.getPath('userData'), 'execution-web.json')
})
const feishuDeveloperSession = new ElectronFeishuDeveloperSessionService(
  channelDeveloperSessionStore,
  () => mainWindow
)
const feishuChannelSettings = new ChannelSettingsService({
  core,
  credentialStore: channelCredentialStore,
  developerSession: feishuDeveloperSession,
  memberBotProvisioner: new FeishuWebSessionMemberBotProvisioner(feishuDeveloperSession),
  memberBotAvatarSource,
  executionPreview: createFeishuExecutionPreviewHost(process.argv, coreDataPath),
  executionView
})
const dingtalkDeveloperSession = new ElectronDingTalkDeveloperSessionService({
  store: channelDeveloperSessionStore,
  getParentWindow: () => mainWindow
})
const dingtalkDeveloperGateway = new DingTalkDeveloperGateway({
  session: dingtalkDeveloperSession
})
const dingtalkChannelSettings = new DingTalkChannelSettingsService({
  core,
  credentialStore: channelCredentialStore,
  developerSession: dingtalkDeveloperSession,
  provisioner: new DingTalkOpenPlatformMemberBotProvisioner({
    developerApi: dingtalkDeveloperGateway,
    developerSession: dingtalkDeveloperSession
  }),
  avatarSource: memberBotAvatarSource,
  executionView,
  requiredScopeValues: DINGTALK_REQUIRED_SCOPE_VALUES
})
const channelSettings = new ChannelSettingsCoordinator({
  feishu: feishuChannelSettings,
  dingtalk: dingtalkChannelSettings
})
const channelHostLifecycle = new ChannelHostLifecycle({
  async start() {
    await channelSettings.start()
    await executionView.setPublishedChannelBotAvailable(
      hasPublishedChannelBot(await channelSettings.get())
    )
    if (coreDataPath !== null) {
      await removeRetiredChannelCredentialFiles(coreDataPath).catch((error) => {
        console.warn('[rovai] Retired channel credential file cleanup failed; Channel Hosts remain available.', error)
      })
    }
  },
  stop: () => channelSettings.stop()
})
channelSettings.onChanged((snapshot) => {
  void executionView.setPublishedChannelBotAvailable(hasPublishedChannelBot(snapshot)).catch((error) => {
    console.warn('[rovai] Execution Web published Bot gate update failed.', error)
  })
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('rovai:channels-changed', snapshot)
})
executionView.onChanged((snapshot) => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('rovai:execution-web-settings-changed', snapshot)
})
const filePreview = new FilePreviewService(
  new CoreFilePreviewSourceAuthority(core),
  {
    async selectRoot(webContentsId) {
      const window = mainWindow?.webContents.id === webContentsId ? mainWindow : null
      if (!window || window.isDestroyed()) return null
      const result = await dialog.showOpenDialog(window, {
        title: '授权文件所在目录',
        buttonLabel: '选择目录',
        properties: ['openDirectory']
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    },
    async confirmOpen(displayName) {
      const options = {
        type: 'warning' as const,
        buttons: ['取消', '仍然打开'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        message: '此文件可能执行程序或安装软件',
        detail: `只有在你确认来源可信时才继续。\n\n${displayName}`
      }
      const result = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)
      return result.response === 1
    },
    openPath(path) {
      return shell.openPath(path)
    },
    revealPath(path) {
      shell.showItemInFolder(path)
    },
    copyText(text) {
      clipboard.writeText(text)
    },
    publishExternalUpdate(notification) {
      if (
        !mainWindow
        || mainWindow.isDestroyed()
        || mainWindow.webContents.id !== notification.webContentsId
      ) return
      mainWindow.webContents.send('rovai:file-preview-external-update', {
        campId: notification.campId,
        previewKeys: notification.previewKeys
      })
    }
  }
)
const filePreviewProtocolSessions = new WeakSet<Electron.Session>()

function installFilePreviewProtocol(window: BrowserWindow): void {
  const targetSession = window.webContents.session
  if (filePreviewProtocolSessions.has(targetSession)) return
  targetSession.webRequest.onBeforeRequest(
    { urls: ['rovai-preview://asset/*'] },
    (details, callback) => {
      callback({
        cancel: !filePreview.authorizeHtmlAsset(
          details.webContentsId ?? -1,
          details.method,
          details.url
        )
      })
    }
  )
  targetSession.protocol.handle('rovai-preview', (request) => filePreview.serveHtmlAsset(request))
  filePreviewProtocolSessions.add(targetSession)
}

function publishLocalDegradations(next: StructuredError[]): void {
  localDegradations = [...new Map(next.map((degradation) => [
    degradation.code,
    degradation
  ])).values()]
  core.setLocalDegradations(localDegradations)
}

function maybeInitializeOnboarding(snapshot: SupervisorSnapshot): void {
  if (coreDataPath === null) return
  if (!localStoresReady || !onboarding) return
  if (snapshot.fullCoreState !== 'ready' || snapshot.authorityState.kind !== 'current') return
  const origin = snapshot.authorityState.origin ?? 'existing'
  const key = `${snapshot.generation}:${origin}`
  if (onboardingAuthorityKey === key) return
  onboardingAuthorityKey = key
  void onboarding.initialize(origin !== 'initialized', {
    persist: onboarding.loadDegradation === null
  }).catch((error) => {
    publishLocalDegradations([
      ...localDegradations,
      {
        code: 'onboarding_authority_initialization_failed',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        details: {}
      }
    ])
  })
  if (!retiredManagedDirectoryCleanupStarted) {
    retiredManagedDirectoryCleanupStarted = true
    void deleteRetiredManagedDirectory(coreDataPath).catch((error) => {
      publishLocalDegradations([
        ...localDegradations,
        {
          code: 'retired_managed_directory_cleanup_failed',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
          details: {}
        }
      ])
    })
  }
}

async function initializeAppUpdates(): Promise<void> {
  // electron-updater eagerly touches Electron's native autoUpdater while the
  // module is evaluated. Loading it before app.whenReady() can stall packaged
  // macOS startup before our main module runs, so keep it on the ready path.
  let autoUpdater: DesktopAutoUpdater | null = null
  try {
    const updaterModule = await import('electron-updater')
    autoUpdater = (updaterModule.autoUpdater
      ?? (updaterModule.default as { autoUpdater?: DesktopAutoUpdater } | undefined)?.autoUpdater
      ?? null) as DesktopAutoUpdater | null
    if (!autoUpdater) throw new Error('electron-updater did not expose autoUpdater')
  } catch (error) {
    console.warn('[rovai] Application updater is unavailable; startup will continue.', error)
  }
  const service = createAppUpdatesServiceFailOpen({
    currentVersion: () => app.getVersion(),
    isPackaged: () => app.isPackaged,
    updater: autoUpdater as unknown as DesktopAutoUpdater | null,
    automaticChecksEnabled: !(
      isolatedAcceptanceInstance
      && process.env.ROVAI_DISABLE_AUTO_UPDATE_CHECKS === '1'
    )
  }, (error) => {
    console.warn('[rovai] Application updater initialization failed; startup will continue.', error)
  })
  service.onChanged((snapshot) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send('rovai:app-updates-changed', snapshot)
  })
  appUpdates = service
}

function requireAppUpdates(): AppUpdatesService {
  if (!appUpdates) throw new Error('Application updates are not ready')
  return appUpdates
}

function removeRetiredLoginItemRegistration(): void {
  if (process.platform !== 'darwin' || !app.isPackaged) return
  try {
    app.setLoginItemSettings({
      type: 'mainAppService',
      openAtLogin: false
    })
  } catch (error) {
    console.warn('[rovai] Retired macOS login item cleanup failed; continuing.', error)
  }
}

function appearanceSnapshot(): AppearanceSnapshot {
  return {
    preference: themePreference,
    resolvedTheme: resolvedTheme(nativeTheme.shouldUseDarkColors)
  }
}

function publishAppearance(): AppearanceSnapshot {
  const snapshot = appearanceSnapshot()
  const signature = `${snapshot.preference}:${snapshot.resolvedTheme}`
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(themeBackground(snapshot.resolvedTheme))
    applyWindowChromeAppearance(mainWindow, process.platform, snapshot.resolvedTheme)
  }
  if (signature !== lastAppearanceSignature) {
    lastAppearanceSignature = signature
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rovai:appearance-changed', snapshot)
    }
  }
  return snapshot
}

function removedSkillProjectRoots(): string[] {
  return removedProjectRootsFromSnapshot(requireNavigationPreferences().get())
}

async function synchronizeCoreProjectAccessFromNavigation(): Promise<void> {
  const removedExecutionRoots = removedSkillProjectRoots()
  await core.request('skills.projectAccess.sync', { removedExecutionRoots })
  core.setRemovedSkillProjectRoots(removedExecutionRoots)
}

const MIN_WINDOW_WIDTH = 1040
const MIN_WINDOW_HEIGHT = 700

function createWindow(): void {
  if (!generalPreferences || !restorableLocations) {
    throw new Error('Desktop Shell preferences are not ready')
  }
  const theme = appearanceSnapshot().resolvedTheme
  const windowStatePath = join(app.getPath('userData'), 'window-state.json')
  const displayAreas = screen.getAllDisplays().map((display) => display.workArea)
  const savedState = sanitizeWindowState(
    readWindowStateFile(windowStatePath),
    displayAreas,
    MIN_WINDOW_WIDTH,
    MIN_WINDOW_HEIGHT,
    screen.getPrimaryDisplay().workArea
  )
  if (process.platform === 'win32') prepareWindowsApplicationMenu(Menu.getApplicationMenu())
  const window = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    x: savedState.x,
    y: savedState.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    title: APP_NAME,
    ...windowChromeOptions(process.platform, theme),
    backgroundColor: themeBackground(theme),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const webContentsId = window.webContents.id
  installFilePreviewProtocol(window)
  if (process.platform === 'win32') window.setMenuBarVisibility(false)
  mainWindow = window
  if (localStoresReady) {
    desktopSessions.create(webContentsId, generalPreferences.get(), restorableLocations.get())
  } else {
    desktopSessions.createWhenReady(webContentsId, localStoresLoaded.then(() => ({
      preferences: requireGeneralPreferences().get(),
      restorable: restorableLocations!.get()
    })))
  }

  let pageZoomFeedbackTimer: ReturnType<typeof setTimeout> | null = null
  const publishPageZoom = (): void => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return
    const percentage = pageZoomPercentage(window.webContents.getZoomFactor())
    if (percentage !== null) window.webContents.send('rovai:page-zoom-changed', percentage)
  }
  const queuePageZoomFeedback = (): void => {
    if (pageZoomFeedbackTimer !== null) clearTimeout(pageZoomFeedbackTimer)
    pageZoomFeedbackTimer = setTimeout(() => {
      pageZoomFeedbackTimer = null
      publishPageZoom()
    }, 0)
  }
  window.webContents.on('before-input-event', (event, input) => {
    const action = pageZoomAction(input, process.platform)
    if (action === null) return

    event.preventDefault()
    const percentage = nextPageZoomPercentage(window.webContents.getZoomFactor(), action)
    if (percentage === null) return
    window.webContents.setZoomFactor(percentage / 100)
    window.webContents.send('rovai:page-zoom-changed', percentage)
  })
  window.webContents.on('zoom-changed', queuePageZoomFeedback)
  window.webContents.once('did-finish-load', () => {
    appUpdates?.startAutomaticChecks()
  })

  let persistBoundsTimer: ReturnType<typeof setTimeout> | null = null
  const flushBounds = (): void => {
    if (window.isDestroyed()) return
    void writeWindowStateFile(windowStatePath, window.getNormalBounds()).catch(() => undefined)
  }
  const persistBounds = (): void => {
    if (persistBoundsTimer) clearTimeout(persistBoundsTimer)
    persistBoundsTimer = setTimeout(() => {
      persistBoundsTimer = null
      flushBounds()
    }, 400)
  }
  window.on('resize', persistBounds)
  window.on('move', persistBounds)
  window.on('close', () => {
    if (persistBoundsTimer) clearTimeout(persistBoundsTimer)
    persistBoundsTimer = null
    flushBounds()
  })
  window.on('closed', () => {
    if (pageZoomFeedbackTimer !== null) clearTimeout(pageZoomFeedbackTimer)
    pageZoomFeedbackTimer = null
    desktopSessions.delete(webContentsId)
    void filePreview.releaseWindow(webContentsId)
    if (mainWindow === window) mainWindow = null
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (current && url !== current) event.preventDefault()
  })
  window.webContents.on('will-frame-navigate', (details) => {
    if (!details.isMainFrame) details.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

async function openCampFromAutomation(campId: string): Promise<{ campId: string; opened: true }> {
  if (!isCampId(campId)) {
    throw new UserAutomationError('automation_invalid_input', 'campId is not canonical')
  }
  const exists = await core.request<boolean>('camps.exists', { campId })
  if (!exists) {
    throw new UserAutomationError('camp_not_found', 'The requested Camp does not exist.')
  }
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  const window = mainWindow
  if (!window || window.isDestroyed()) {
    throw new UserAutomationError('app_window_unavailable', 'The App window is unavailable.')
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  const publish = (): void => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('rovai:user-automation-open-camp', { campId })
    }
  }
  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once('did-finish-load', publish)
  } else {
    publish()
  }
  return { campId, opened: true }
}

if (primaryInstance) void app.whenReady().then(async () => {
  console.info(
    `[startup] stage=electron_ready elapsed_ms=${(performance.now() - mainStartupStartedAt).toFixed(1)}`
  )
  const userDataPath = app.getPath('userData')
  appearanceFilePath = join(userDataPath, 'appearance.json')
  const generalPreferencesPath = join(userDataPath, 'general-preferences.json')
  const onboardingPath = join(userDataPath, 'onboarding.json')
  const restorableLocationPath = join(userDataPath, 'restorable-location.json')
  const navigationPreferencesPath = join(userDataPath, 'navigation.json')
  await executionView.start().catch((error) => {
    console.warn('[rovai] Execution Web service did not start; channel execution remains available.', error)
  })
  generalPreferences = GeneralPreferencesStore.defaults(generalPreferencesPath)
  onboarding = OnboardingStore.defaults(onboardingPath)
  restorableLocations = RestorableLocationStore.defaults(restorableLocationPath)
  navigationPreferences = NavigationPreferencesStore.defaults(navigationPreferencesPath)
  const loadedAppearance = readThemePreferenceResult(appearanceFilePath)
  themePreference = loadedAppearance.preference
  nativeTheme.themeSource = nativeThemeSource(themePreference)
  nativeTheme.on('updated', publishAppearance)
  publishAppearance()
  core.onEvent((event) => {
    channelSettings.handleCoreEvent(event)
    mainWindow?.webContents.send('rovai:event', event)
  })
  core.onSnapshot((snapshot) => {
    mainWindow?.webContents.send('rovai:supervisor-changed', snapshot)
    maybeInitializeOnboarding(snapshot)
    void channelHostLifecycle.update(snapshot).catch((error) => {
      console.warn('[rovai] Channel Host transition failed; the App will remain available.', error)
    })
  })
  createWindow()
  console.info(
    `[startup] stage=window_created elapsed_ms=${(performance.now() - mainStartupStartedAt).toFixed(1)}`
  )

  void initializeAppUpdates().catch((error) => {
    publishLocalDegradations([
      ...localDegradations,
      {
        code: 'app_updates_initialization_failed',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        details: {}
      }
    ])
  })
  removeRetiredLoginItemRegistration()
  void memberAvatars?.cleanupStaleTemporaryDirectories().catch(() => undefined)
  const [
    loadedGeneralPreferences,
    loadedOnboarding,
    loadedRestorableLocations,
    loadedNavigationPreferences
  ] = await Promise.all([
    GeneralPreferencesStore.load(generalPreferencesPath),
    OnboardingStore.load(onboardingPath),
    RestorableLocationStore.load(restorableLocationPath),
    NavigationPreferencesStore.load(navigationPreferencesPath)
  ])
  generalPreferences = loadedGeneralPreferences
  onboarding = loadedOnboarding
  restorableLocations = loadedRestorableLocations
  navigationPreferences = loadedNavigationPreferences
  localStoresReady = true
  resolveLocalStoresLoaded()
  const restorableDegradation: StructuredError | null =
    loadedRestorableLocations.get().status === 'invalid'
      ? {
          code: 'restorable_location_invalid',
          message: 'The saved navigation location is invalid; no authority data was changed.',
          retryable: true,
          details: {}
        }
      : null
  publishLocalDegradations([
    ...localDegradations,
    loadedAppearance.degradation,
    loadedGeneralPreferences.loadDegradation,
    loadedOnboarding.loadDegradation,
    loadedNavigationPreferences.loadDegradation,
    restorableDegradation
  ].filter((degradation): degradation is StructuredError => degradation !== null))
  console.info(
    `[startup] stage=main_session_stores_ready elapsed_ms=${(performance.now() - mainStartupStartedAt).toFixed(1)}`
  )
  core.start(coreDataPath === null ? undefined : {
    removedSkillProjectRoots: removedSkillProjectRoots(),
    // Isolated development/acceptance must not migrate the daily global MCP file.
    mcpConfigPath: isolatedAcceptanceInstance ? join(coreDataPath, 'mcp.json') : undefined,
    skillLibraryRoot: desktopSkillLibraryRoot(
      coreDataPath,
      hasExplicitUserDataDirectory,
      process.platform
    ) ?? undefined
  })
  maybeInitializeOnboarding(core.getSnapshot())
  userAutomation = coreDataPath === null ? null : await startUserAutomationOptional(
    () => new UserAutomationServer(
      userAutomationRoot(app.getPath('appData'), userDataPath, hasExplicitUserDataDirectory),
      { core, openCamp: openCampFromAutomation, appVersion: app.getVersion() }
    )
  )
  if (userAutomation) {
    console.info('[startup] stage=user_automation_ready contract_version=1')
  }

  app.on('activate', () => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length === 0) {
      createWindow()
      return
    }
    const window = mainWindow ?? windows[0]
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
}).catch((error: unknown) => {
  console.error('[rovai] Desktop bootstrap initialization failed.', error)
  if (mainWindow && !mainWindow.isDestroyed()) {
    publishLocalDegradations([{
      code: 'desktop_bootstrap_initialization_failed',
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
      details: {}
    }])
    core.start()
    return
  }
  app.quit()
})

async function removeRetiredChannelCredentialFiles(userDataPath: string): Promise<void> {
  const root = join(userDataPath, 'channel-credentials')
  const rootStat = await lstat(root).catch(() => null)
  if (!rootStat?.isDirectory()) return
  await unlink(join(root, 'feishu-developer-session.bin')).catch(() => undefined)
  await unlink(join(root, 'dingtalk-developer-session.bin')).catch(() => undefined)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries
    .filter((entry) => entry.isFile() && (
      /^feishu-[a-z0-9-]+\.bin$/.test(entry.name)
      || /^dingtalk-[a-z0-9-]+\.bin$/.test(entry.name)
    ))
    .map((entry) => unlink(join(root, entry.name)).catch(() => undefined)))
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

ipcMain.handle('rovai:request', async (_event, method: CoreMethod, params?: unknown) => {
  if (!allowedMethods.has(method)) {
    return {
      kind: 'failure',
      failure: {
        kind: 'domain_rejection',
        code: 'renderer_core_method_unsupported',
        message: `Renderer requested an unsupported method: ${method}`,
        retryable: false,
        generation: core.getSnapshot().generation,
        details: { method }
      }
    }
  }
  try {
    return { kind: 'value', value: await core.request(method, params) }
  } catch (error) {
    if (error instanceof RovaiRequestError) {
      return { kind: 'failure', failure: error.toFailure() }
    }
    return {
      kind: 'failure',
      failure: {
        kind: 'infrastructure_failure',
        code: 'desktop_core_request_failed',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
        generation: core.getSnapshot().generation,
        details: {}
      }
    }
  }
})

ipcMain.handle('rovai:supervisor-get-snapshot', () => core.getSnapshot())
ipcMain.handle('rovai:supervisor-retry', () => {
  if (windowsBootstrap?.kind === 'blocked' && core.getSnapshot().capabilities.fullCoreRetry) {
    // sessionData must be bound before ready. Retry the same root in a fresh
    // Desktop process rather than rebinding Chromium or opening a substitute DB.
    app.relaunch()
    app.quit()
    return core.getSnapshot()
  }
  return core.retryFullCore()
})

ipcMain.handle('rovai:file-preview-bind-camp', (event, value: unknown) =>
  filePreview.bindCamp(requireFilePreviewSender(event), parseFilePreviewCamp(value)))

ipcMain.handle('rovai:file-preview-open', (event, value: unknown) =>
  filePreview.open(requireFilePreviewSender(event), parseOpenFilePreviewRequest(value)))

ipcMain.handle('rovai:file-preview-reopen', (event, value: unknown) =>
  filePreview.reopen(requireFilePreviewSender(event), parseReopenRequest(value)))

ipcMain.handle('rovai:file-preview-read-text', (event, value: unknown) =>
  filePreview.readText(requireFilePreviewSender(event), parseGenerationRequest(value)))

ipcMain.handle('rovai:file-preview-read-page', (event, value: unknown) =>
  filePreview.readPage(requireFilePreviewSender(event), parsePageRequest(value)))

ipcMain.handle('rovai:file-preview-resolve-line', (event, value: unknown) =>
  filePreview.resolveLine(requireFilePreviewSender(event), parseLineRequest(value)))

ipcMain.handle('rovai:file-preview-read-binary', (event, value: unknown) =>
  filePreview.readBinary(requireFilePreviewSender(event), parseGenerationRequest(value)))

ipcMain.handle('rovai:file-preview-prepare-html', (event, value: unknown) =>
  filePreview.prepareHtml(requireFilePreviewSender(event), parseGenerationRequest(value)))

ipcMain.handle('rovai:file-preview-reload', (event, value: unknown) =>
  filePreview.reload(requireFilePreviewSender(event), parseReloadRequest(value)))

ipcMain.handle('rovai:file-preview-release', (event, value: unknown) =>
  filePreview.release(requireFilePreviewSender(event), parseHandleRequest(value)))

ipcMain.handle('rovai:file-preview-open-in-system', (event, value: unknown) =>
  filePreview.openInSystem(requireFilePreviewSender(event), parseHandleRequest(value)))

ipcMain.handle('rovai:file-preview-reveal', (event, value: unknown) =>
  filePreview.revealInFolder(requireFilePreviewSender(event), parseHandleRequest(value)))

ipcMain.handle('rovai:file-preview-copy-path', (event, value: unknown) =>
  filePreview.copyPath(requireFilePreviewSender(event), parseCopyPathRequest(value)))

ipcMain.handle('rovai:file-preview-choose-root', (event, value: unknown) =>
  filePreview.chooseAuthorizedRoot(requireFilePreviewSender(event), parseChooseRootRequest(value)))

ipcMain.handle('rovai:clipboard-write', (_event, input: unknown) => {
  clipboard.write(parseClipboardWriteRequest(input))
})

ipcMain.handle('rovai:appearance-get', () => appearanceSnapshot())

ipcMain.handle('rovai:appearance-set', async (_event, preference: unknown) => {
  if (!isThemePreference(preference)) throw new Error('Unsupported theme preference')
  await writeThemePreference(appearanceFilePath, preference)
  themePreference = preference
  nativeTheme.themeSource = nativeThemeSource(preference)
  return publishAppearance()
})

ipcMain.handle('rovai:app-updates-get', (event) => {
  requireMainWindow(event.sender)
  return requireAppUpdates().get()
})

ipcMain.handle('rovai:app-updates-check', (event) => {
  requireMainWindow(event.sender)
  return requireAppUpdates().check('manual')
})

ipcMain.handle('rovai:app-updates-download', (event) => {
  requireMainWindow(event.sender)
  return requireAppUpdates().download()
})

ipcMain.handle('rovai:app-updates-install', (event) => {
  requireMainWindow(event.sender)
  return requireAppUpdates().install()
})

ipcMain.handle('rovai:app-updates-dismiss-prompt', (event, promptId: unknown) => {
  requireMainWindow(event.sender)
  if (typeof promptId !== 'string' || promptId.length === 0 || promptId.length > 200) {
    throw new Error('Invalid application update prompt id')
  }
  return requireAppUpdates().dismissPrompt(promptId)
})

ipcMain.handle('rovai:window-application-menu-popup', (event, input: unknown) => {
  if (process.platform !== 'win32') return false
  const request = parseWindowsApplicationMenuPopupRequest(input)
  if (!request) throw new Error('Unsupported Windows application menu request')

  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed() || window !== mainWindow) return false
  const submenu = windowsApplicationSubmenu(Menu.getApplicationMenu(), request.section)
  if (!submenu) return false

  const bounds = window.getContentBounds()
  const maximumX = Math.max(0, bounds.width - 1)
  const maximumY = Math.max(0, bounds.height - 1)
  submenu.popup({
    window,
    x: Math.max(0, Math.min(request.x, maximumX)),
    y: Math.max(0, Math.min(request.y, maximumY)),
    sourceType: request.sourceType
  })
  return true
})

ipcMain.handle('rovai:desktop-session-get-startup', async (event) => {
  const snapshot = await desktopSessions.getWhenReady(event.sender.id)
  if (!snapshot) throw new Error('Main Window Session is unavailable')
  return structuredClone(snapshot)
})

ipcMain.handle('rovai:desktop-session-commit-location', async (_event, location: unknown) => {
  const validated = parseRestorableLocation(location)
  if (!validated) throw new Error('Unsupported restorable location')
  if (!restorableLocations) throw new Error('Restorable Location store is unavailable')
  await restorableLocations.commit(validated)
})

ipcMain.handle('rovai:general-preferences-get', () => requireGeneralPreferences().get())

ipcMain.handle('rovai:general-preferences-set-startup', (_event, mode: unknown) => {
  if (!isStartupLocationMode(mode)) throw new Error('Unsupported startup location mode')
  return requireGeneralPreferences().setStartupLocationMode(mode as StartupLocationMode)
})

ipcMain.handle('rovai:general-preferences-set-section', (_event, section: unknown) => {
  if (!isSettingsSection(section)) throw new Error('Unsupported settings section')
  return requireGeneralPreferences().setLastSettingsSection(section as SettingsSection)
})

ipcMain.handle('rovai:general-preferences-set-execution-placement', (_event, placement: unknown) => {
  if (!isExecutionConsolePlacement(placement)) throw new Error('Unsupported execution console placement')
  return requireGeneralPreferences().setExecutionConsolePlacement(
    placement as ExecutionConsolePlacement
  )
})

ipcMain.handle('rovai:general-preferences-set-new-conversation-defaults', (_event, defaults: unknown) => {
  if (!isNewConversationDefaults(defaults)) throw new Error('Invalid default new conversation configuration')
  return requireGeneralPreferences().setNewConversationDefaults(defaults)
})

ipcMain.handle('rovai:general-preferences-set-one-click-new-conversation', (_event, enabled: unknown) => {
  if (typeof enabled !== 'boolean') throw new Error('Invalid one-click new conversation preference')
  return requireGeneralPreferences().setOneClickNewConversationEnabled(enabled)
})

ipcMain.handle('rovai:general-preferences-set-world-map', (_event, enabled: unknown) => {
  if (typeof enabled !== 'boolean') throw new Error('Invalid world map preference')
  return requireGeneralPreferences().setWorldMapEnabled(enabled)
})

ipcMain.handle('rovai:general-preferences-invalidate-new-conversation-defaults', () => {
  return requireGeneralPreferences().invalidateNewConversationDefaults()
})

ipcMain.handle('rovai:channels-get', (event) => {
  requireMainWindow(event.sender)
  return channelSettings.get()
})

ipcMain.handle('rovai:execution-web-settings-get', (event) => {
  requireMainWindow(event.sender)
  return executionView.getSettings()
})

ipcMain.handle('rovai:execution-web-settings-set', (event, value: unknown) => {
  requireMainWindow(event.sender)
  const settings = requireObject(value)
  if (typeof settings.enabled !== 'boolean' || typeof settings.port !== 'number'
    || Object.keys(settings).sort().join('\0') !== ['enabled', 'port'].sort().join('\0')) {
    throw new Error('Invalid Execution Web settings')
  }
  return executionView.setSettings({
    enabled: settings.enabled,
    port: settings.port
  } as Pick<ExecutionWebSettingsSnapshot, 'enabled' | 'port'>)
})

ipcMain.handle('rovai:channels-connect', (event, kind: unknown) => {
  requireMainWindow(event.sender)
  return channelSettings.connect(optionalChannelKind(kind))
})

ipcMain.handle('rovai:channels-disconnect', (event, kind: unknown) => {
  requireMainWindow(event.sender)
  return channelSettings.disconnect(optionalChannelKind(kind))
})

ipcMain.handle('rovai:channels-publish-member-bot', (
  event,
  agentId: unknown,
  kind: unknown
) => {
  requireMainWindow(event.sender)
  if (typeof agentId !== 'string' || !agentId) throw new Error('Invalid Agent ID')
  return channelSettings.publishMemberBot(agentId, optionalChannelKind(kind))
})

ipcMain.handle('rovai:channels-retry-member-bot', (event, agentId: unknown, kind: unknown) => {
  requireMainWindow(event.sender)
  if (typeof agentId !== 'string' || !agentId) throw new Error('Invalid Agent ID')
  return channelSettings.retryMemberBot(agentId, optionalChannelKind(kind))
})

ipcMain.handle('rovai:channels-select-publication-approver', (
  event,
  agentId: unknown,
  userId: unknown,
  kind: unknown
) => {
  requireMainWindow(event.sender)
  if (typeof agentId !== 'string' || !agentId) throw new Error('Invalid Agent ID')
  if (typeof userId !== 'string' || !userId) throw new Error('Invalid DingTalk approver')
  return channelSettings.selectPublicationApprover(
    agentId,
    userId,
    optionalChannelKind(kind)
  )
})

ipcMain.handle('rovai:channels-cancel-qr', (event, attemptId: unknown) => {
  requireMainWindow(event.sender)
  if (typeof attemptId !== 'string' || !attemptId) throw new Error('Invalid QR attempt ID')
  return channelSettings.cancelQrAttempt(attemptId)
})

ipcMain.handle('rovai:channels-login-view-bounds', (event, attemptId: unknown, bounds: unknown) => {
  requireMainWindow(event.sender)
  if (typeof attemptId !== 'string' || !attemptId) throw new Error('Invalid QR attempt ID')
  channelSettings.setLoginViewBounds(attemptId, parseChannelLoginViewBounds(bounds))
})

ipcMain.handle('rovai:channels-refresh-login-qr', (event, attemptId: unknown) => {
  requireMainWindow(event.sender)
  if (typeof attemptId !== 'string' || !attemptId) throw new Error('Invalid QR attempt ID')
  channelSettings.refreshLoginQr(attemptId)
})

ipcMain.handle('rovai:onboarding-get', () => requireOnboarding().get())

ipcMain.handle('rovai:onboarding-show-welcome', () => requireOnboarding().showWelcome())

ipcMain.handle('rovai:onboarding-complete-welcome', () => requireOnboarding().completeWelcome())

ipcMain.handle('rovai:onboarding-select-member', (_event, role: unknown) => {
  return requireOnboarding().selectMember(role)
})

ipcMain.handle('rovai:onboarding-show-member-selection', () => {
  return requireOnboarding().showMemberSelection()
})

ipcMain.handle('rovai:onboarding-complete-member-selection', () => {
  return requireOnboarding().completeMemberSelection()
})

ipcMain.handle('rovai:onboarding-set-runtime-selection', (_event, selection: unknown) => {
  return requireOnboarding().setRuntimeSelection(selection)
})

ipcMain.handle('rovai:onboarding-defer-runtime', () => {
  return requireOnboarding().deferRuntimeSetup()
})

ipcMain.handle('rovai:onboarding-begin-provisioning', (
  _event,
  selection: unknown,
  runtimePermissions: unknown
) => {
  return requireOnboarding().beginProvisioning(selection, runtimePermissions)
})

ipcMain.handle('rovai:onboarding-record-member', (_event, agentId: unknown, version: unknown) => {
  return requireOnboarding().recordProvisionedMember(agentId, version)
})

ipcMain.handle('rovai:onboarding-record-runtime', (_event, version: unknown) => {
  return requireOnboarding().recordProvisionedRuntime(version)
})

ipcMain.handle('rovai:onboarding-record-camp', (_event, campId: unknown) => {
  return requireOnboarding().recordProvisionedCamp(campId)
})

ipcMain.handle('rovai:onboarding-complete', () => requireOnboarding().complete())

ipcMain.handle('rovai:window-reset-capability', (event) => {
  const window = requireMainWindow(event.sender)
  return windowResetCapability(window.isFullScreen())
})

ipcMain.handle('rovai:window-reset-bounds', (event) => {
  const window = requireMainWindow(event.sender)
  const display = screen.getDisplayMatching(window.getBounds()).workArea
  return resetWindowBounds(
    window,
    display,
    MIN_WINDOW_WIDTH,
    MIN_WINDOW_HEIGHT,
    (bounds) => writeWindowStateFile(
      join(app.getPath('userData'), 'window-state.json'),
      bounds
    )
  )
})

ipcMain.handle('rovai:navigation-preferences-get', () =>
  projectAccessTransactions.run(async () => requireNavigationPreferences().get())
)

ipcMain.handle('rovai:navigation-preferences-replace-pins', (_event, pins: NavigationPin[]) =>
  projectAccessTransactions.run(() => requireNavigationPreferences().replacePins(pins))
)

ipcMain.handle(
  'rovai:navigation-preferences-remove-project',
  async (_event, targetKey: unknown, relatedCampIds: unknown) => {
    if (typeof targetKey !== 'string' || !Array.isArray(relatedCampIds)) {
      throw new Error('Invalid Project removal request')
    }
    if (!targetKey.startsWith('directory:')) {
      throw new Error('Invalid Project removal target')
    }
    return projectAccessTransactions.run(async () => {
      const executionRoot = targetKey.slice('directory:'.length)
      await core.request('skills.projectAccess.remove', { executionRoot })
      try {
        const result = await requireNavigationPreferences().removeProject(targetKey, relatedCampIds)
        core.setRemovedSkillProjectRoots(removedProjectRootsFromSnapshot(result))
        return result
      } catch (error) {
        await synchronizeCoreProjectAccessFromNavigation().catch(() => undefined)
        throw error
      }
    })
  }
)

ipcMain.handle('rovai:navigation-preferences-restore-project', async (_event, targetKey: unknown) => {
  if (typeof targetKey !== 'string') throw new Error('Invalid Project restore request')
  if (!targetKey.startsWith('directory:')) throw new Error('Invalid Project restore target')
  return projectAccessTransactions.run(async () => {
    const executionRoot = targetKey.slice('directory:'.length)
    const navigationPreferences = requireNavigationPreferences()
    const previousSnapshot = navigationPreferences.get()
    const removedProject = previousSnapshot.removedProjects.find(
      (project) => project.targetKey === targetKey
    )
    return restoreProjectAccessFailClosed({
      previousSnapshot,
      restorationRequired: Boolean(removedProject),
      persistRestoredPreference: () => navigationPreferences.restoreProject(targetKey),
      activateExecutionRoot: async () => {
        await core.request('skills.projectAccess.restore', { executionRoot })
      },
      suspendExecutionRoot: async () => {
        await core.request('skills.projectAccess.remove', { executionRoot })
      },
      persistPreviousPreference: () => {
        if (!removedProject) throw new Error('Project restore transaction has no removed pre-state')
        return navigationPreferences.reinstateRemovedProject(removedProject)
      },
      publishRemovedRoots: (snapshot) => {
        core.setRemovedSkillProjectRoots(removedProjectRootsFromSnapshot(snapshot))
      }
    })
  })
})

ipcMain.handle('rovai:member-avatar-select-source', async () => {
  const options = {
    title: '选择角色图片',
    buttonLabel: '选择图片',
    filters: [
      { name: '静态图片', extensions: ['png', 'jpg', 'jpeg'] }
    ],
    properties: ['openFile'] as Array<'openFile'>
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return inspectMemberAvatarSourceFile(result.filePaths[0])
})

ipcMain.handle(
  'rovai:member-avatar-save',
  async (_event, input: SaveMemberAvatarAssetInput) => requireMemberAvatars().save(input)
)

ipcMain.handle(
  'rovai:member-avatar-read',
  async (
    _event,
    avatarRef: unknown,
    rendition: unknown
  ) => {
    if (
      typeof avatarRef !== 'string'
      || (rendition !== 'icon' && rendition !== 'portrait')
    ) {
      throw new Error('Unsupported member avatar read request')
    }
    return requireMemberAvatars().read(avatarRef, rendition)
  }
)

const MAX_COMPOSER_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_COMPOSER_PREVIEW_BYTES = 8 * 1024 * 1024

async function resolveDesktopAttachmentTarget(
  campId: unknown,
  attachmentId: unknown
): Promise<DesktopAttachmentTarget | null> {
  if (!isCampId(campId) || !isAttachmentId(attachmentId)) return null
  try {
    const value = await core.request<unknown>(
      'camp.attachments.desktopOpenTarget' as CoreMethod,
      { campId, attachmentId }
    )
    return parseDesktopAttachmentTarget(value, attachmentId)
  } catch {
    return null
  }
}

function requireIpcString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024) {
    throw new Error(`${label} 无效。`)
  }
  return value
}

function requireDraftRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('Draft Revision 无效。')
  }
  return value as number
}

ipcMain.handle(
  'rovai:composer-attachment-prepare-path',
  async (
    _event,
    campId: unknown,
    expectedRevision: unknown,
    sourcePath: unknown,
    displayName: unknown
  ) => {
    return core.request('camp.attachments.prepareFromPath' as CoreMethod, {
      campId: requireIpcString(campId, 'Camp ID'),
      expectedRevision: requireDraftRevision(expectedRevision),
      sourcePath: requireIpcString(sourcePath, '附件路径'),
      displayName: requireIpcString(displayName, '附件名称')
    })
  }
)

ipcMain.handle(
  'rovai:composer-attachment-prepare-bytes',
  async (
    _event,
    campId: unknown,
    expectedRevision: unknown,
    displayName: unknown,
    input: unknown
  ) => {
    const resolvedCampId = requireIpcString(campId, 'Camp ID')
    const resolvedRevision = requireDraftRevision(expectedRevision)
    const resolvedDisplayName = requireIpcString(displayName, '附件名称')
    if (!(input instanceof Uint8Array) || input.byteLength > MAX_COMPOSER_ATTACHMENT_BYTES) {
      throw new Error('附件无效或超过 25 MiB。')
    }
    if (coreDataPath === null || !core.getSnapshot().capabilities.coreRequests) {
      throw new Error('Core data directory is not available for attachment import')
    }
    const ingressDirectory = join(coreDataPath, 'attachment-ingress')
    await mkdir(ingressDirectory, { recursive: true, mode: 0o700 })
    await chmod(ingressDirectory, 0o700)
    const temporaryPath = join(ingressDirectory, `${randomUUID()}.tmp`)
    try {
      await writeFile(temporaryPath, input, { flag: 'wx', mode: 0o600 })
      return await core.request('camp.attachments.prepareFromPath' as CoreMethod, {
        campId: resolvedCampId,
        expectedRevision: resolvedRevision,
        sourcePath: temporaryPath,
        displayName: resolvedDisplayName
      })
    } finally {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }
)

ipcMain.handle(
  'rovai:composer-attachment-preview',
  async (_event, attachmentId: unknown) => {
    const source = await core.request<{
      path: string
      mediaType: string
      byteSize: number
    } | null>('camp.attachments.previewSource' as CoreMethod, {
      attachmentId: requireIpcString(attachmentId, '附件 ID')
    })
    if (!source || source.byteSize > MAX_COMPOSER_PREVIEW_BYTES) return null
    const bytes = await readFile(source.path)
    if (bytes.byteLength !== source.byteSize || bytes.byteLength > MAX_COMPOSER_PREVIEW_BYTES) {
      return null
    }
    return {
      mediaType: source.mediaType,
      bytes: new Uint8Array(bytes)
    }
  }
)

ipcMain.handle(
  'rovai:attachment-open',
  async (_event, campId: unknown, attachmentId: unknown) => {
    const target = await resolveDesktopAttachmentTarget(campId, attachmentId)
    if (!target) return { opened: false, error: 'target_unavailable' as const }
    return openDesktopAttachmentTarget(target, {
      async confirm(displayName) {
        const options = {
          type: 'warning' as const,
          buttons: ['取消', '仍然打开'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          message: '此文件可能执行程序或安装软件',
          detail: `只有在你确认来源可信时才继续。\n\n${displayName}`
        }
        const result = mainWindow
          ? await dialog.showMessageBox(mainWindow, options)
          : await dialog.showMessageBox(options)
        return result.response === 1
      },
      openPath(path) {
        return shell.openPath(path)
      }
    })
  }
)

ipcMain.handle(
  'rovai:attachment-reveal',
  async (_event, campId: unknown, attachmentId: unknown) => {
    const target = await resolveDesktopAttachmentTarget(campId, attachmentId)
    if (!target) return { revealed: false, error: 'target_unavailable' as const }
    return revealDesktopAttachmentTarget(target, {
      async canReveal(path) {
        await readdir(dirname(path))
        await lstat(path)
        return true
      },
      revealPath(path) {
        shell.showItemInFolder(path)
      }
    })
  }
)

ipcMain.handle('rovai:select-workspace-directory', async () => {
  const options = {
    title: '选择工作目录',
    buttonLabel: '选择目录',
    properties: ['openDirectory'] as Array<'openDirectory'>
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return core.request('workspaces.validate', { path: result.filePaths[0] })
})

ipcMain.handle('rovai:select-runtime-executable', async () => {
  const options = {
    title: '选择本机 Agent 运行时可执行文件',
    buttonLabel: '选择 Runtime',
    properties: ['openFile'] as Array<'openFile'>
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

ipcMain.handle('rovai:select-skill-import-directory', async () => {
  const options = {
    title: '导入 Skill',
    buttonLabel: '检查目录',
    properties: ['openDirectory'] as Array<'openDirectory'>
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

ipcMain.handle('rovai:reveal-skill', async (_event, skillId: unknown) => {
  if (typeof skillId !== 'string' || !skillId.trim()) {
    throw new Error('Skill ID 无效。')
  }
  const location = await core.request<{ skillId: string; path: string }>(
    'skills.revealLocation',
    { skillId }
  )
  shell.showItemInFolder(location.path)
})

ipcMain.handle('rovai:reveal-mcp-config', async () => {
  const config = await core.request<{ path: string; exists: boolean }>('mcp.config.get')
  if (config.exists) {
    shell.showItemInFolder(config.path)
    return
  }
  const directory = dirname(config.path)
  const error = await shell.openPath(directory)
  if (error) {
    throw new Error(`MCP 配置目录尚不存在：${directory}`)
  }
})

ipcMain.handle('rovai:export-diagnostics', async () => {
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, {
        title: '导出 Rovai AI 诊断数据',
        defaultPath: `rovai-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
    : await dialog.showSaveDialog({
        title: '导出 Rovai AI 诊断数据',
        defaultPath: `rovai-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return null
  const supervisor = core.getSnapshot()
  const diagnostics = supervisor.capabilities.coreRequests
    ? await core.request('diagnostics.export')
    : {
        schemaVersion: 1,
        kind: 'desktop_bootstrap_diagnostics',
        exportedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        supervisor
      }
  const temporary = `${result.filePath}.rovai-${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(diagnostics, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx'
    })
    await chmod(temporary, 0o600)
    await rename(temporary, result.filePath)
    await chmod(result.filePath, 0o600)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  lastDiagnosticsExportPath = result.filePath
  return result.filePath
})

ipcMain.handle('rovai:reveal-diagnostics-export', (_event, path: unknown) => {
  if (typeof path !== 'string' || path !== lastDiagnosticsExportPath) {
    throw new Error('只能显示本次会话刚刚导出的诊断文件。')
  }
  shell.showItemInFolder(path)
})

ipcMain.handle('rovai:export-monitoring', async (_event, filter: MonitoringFilter) => {
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, {
        title: '导出 Rovai AI 运行监控数据',
        defaultPath: `rovai-runtime-monitoring-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
    : await dialog.showSaveDialog({
        title: '导出 Rovai AI 运行监控数据',
        defaultPath: `rovai-runtime-monitoring-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
  if (result.canceled || !result.filePath) return null
  const snapshot = await core.request<RuntimeUsageSnapshot>('monitoring.snapshot', filter)
  const payload = {
    exportedAt: new Date().toISOString(),
    ...snapshot
  }
  const temporary = `${result.filePath}.rovai-${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx'
    })
    await chmod(temporary, 0o600)
    await rename(temporary, result.filePath)
    await chmod(result.filePath, 0o600)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  lastMonitoringExportPath = result.filePath
  return result.filePath
})

ipcMain.handle('rovai:reveal-monitoring-export', (_event, path: unknown) => {
  if (typeof path !== 'string' || path !== lastMonitoringExportPath) {
    throw new Error('只能显示本次会话刚刚导出的运行监控文件。')
  }
  shell.showItemInFolder(path)
})

ipcMain.handle('rovai:export-memory', async () => {
  const options = {
    title: '导出 Rovai AI 记忆',
    defaultPath: `rovai-memory-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  const exported = await core.request('memory.export')
  const temporary = `${result.filePath}.rovai-${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(exported, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx'
    })
    await chmod(temporary, 0o600)
    await rename(temporary, result.filePath)
    await chmod(result.filePath, 0o600)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  return result.filePath
})

const appQuitCoordinator = new AppQuitCoordinator({
  updateInstallPending: () => appUpdates?.get().status === 'installing',
  beforeDrain: () => {
    appUpdates?.dispose()
    nativeTheme.removeListener('updated', publishAppearance)
  },
  drain: async () => {
    const stopAutomation = userAutomation?.stop() ?? Promise.resolve()
    userAutomation = null
    try {
      await Promise.all([stopAutomation, channelHostLifecycle.stop(), executionView.stop()])
    } catch (error) {
      console.error('Rovai application services shutdown failed', error)
    }
    const result = await core.shutdown()
    console.error(`[rovai-core] controlled shutdown result ${JSON.stringify(result)}`)
  },
  reportFailure: (error) => {
    console.error('Rovai Core controlled shutdown failed', error)
  },
  finish: () => {
    // The updater has already staged its installer before update-driven quit.
    // app.exit finishes the bounded drain without reopening native negotiation.
    app.exit(0)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  void filePreview.closeAll()
  appQuitCoordinator.handleBeforeQuit(event)
})

function requireGeneralPreferences(): GeneralPreferencesStore {
  if (!generalPreferences) throw new Error('General Preferences store is unavailable')
  return generalPreferences
}

function requireOnboarding(): OnboardingStore {
  if (!onboarding) throw new Error('Onboarding store is unavailable')
  return onboarding
}

function requireNavigationPreferences(): NavigationPreferencesStore {
  if (!navigationPreferences) throw new Error('Navigation Preferences store is unavailable')
  return navigationPreferences
}

function requireMainWindow(webContents: Electron.WebContents): BrowserWindow {
  const window = BrowserWindow.fromWebContents(webContents)
  if (!window || window.isDestroyed() || window !== mainWindow) {
    throw new Error('Main window is unavailable')
  }
  return window
}

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid channel settings request')
  }
  return value as Record<string, unknown>
}

function requireFilePreviewSender(event: Electron.IpcMainInvokeEvent): number {
  requireMainWindow(event.sender)
  if (event.senderFrame !== event.sender.mainFrame) {
    throw new Error('File preview is only available to the main frame')
  }
  return event.sender.id
}
