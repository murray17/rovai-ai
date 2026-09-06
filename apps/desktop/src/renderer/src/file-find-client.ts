import type { FileFindDocument, FileFindOptions, FileFindResult } from './file-find'

export function searchFileDocuments(documents: FileFindDocument[], options: FileFindOptions, signal: AbortSignal): Promise<FileFindResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const worker = new Worker(new URL('./file-find.worker.ts', import.meta.url), { type: 'module' })
    const finish = (result?: FileFindResult): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      worker.terminate()
      if (result) resolve(result)
      else reject(new DOMException('Aborted', 'AbortError'))
    }
    const abort = (): void => finish()
    const timer = setTimeout(() => finish({ matches: [], limited: false, error: '查找耗时过长，请缩短内容或简化正则表达式。' }), 1_500)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<FileFindResult>) => finish(event.data)
    worker.onerror = () => finish({ matches: [], limited: false, error: '暂时无法查找，请重新输入。' })
    worker.postMessage({ documents, options })
  })
}
