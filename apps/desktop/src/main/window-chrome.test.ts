import { describe, expect, it } from 'vitest'

import { windowChromeOptions } from './window-chrome'

describe('window chrome', () => {
  it('preserves the existing hidden macOS title bar and traffic lights', () => {
    expect(windowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 14 }
    })
  })

  it('uses the native Windows frame without custom title-bar options', () => {
    const options = windowChromeOptions('win32')
    expect(options).toEqual({ frame: true })
    expect(options).not.toHaveProperty('titleBarStyle')
    expect(options).not.toHaveProperty('trafficLightPosition')
  })
})
