import { expect, it, vi } from 'vitest'
import type { FilePreviewApi, FilePreviewHtmlSite, FilePreviewOperationResult } from '@contracts'
import { prepareHtmlPreviewSite } from './file-preview-html-site'

it('ends stalled preparation and releases any late descriptor without adopting it', async () => {
  vi.useFakeTimers()
  try {
    let finish!: (value: FilePreviewOperationResult<FilePreviewHtmlSite>) => void
    const release = vi.fn(async () => ({released:true as const}))
    const api = {prepareHtmlSite: () => new Promise(resolve => { finish = resolve }), releaseHtmlSite:release} as unknown as FilePreviewApi
    const result=prepareHtmlPreviewSite(api,{handleId:'handle',expectedGeneration:'generation'})
    await vi.advanceTimersByTimeAsync(12_000)
    expect(await result).toMatchObject({ok:false,error:{code:'preview_timeout'}})
    finish({ok:true,value:{previewId:'late'} as FilePreviewHtmlSite})
    await vi.runAllTimersAsync()
    expect(release).toHaveBeenCalledWith({previewId:'late'})
  } finally { vi.useRealTimers() }
})
