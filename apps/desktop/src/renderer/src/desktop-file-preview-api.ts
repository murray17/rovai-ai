import type { FilePreviewApi } from '@contracts'

/** Native file operations stay lazy; explicit browser adapters never enter this path. */
export const desktopFilePreviewApi: FilePreviewApi = {
  bindCamp: id => window.rovai.filePreview.bindCamp(id),
  open: input => window.rovai.filePreview.open(input),
  restore: input => window.rovai.filePreview.restore(input),
  reopen: input => window.rovai.filePreview.reopen(input),
  readText: input => window.rovai.filePreview.readText(input),
  readPage: input => window.rovai.filePreview.readPage(input),
  resolveLine: input => window.rovai.filePreview.resolveLine(input),
  readBinary: input => window.rovai.filePreview.readBinary(input),
  prepareHtml: input => window.rovai.filePreview.prepareHtml(input),
  reload: input => window.rovai.filePreview.reload(input),
  release: input => window.rovai.filePreview.release(input),
  openInSystem: input => window.rovai.filePreview.openInSystem(input),
  revealInFolder: input => window.rovai.filePreview.revealInFolder(input),
  copyPath: input => window.rovai.filePreview.copyPath(input),
  chooseAuthorizedRoot: input => window.rovai.filePreview.chooseAuthorizedRoot(input),
  onExternalUpdate: listener => window.rovai.filePreview.onExternalUpdate(listener)
}
