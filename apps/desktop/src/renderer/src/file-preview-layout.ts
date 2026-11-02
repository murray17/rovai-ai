export const DEFAULT_FILE_PREVIEW_RATIO = .56
export const MIN_CONVERSATION_WIDTH = 420
export const MIN_FILE_PREVIEW_WIDTH = 420
export const FILE_PREVIEW_SPLIT_MIN_WIDTH = MIN_CONVERSATION_WIDTH + MIN_FILE_PREVIEW_WIDTH + 1
export const FILE_PREVIEW_RATIO_STORAGE_KEY = 'rovai.file-preview.preferred-ratio'
export const DEFAULT_DIRECTORY_WIDTH = 228
export const MIN_DIRECTORY_WIDTH = 200
export const MAX_DIRECTORY_WIDTH = 480
export const MIN_DIRECTORY_READING_WIDTH = 320

export function filePreviewSplitMinWidth(_activityMode = false): number {
  return FILE_PREVIEW_SPLIT_MIN_WIDTH
}

export function filePreviewRatioFromStoredValue(value: string | null): number | null {
  const ratio = Number(value)
  return Number.isFinite(ratio) && ratio > 0 && ratio < 1 ? ratio : null
}

export function maximumFilePreviewWidth(availableWidth: number): number {
  return Math.max(0, availableWidth - MIN_CONVERSATION_WIDTH)
}

export function filePreviewWidthForRatio(availableWidth: number, ratio: number): number {
  if (availableWidth < FILE_PREVIEW_SPLIT_MIN_WIDTH) return Math.max(0, availableWidth)
  return Math.min(maximumFilePreviewWidth(availableWidth), Math.max(MIN_FILE_PREVIEW_WIDTH, availableWidth * ratio))
}

export function filePreviewDragWidth(availableWidth: number, requestedWidth: number): number {
  return Math.min(maximumFilePreviewWidth(availableWidth), Math.max(0, requestedWidth))
}

export function filePreviewRatioForWidth(availableWidth: number, requestedWidth: number): number | null {
  if (!Number.isFinite(requestedWidth) || availableWidth < FILE_PREVIEW_SPLIT_MIN_WIDTH) return null
  const width = Math.min(maximumFilePreviewWidth(availableWidth), Math.max(MIN_FILE_PREVIEW_WIDTH, requestedWidth))
  return width / availableWidth
}
