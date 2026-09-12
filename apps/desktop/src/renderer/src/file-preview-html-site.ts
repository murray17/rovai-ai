import type { FilePreviewApi, FilePreviewHtmlSite, FilePreviewOperationResult } from '@contracts'

/** An unresponsive transport must not leave the Tab in preparation forever.
 * A late successful site is explicitly released, even after this caller timed out. */
export async function prepareHtmlPreviewSite(api: FilePreviewApi, request: { handleId: string; expectedGeneration: string }): Promise<FilePreviewOperationResult<FilePreviewHtmlSite>> {
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const preparing = api.prepareHtmlSite(request).then(result => {
    if (expired && result.ok) void api.releaseHtmlSite({ previewId: result.value.previewId }).catch(() => undefined)
    return result
  })
  try {
    return await Promise.race([preparing, new Promise<FilePreviewOperationResult<FilePreviewHtmlSite>>(resolve => {
      timer = setTimeout(() => {
        expired = true
        resolve({ ok: false, error: { code: 'preview_timeout', message: '未收到预览服务响应，请重试。', retryable: true } })
      }, 12_000)
    })])
  } finally { if (timer) clearTimeout(timer) }
}
