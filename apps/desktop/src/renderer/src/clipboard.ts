function execClipboardWrite(text: string, html?: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const handleCopy = (event: ClipboardEvent): void => {
    if (!event.clipboardData) return
    event.clipboardData.setData('text/plain', text)
    if (html !== undefined) event.clipboardData.setData('text/html', html)
    event.preventDefault()
  }
  document.addEventListener('copy', handleCopy)
  try {
    return document.execCommand('copy')
  } finally {
    document.removeEventListener('copy', handleCopy)
    textarea.remove()
  }
}

export async function writeClipboardText(text: string, html?: string): Promise<boolean> {
  try {
    await window.rovai.clipboard.write({ text, html: html ?? null })
    return true
  } catch {
    try {
      if (
        html !== undefined
        && typeof ClipboardItem !== 'undefined'
        && typeof navigator.clipboard.write === 'function'
      ) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        })])
        return true
      }
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      try {
        return execClipboardWrite(text, html)
      } catch {
        return false
      }
    }
  }
}

/** Copy the full decoded image, independently of thumbnail sizing or cropping. */
export async function writeClipboardImage(image: HTMLImageElement): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('image_clipboard_unavailable')
  }
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) {
    throw new Error('image_unavailable')
  }
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('image_unavailable')
    context.drawImage(image, 0, 0)
    const png = new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('image_encoding_failed')), 'image/png')
    })
    // Start the write during the user gesture, even when PNG encoding is asynchronous.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
