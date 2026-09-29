let installed = false

export function installInteractions() {
  if (installed) return
  installed = true

  document.addEventListener('click', async (event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const copy = target.closest<HTMLButtonElement>('.prompt-copy')
    if (copy) {
      const prompt = copy.previousElementSibling
      if (!prompt) return
      try {
        await navigator.clipboard.writeText(prompt.textContent || '')
        copy.textContent = document.body.dataset.lang === 'zh' ? '已复制' : 'Copied'
      } catch {
        const selection = getSelection()
        const range = document.createRange()
        range.selectNodeContents(prompt)
        selection?.removeAllRanges()
        selection?.addRange(range)
        copy.textContent = document.body.dataset.lang === 'zh' ? '已选中，请用键盘复制' : 'Selected — copy with keyboard'
      }
      return
    }

    const expand = target.closest<HTMLButtonElement>('[data-image]')
    if (expand) {
      const box = document.querySelector<HTMLDialogElement>('.lightbox')
      if (!box) return
      const img = new Image()
      img.src = expand.dataset.image || ''
      img.alt = expand.querySelector('img')?.alt || ''
      box.querySelector('.lightbox-media')?.replaceChildren(img)
      box.showModal()
      document.body.classList.add('modal-open')
      return
    }

    const close = target.closest('.lightbox .icon-button')
    if (close) document.querySelector<HTMLDialogElement>('.lightbox')?.close()
    if (target.matches('.lightbox')) (target as HTMLDialogElement).close()
  })

  document.addEventListener('close', (event) => {
    if ((event.target as Element)?.matches?.('.lightbox')) document.body.classList.remove('modal-open')
  }, true)

  document.addEventListener('change', (event) => {
    const select = event.target
    if (!(select instanceof HTMLSelectElement) || !select.closest('.mobile-doc-select')) return
    const lang = document.body.dataset.lang === 'zh' ? '/zh' : ''
    window.location.href = select.value === 'index' ? `${lang}/docs/` : `${lang}/docs/${select.value}.html`
  })
}
