interface PreviewFrame {
  frameTreeNodeId: number
  url: string
  parent: PreviewFrame | null
}

/** Keeps an admitted iframe associated with its revocable site while the page
 * follows ordinary web links. Main-frame navigation remains a separate gate. */
export class FilePreviewFrameNavigation {
  readonly #owners = new Map<number, string>()
  constructor(readonly owns: (url: string) => boolean) {}
  allows(targetUrl: string, frame: PreviewFrame | null, main: PreviewFrame, liveFrames: PreviewFrame[]): boolean {
    for (const id of this.#owners.keys()) if (!liveFrames.some(item => item.frameTreeNodeId === id)) this.#owners.delete(id)
    if (!frame || frame === main) return false
    let target: URL
    try { target = new URL(targetUrl) } catch { return false }
    if (this.owns(targetUrl)) { this.#owners.set(frame.frameTreeNodeId, target.origin); return true }
    if (!['http:', 'https:', 'about:'].includes(target.protocol)) return false
    if (target.protocol !== 'about:' && target.origin === new URL(main.url).origin) return false
    if (target.protocol === 'about:' && !['about:blank', 'about:srcdoc'].includes(targetUrl)) return false
    for (let ancestor: PreviewFrame | null = frame; ancestor && ancestor !== main; ancestor = ancestor.parent) {
      const owner = this.#owners.get(ancestor.frameTreeNodeId)
      if (this.owns(ancestor.url) || (owner && this.owns(owner))) return true
    }
    return false
  }
}
