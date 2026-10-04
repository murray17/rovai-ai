import type { BusinessEnvironment } from './business-environment'
import { desktopThreadClient } from './desktop-camp-client'
import { desktopFilePreviewApi } from './desktop-file-preview-api'

export const desktopBusinessEnvironment: BusinessEnvironment = {
  client: desktopThreadClient,
  files: desktopFilePreviewApi,
  get preferences() { return window.rovai },
  get desktop() { return window.rovai },
  selectWorkspaceDirectory: () => window.rovai.selectWorkspaceDirectory(),
  revealProjectDirectory: path => window.rovai.revealProjectDirectory(path)
}
