import { describe, expect, it } from 'vitest'
import {
  nextPageZoomPercentage,
  pageZoomAction,
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

  it('changes keyboard zoom by exactly ten percentage points', () => {
    expect(nextPageZoomPercentage(1, 'in')).toBe(110)
    expect(nextPageZoomPercentage(1, 'out')).toBe(90)
    expect(nextPageZoomPercentage(0.91, 'in')).toBe(101)
    expect(nextPageZoomPercentage(1.21, 'out')).toBe(111)
    expect(nextPageZoomPercentage(1.4, 'reset')).toBe(100)
  })

  it('keeps custom keyboard zoom within safe valid bounds', () => {
    expect(nextPageZoomPercentage(0.1, 'out')).toBe(10)
    expect(nextPageZoomPercentage(5, 'in')).toBe(500)
    expect(nextPageZoomPercentage(Number.NaN, 'in')).toBeNull()
  })
})
