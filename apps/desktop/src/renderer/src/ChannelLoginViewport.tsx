import { useLayoutEffect, useRef, useState } from 'react'
import type { ChannelLoginViewBounds } from '@contracts'

/** Only viewport geometry crosses IPC; the official page never receives the Rovai bridge. */
export function ChannelLoginViewport({ attemptId }: { attemptId: string }): React.JSX.Element {
  const element = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  useLayoutEffect(() => {
    const target = element.current
    if (!target) return
    let active = true
    let frame = 0
    let lastBounds = ''
    const update = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!active) return
        const bounds = visibleLoginViewport(target)
        const signature = JSON.stringify(bounds)
        if (signature === lastBounds) return
        lastBounds = signature
        void window.rovai.channels.setLoginViewBounds(attemptId, bounds).catch(() => {
          if (active) setFailed(true)
        })
      })
    }
    const resize = new ResizeObserver(update)
    resize.observe(target)
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    // Dialog entry uses a transform animation; ResizeObserver alone does not
    // notice its final position.
    document.addEventListener('animationend', update, true)
    update()
    return () => {
      active = false
      cancelAnimationFrame(frame)
      resize.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
      document.removeEventListener('animationend', update, true)
      void window.rovai.channels.setLoginViewBounds(attemptId, null).catch(() => undefined)
    }
  }, [attemptId])

  return <div ref={element} className="channel-login-viewport" role="region" aria-label="钉钉官方登录验证">
    <span role={failed ? 'alert' : 'status'}>{failed
      ? '暂时无法显示钉钉登录页，请关闭后重新连接。'
      : '正在显示钉钉官方登录页…'}</span>
  </div>
}

function visibleLoginViewport(element: HTMLElement): ChannelLoginViewBounds | null {
  const rect = element.getBoundingClientRect()
  let left = Math.max(0, rect.left)
  let top = Math.max(0, rect.top)
  let right = Math.min(window.innerWidth, rect.right)
  let bottom = Math.min(window.innerHeight, rect.bottom)
  // At 200% zoom the Dialog body can scroll. The native view must not cover its
  // header/footer, even if part of this placeholder is clipped by an ancestor.
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor)
    const clip = ancestor.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/u.test(style.overflowX)) {
      left = Math.max(left, clip.left)
      right = Math.min(right, clip.right)
    }
    if (/(auto|scroll|hidden|clip)/u.test(style.overflowY)) {
      top = Math.max(top, clip.top)
      bottom = Math.min(bottom, clip.bottom)
    }
  }
  return right - left >= 1 && bottom - top >= 1
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null
}
