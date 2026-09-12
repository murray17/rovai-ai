import type { BusinessEnvironment } from './business-environment'
import { desktopCampClient } from './desktop-camp-client'
import { desktopFilePreviewApi } from './desktop-file-preview-api'

export const desktopBusinessEnvironment: BusinessEnvironment = {
  client: desktopCampClient,
  files: desktopFilePreviewApi,
  get preferences() { return window.rovai },
  get desktop() { return window.rovai },
  selectWorkspaceDirectory: () => window.rovai.selectWorkspaceDirectory()
}
