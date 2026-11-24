import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { NavigationProjectMove } from '@contracts'

type FolderDrag = {
  section: HTMLElement
  lane: NavigationProjectMove['section']
  group: HTMLElement
  row: HTMLButtonElement
  key: string
  pointerId: number
  touch: boolean
  startX: number
  startY: number
  x: number
  y: number
}

function createPreview(drag: FolderDrag) {
  const bounds = drag.row.getBoundingClientRect()
  const preview = document.createElement('div')
  preview.className = 'project-drag-preview'
  preview.inert = true
  preview.setAttribute('aria-hidden', 'true')
  preview.style.height = bounds.height + 'px'
  const face = document.createElement('div')
  face.className = 'project-heading-row'
  face.dataset.expanded = drag.row.getAttribute('aria-expanded') ?? 'false'
  const content = document.createElement('span')
  content.className = 'project-select-row'
  if (drag.row.hasAttribute('aria-current')) content.setAttribute('aria-current', 'true')
  for (const child of drag.row.querySelectorAll('.project-folder-glyph, .navigation-title')) {
    content.append(child.cloneNode(true))
  }
  face.append(content)
  preview.append(face)
  const line = document.createElement('div')
  line.className = 'project-insertion-line'
  line.hidden = true
  line.setAttribute('aria-hidden', 'true')
  document.body.append(preview, line)
  const grabX = Math.min(drag.startX - bounds.left, preview.getBoundingClientRect().width - 8)
  return { preview, line, grabX, grabY: drag.startY - bounds.top }
}

// A group includes its expanded children. Measure the current DOM so another window's
// reorder or a change in height updates the visible line and the submitted anchor together.
function dropPosition(drag: FolderDrag, rail: HTMLElement, groups: HTMLElement[]) {
  const bounds = rail.getBoundingClientRect()
  if (drag.x < bounds.left || drag.x > bounds.right || drag.y < bounds.top || drag.y > bounds.bottom) return
  const rows = groups.map(group => ({ group, rect: group.getBoundingClientRect() }))
  const first = rows[0].rect
  const last = rows[rows.length - 1].rect
  // Quick Chat or a still-unregistered directory can follow the last movable folder.
  const following = groups[groups.length - 1].nextElementSibling?.getBoundingClientRect()
  const top = drag.lane === 'pinned' || groups[0].previousElementSibling?.matches('.camp-nav-group')
    ? first.top - 7 : drag.section.getBoundingClientRect().top
  if (drag.y < top || drag.y > (following?.top ?? last.bottom + 12)) return
  const next = rows.findIndex(({ group, rect }) => group !== drag.group && drag.y < rect.top + rect.height / 2)
  const before = next < 0 ? null : groups[next].dataset.projectSortKey!
  if (before === (groups[groups.indexOf(drag.group) + 1]?.dataset.projectSortKey ?? null)) return
  let y = (last.bottom + (following?.top ?? last.bottom)) / 2
  if (next >= 0) {
    const row = rows[next]
    const above = next === 0 ? row.rect.top : row.group.previousElementSibling!.getBoundingClientRect().bottom
    y = (above + row.rect.top) / 2
  }
  if (y < bounds.top + 1 || y > bounds.bottom - 1) return
  return { before, y, left: first.left + 8, width: Math.max(0, first.width - 16) }
}

export function useProjectFolderDrag(railRef: RefObject<HTMLDivElement | null>, move?: (request: NavigationProjectMove) => void) {
  const refresh = useRef<(() => void) | null>(null)
  useLayoutEffect(() => { refresh.current?.() })
  useLayoutEffect(() => {
    if (!railRef.current || !move) return
    const rail = railRef.current
    const submit = move
    let drag: FolderDrag | undefined
    let carry: ReturnType<typeof createPreview> | undefined
    let before: string | null | undefined
    let frame = 0
    let suppressClick = false

    function finish(save = false) {
      const held = drag
      drag = undefined
      if (!held || !carry) return
      cancelAnimationFrame(frame)
      if (rail.hasPointerCapture(held.pointerId)) rail.releasePointerCapture(held.pointerId)
      carry.preview.remove()
      carry.line.remove()
      carry = undefined
      delete held.group.dataset.projectDragSource
      delete document.documentElement.dataset.projectDragging
      suppressClick = true
      const anchor = before
      before = undefined
      if (save && anchor !== undefined) {
        const focused = document.activeElement === held.row
        submit({ section: held.lane, projectKey: held.key, beforeProjectKey: anchor })
        if (focused) requestAnimationFrame(() => {
          if (held.row.isConnected && document.activeElement === document.body) held.row.focus({ preventScroll: true })
        })
      }
    }

    function paint() {
      if (!drag || !carry) return
      carry.preview.style.transform = `translate3d(${drag.x - carry.grabX}px,${drag.y - carry.grabY}px,0)`
      const groups = Array.from(drag.section.querySelectorAll<HTMLElement>(':scope > [data-project-sort-key]'))
      if (!rail.contains(drag.group) || !groups.includes(drag.group)
        || (before != null && !groups.some(group => group.dataset.projectSortKey === before))) {
        finish()
        return
      }
      const position = dropPosition(drag, rail, groups)
      before = position?.before
      carry.line.hidden = !position
      if (position) {
        carry.line.style.top = position.y + 'px'
        carry.line.style.left = position.left + 'px'
        carry.line.style.width = position.width + 'px'
      }
    }

    function scrollAtEdge() {
      if (!drag || !carry) return
      const bounds = rail.getBoundingClientRect()
      if (drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= bounds.top && drag.y <= bounds.bottom) {
        const edge = Math.min(42, bounds.height / 5)
        const delta = drag.y < bounds.top + edge ? drag.y - bounds.top - edge : Math.max(0, drag.y - bounds.bottom + edge)
        if (delta) {
          const previous = rail.scrollTop
          rail.scrollTop += Math.sign(delta) * Math.min(12, Math.ceil(Math.abs(delta) / 4))
          if (rail.scrollTop !== previous) paint()
        }
      }
      if (carry) frame = requestAnimationFrame(scrollAtEdge)
    }

    function down(event: PointerEvent) {
      suppressClick = false
      if (!event.isPrimary) { finish(); return }
      if (drag || event.button !== 0 || event.ctrlKey || !(event.target instanceof Element) || !rail.contains(event.target)) return
      const row = event.target.closest<HTMLButtonElement>('.project-select-row')
      const group = row?.closest<HTMLElement>('[data-project-sort-key]')
      const section = group?.parentElement
      const lane = section?.dataset.projectSortSection
      if (!row || !group || !section || (lane !== 'pinned' && lane !== 'projects') || row.parentElement?.dataset.menuOpen) return
      const touch = event.pointerType === 'touch' || event.pointerType === 'pen'
      if (touch) {
        const icon = row.querySelector('.project-folder-glyph')!.getBoundingClientRect()
        if (event.target.closest('.navigation-title') || Math.abs(event.clientX - icon.left - icon.width / 2) > 22) return
        event.stopPropagation() // The label keeps the existing scroll and long-press menu.
      }
      drag = { section, lane, group, row, key: group.dataset.projectSortKey!, pointerId: event.pointerId, touch,
        startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY }
    }

    function pointerMove(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.pointerId) return
      drag.x = event.clientX
      drag.y = event.clientY
      if (!carry) {
        if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return
        carry = createPreview(drag)
        drag.group.dataset.projectDragSource = 'true'
        document.documentElement.dataset.projectDragging = 'true'
        // Capture on the stable rail. React can move the source row during a cross-window update.
        rail.setPointerCapture(event.pointerId)
        frame = requestAnimationFrame(scrollAtEdge)
      }
      event.preventDefault()
      paint()
    }
    function up(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.pointerId) return
      if (carry) {
        event.preventDefault()
        drag.x = event.clientX
        drag.y = event.clientY
        paint()
      }
      finish(true)
    }
    function cancel() { finish() }
    const listeners = new AbortController()
    const options = { capture: true, signal: listeners.signal }
    document.addEventListener('pointerdown', down, options)
    document.addEventListener('pointermove', pointerMove, { ...options, passive: false })
    document.addEventListener('pointerup', up, options)
    document.addEventListener('pointercancel', event => { if (drag?.pointerId === event.pointerId) cancel() }, options)
    rail.addEventListener('lostpointercapture', event => { if (event.target === rail && event.pointerId === drag?.pointerId) cancel() }, options)
    rail.addEventListener('touchmove', event => { if (drag?.touch && event.cancelable) event.preventDefault() }, { ...options, passive: false })
    rail.addEventListener('contextmenu', event => { if (drag?.touch) { event.preventDefault(); event.stopPropagation() } }, options)
    rail.addEventListener('scroll', paint, options)
    document.addEventListener('click', event => {
      if (suppressClick && event.detail !== 0) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation() }
    }, options)
    document.addEventListener('keydown', event => {
      if (drag && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
    }, options)
    document.addEventListener('visibilitychange', cancel, options)
    window.addEventListener('blur', cancel, options)
    window.addEventListener('resize', cancel, options)
    refresh.current = paint
    return () => { refresh.current = null; cancel(); listeners.abort() }
  }, [railRef, move])
}
