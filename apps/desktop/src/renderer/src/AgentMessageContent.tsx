import { useLayoutEffect, useRef, type HTMLAttributes } from 'react'

/** A public message owns its artifact width; sibling messages and attachments do not. */
export function AgentMessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const view = root.ownerDocument.defaultView
    if (!view) return
    let frame: number | null = null
    let disposed = false
    const measure = (): void => {
      frame = null
      if (!root.isConnected || !root.getClientRects().length) return
      let width = 0
      // Tables keep their intrinsic width inside a separate scroll viewport.
      for (const table of root.querySelectorAll<HTMLElement>('.markdown-table-scroll > table')) {
        const scroll = table.parentElement!
        const frame = scroll.closest('.markdown-table-frame')
        const gutter = frame ? frame.getBoundingClientRect().width - scroll.getBoundingClientRect().width : 0
        width = Math.max(width, table.getBoundingClientRect().width + gutter)
      }
      for (const pre of root.querySelectorAll<HTMLElement>('.markdown-code-frame > pre')) {
        const range = root.ownerDocument.createRange()
        range.selectNodeContents(pre)
        const style = view.getComputedStyle(pre)
        const inset = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
        const gutter = pre.parentElement!.getBoundingClientRect().width - pre.getBoundingClientRect().width
        // A text Range measures unwrapped code, even when pre is currently clipped.
        width = Math.max(width, range.getBoundingClientRect().width + inset + gutter)
      }
      const next = `${Math.ceil(width)}px`
      if (root.style.getPropertyValue('--agent-message-artifact-width') !== next) {
        root.style.setProperty('--agent-message-artifact-width', next)
      }
    }
    const schedule = (): void => {
      if (!disposed && frame === null) frame = view.requestAnimationFrame(measure)
    }
    const resize = new view.ResizeObserver(schedule)
    resize.observe(root)
    // A streamed/replaced code line may change width without changing message height.
    const mutation = new view.MutationObserver(schedule)
    mutation.observe(root, { childList: true, characterData: true, subtree: true })
    view.addEventListener('resize', schedule)
    root.ownerDocument.fonts.ready.then(schedule)
    measure()
    return () => {
      disposed = true
      resize.disconnect()
      mutation.disconnect()
      view.removeEventListener('resize', schedule)
      if (frame !== null) view.cancelAnimationFrame(frame)
    }
  }, [])
  return <div {...props} ref={ref} className={`${className ?? ''} agent-message-content`} />
}
