import type { RovaiApi } from '@contracts'
import type { CampClient } from './camp-client'
import type { FilePreviewApi } from '@contracts'

/** Only dependencies the production business shell uses; never a replacement window.rovai. */
export interface BusinessEnvironment {
  client: CampClient
  files: FilePreviewApi
  preferences: Pick<RovaiApi, 'appearance' | 'generalPreferences' | 'navigationPreferences'>
  selectWorkspaceDirectory: RovaiApi['selectWorkspaceDirectory']
  /** Native startup, updates, lifecycle and notification integration are absent on Web. */
  desktop?: Pick<RovaiApi, 'desktopSession' | 'onboarding' | 'appLifecycle' | 'userAutomation' | 'appUpdates' | 'exportDiagnostics' | 'windowControls' | 'hostWeb'>
}
