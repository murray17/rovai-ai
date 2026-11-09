import { createContext, useContext } from 'react'
import type { FilePreviewContextValue } from './file-preview-controller'

// Consumers may offer an existing preview action without importing its provider,
// document viewers, editors, or render engines (notably the public execution UI).
export const FilePreviewContext = createContext<FilePreviewContextValue | null>(null)
export function useOptionalFilePreview(): FilePreviewContextValue | null { return useContext(FilePreviewContext) }
export function useFilePreview(): FilePreviewContextValue {
  const value = useOptionalFilePreview()
  if (!value) throw new Error('FilePreviewProvider is unavailable')
  return value
}
