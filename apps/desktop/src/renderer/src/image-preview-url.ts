/** The composer, the published cache entry and a mounted tile may briefly share one decoded source. */
export class ImagePreviewUrl {
  private objectUrl: string
  private owners = 1

  constructor(readonly blob: Blob) {
    this.objectUrl = URL.createObjectURL(blob)
  }

  get url(): string { return this.objectUrl }

  retain(): this {
    // An async cache reader can still hold the Blob after the last visible/cache owner evicted its URL.
    if (!this.owners) this.objectUrl = URL.createObjectURL(this.blob)
    this.owners++
    return this
  }

  release(): void {
    if (--this.owners === 0) URL.revokeObjectURL(this.url)
  }
}
