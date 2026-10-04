import type { RovaiApi } from '@contracts'
import type { ThreadClient } from './camp-client'
import type { FilePreviewApi } from '@contracts'

/** Only dependencies the production business shell uses; never a replacement window.rovai. */
export interface BusinessEnvironment {
  navigationHistory?: import('./desktop-navigation').NavigationHistory
  client: ThreadClient
  files: FilePreviewApi
  preferences: Pick<RovaiApi, 'appearance' | 'generalPreferences' | 'navigationPreferences'>
  selectWorkspaceDirectory: RovaiApi['selectWorkspaceDirectory']
  revealProjectDirectory?: RovaiApi['revealProjectDirectory']
  serverUpdates?: RovaiApi['appUpdates']
  /** Native startup, updates, lifecycle and notification integration are absent on Web. */
  desktop?: Pick<RovaiApi, 'desktopSession' | 'onboarding' | 'appLifecycle' | 'userAutomation' | 'appUpdates' | 'exportDiagnostics' | 'windowControls' | 'windowClose' | 'hostWeb'>
}
