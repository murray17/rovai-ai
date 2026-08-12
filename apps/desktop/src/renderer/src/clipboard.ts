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
