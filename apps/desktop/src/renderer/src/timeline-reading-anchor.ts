export interface TimelineMessageAnchor {
  messageId: string
  topOffset: number
}

export interface TimelineReadingAnchor {
  source: { element: HTMLElement; topOffset: number } | null
  message: TimelineMessageAnchor | null
  scrollTop: number
}

export function visibleTimelineMessageAnchor(timeline: HTMLElement): TimelineMessageAnchor | null {
  const viewport = timeline.getBoundingClientRect()
  for (const message of timeline.querySelectorAll<HTMLElement>('[data-message-id]')) {
    const bounds = message.getBoundingClientRect()
    if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue
    const messageId = message.dataset.messageId
    if (messageId) return { messageId, topOffset: bounds.top - viewport.top }
  }
  return null
}

export function captureTimelineReadingAnchor(timeline: HTMLElement, source?: HTMLElement): TimelineReadingAnchor {
  return {
    source: source && timeline.contains(source)
      ? { element: source, topOffset: source.getBoundingClientRect().top - timeline.getBoundingClientRect().top }
      : null,
    message: visibleTimelineMessageAnchor(timeline),
    scrollTop: timeline.scrollTop
  }
}

export function restoreTimelineReadingAnchor(timeline: HTMLElement, anchor: TimelineReadingAnchor): void {
  let element = anchor.source?.element
  let topOffset = anchor.source?.topOffset
  if (!element?.isConnected || !timeline.contains(element)) {
    element = [...timeline.querySelectorAll<HTMLElement>('[data-message-id]')]
      .find((message) => message.dataset.messageId === anchor.message?.messageId)
    topOffset = anchor.message?.topOffset
  }
  if (element && topOffset !== undefined) {
    timeline.scrollTop += element.getBoundingClientRect().top - timeline.getBoundingClientRect().top - topOffset
  } else {
    timeline.scrollTop = anchor.scrollTop
  }
}
