import { describe, expect, it } from 'vitest'
import { APPEARANCE_ZOOM_OPTIONS } from '../shared/appearance'
import {
  nextPageZoomPercentage,
  pageZoomAction,
  pageZoomFactor,
  pageZoomPercentage,
  type PageZoomKeyboardInput
} from './page-zoom'

function keyboardInput(
  overrides: Partial<PageZoomKeyboardInput> = {}
): PageZoomKeyboardInput {
  return {
    type: 'keyDown',
    key: '-',
    code: 'Minus',
    isComposing: false,
    control: false,
    alt: false,
    meta: true,
    ...overrides
  }
}

describe('page zoom feedback', () => {
  it('maps the platform page zoom accelerators to actions', () => {
    expect(pageZoomAction(keyboardInput(), 'darwin')).toBe('out')
    expect(pageZoomAction(keyboardInput({ key: '+', code: 'Equal' }), 'darwin')).toBe('in')
    expect(pageZoomAction(keyboardInput({ key: '0', code: 'Digit0' }), 'darwin')).toBe('reset')
    expect(pageZoomAction(keyboardInput({
      key: '=',
      code: 'Equal',
      meta: false,
      control: true
    }), 'win32')).toBe('in')
    expect(pageZoomAction(keyboardInput({
      key: 'Subtract',
      code: 'NumpadSubtract',
      meta: false,
      control: true
    }), 'linux')).toBe('out')
  })

  it('ignores unrelated or modified input', () => {
    expect(pageZoomAction(keyboardInput({ type: 'keyUp' }), 'darwin')).toBeNull()
    expect(pageZoomAction(keyboardInput({ key: 'k', code: 'KeyK' }), 'darwin')).toBeNull()
    expect(pageZoomAction(keyboardInput({ alt: true }), 'darwin')).toBeNull()
    expect(pageZoomAction(keyboardInput({ control: true }), 'darwin')).toBeNull()
    expect(pageZoomAction(keyboardInput({ isComposing: true }), 'darwin')).toBeNull()
  })

  it('reports the actual Electron zoom factor as a rounded percentage', () => {
    expect(pageZoomPercentage(1)).toBe(100)
    expect(pageZoomPercentage(0.8998)).toBe(90)
    expect(pageZoomPercentage(1.249)).toBe(125)
    expect(pageZoomPercentage(Number.NaN)).toBeNull()
  })

  it('moves keyboard zoom through the same adjacent presets as Settings', () => {
    expect(APPEARANCE_ZOOM_OPTIONS).toEqual([
      25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500
    ])
    for (let index = 1; index < APPEARANCE_ZOOM_OPTIONS.length; index++) {
      const previous = APPEARANCE_ZOOM_OPTIONS[index - 1]
      const current = APPEARANCE_ZOOM_OPTIONS[index]
      expect(nextPageZoomPercentage(pageZoomFactor(previous), 'in')).toBe(current)
      expect(nextPageZoomPercentage(pageZoomFactor(current), 'out')).toBe(previous)
    }
  })

  it('uses Chrome fractional factors behind the rounded percentage labels', () => {
    expect(pageZoomFactor(33)).toBe(1 / 3)
    expect(pageZoomFactor(67)).toBe(2 / 3)
    expect(pageZoomPercentage(pageZoomFactor(33))).toBe(33)
    expect(pageZoomPercentage(pageZoomFactor(67))).toBe(67)
    expect(pageZoomFactor(121)).toBe(1.21)
  })

  it('moves existing nonpreset zoom to the next preset in the requested direction', () => {
    expect(nextPageZoomPercentage(0.91, 'in')).toBe(100)
    expect(nextPageZoomPercentage(0.91, 'out')).toBe(90)
    expect(nextPageZoomPercentage(1.21, 'in')).toBe(125)
    expect(nextPageZoomPercentage(1.21, 'out')).toBe(110)
    expect(nextPageZoomPercentage(1.15, 'out')).toBe(110)
    expect(nextPageZoomPercentage(1.4, 'reset')).toBe(100)
  })

  it('uses Chrome presets above and below the former common Settings range', () => {
    expect(nextPageZoomPercentage(0.8, 'out')).toBe(75)
    expect(nextPageZoomPercentage(0.7, 'in')).toBe(75)
    expect(nextPageZoomPercentage(0.5, 'in')).toBe(67)
    expect(nextPageZoomPercentage(0.75, 'in')).toBe(80)
    expect(nextPageZoomPercentage(2, 'in')).toBe(250)
    expect(nextPageZoomPercentage(2.1, 'out')).toBe(200)
    expect(nextPageZoomPercentage(2.5, 'out')).toBe(200)
    expect(nextPageZoomPercentage(2.5, 'in')).toBe(300)
    expect(nextPageZoomPercentage(3, 'in')).toBe(400)
    expect(nextPageZoomPercentage(4, 'in')).toBe(500)
    expect(nextPageZoomPercentage(2.05, 'out')).toBe(200)
  })

  it('stops at the Chrome preset limits and accepts existing values below the minimum', () => {
    expect(nextPageZoomPercentage(0.25, 'out')).toBe(25)
    expect(nextPageZoomPercentage(5, 'in')).toBe(500)
    expect(nextPageZoomPercentage(0.1, 'out')).toBe(10)
    expect(nextPageZoomPercentage(0.1, 'in')).toBe(25)
    expect(nextPageZoomPercentage(0.15, 'out')).toBe(15)
    expect(nextPageZoomPercentage(0.15, 'in')).toBe(25)
    expect(nextPageZoomPercentage(4.95, 'in')).toBe(500)
    expect(nextPageZoomPercentage(Number.NaN, 'in')).toBeNull()
  })
})
