import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNavigationPressGesture } from './useNavigationPressMenu'

const touch = { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 40, clientY: 80 }

describe('mobile navigation press gesture', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('leaves a short tap available for the existing row action', () => {
    const open = vi.fn()
    const gesture = createNavigationPressGesture(open)
    gesture.start(touch)
    vi.advanceTimersByTime(200)
    gesture.cancel()
    vi.runAllTimers()
    expect(open).not.toHaveBeenCalled()
    expect(gesture.consumeClick()).toBe(false)
  })

  it('opens once at 480 ms and consumes the release click instead of navigating', () => {
    const open = vi.fn()
    const gesture = createNavigationPressGesture(open)
    gesture.start(touch)
    vi.advanceTimersByTime(479)
    expect(open).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    gesture.cancel()
    vi.runAllTimers()
    expect(open).toHaveBeenCalledTimes(1)
    expect(gesture.consumeClick()).toBe(true)
    expect(gesture.consumeClick()).toBe(false)
  })

  it('cancels a scrolling gesture and does not activate the row on release', () => {
    const open = vi.fn()
    const gesture = createNavigationPressGesture(open)
    gesture.start(touch)
    gesture.move({ ...touch, clientY: 91 })
    vi.runAllTimers()
    expect(open).not.toHaveBeenCalled()
    expect(gesture.consumeClick()).toBe(true)
    gesture.start(touch)
    gesture.cancel()
    expect(gesture.consumeClick()).toBe(false)
  })

  it('tolerates small finger movement and ignores unrelated pointer movement', () => {
    const open = vi.fn()
    const gesture = createNavigationPressGesture(open)
    gesture.start(touch)
    gesture.move({ ...touch, clientX: 45, clientY: 85 })
    gesture.move({ ...touch, pointerId: 2, clientY: 500 })
    vi.runAllTimers()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('cancels pending work without opening a stale menu', () => {
    const open = vi.fn()
    const gesture = createNavigationPressGesture(open)
    gesture.start(touch)
    gesture.cancel()
    vi.runAllTimers()
    expect(open).not.toHaveBeenCalled()
  })

  it('does not treat mouse holds, secondary buttons or secondary touches as long presses', () => {
    const open = vi.fn()
    const gesture = createNavigationPressGesture(open)
    for (const event of [{ ...touch, pointerType: 'mouse' }, { ...touch, button: 2 }, { ...touch, isPrimary: false }]) {
      expect(gesture.start(event)).toBe(false)
      vi.runAllTimers()
    }
    expect(open).not.toHaveBeenCalled()
  })

  it('replaces a pending hold with the context menu and leaves the next tap usable', () => {
    const open = vi.fn()
    const gesture = createNavigationPressGesture(open)
    gesture.start(touch)
    gesture.openContext()
    vi.runAllTimers()
    expect(open).toHaveBeenCalledTimes(1)
    gesture.start(touch)
    gesture.cancel()
    expect(gesture.consumeClick()).toBe(false)
  })

  it('opens a mouse context menu without consuming the next left click', () => {
    const open = vi.fn()
    const gesture = createNavigationPressGesture(open)
    gesture.openContext(false)
    expect(open).toHaveBeenCalledTimes(1)
    expect(gesture.consumeClick()).toBe(false)
  })
})
