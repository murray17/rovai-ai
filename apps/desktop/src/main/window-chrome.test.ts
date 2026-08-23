import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import {
  applyWindowChromeAppearance,
  windowChromeOptions,
  windowsTitleBarOverlay
} from './window-chrome'

const rendererStyles = readFileSync(new URL('../renderer/src/styles.css', import.meta.url), 'utf8')

function themeToken(selector: string, token: string): string {
  const start = rendererStyles.indexOf(`${selector} {`)
  const end = rendererStyles.indexOf('\n}', start)
  const block = start >= 0 && end > start ? rendererStyles.slice(start, end) : ''
  const value = block.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1]?.trim()
  if (!value) throw new Error(`Missing ${token} in ${selector}`)
  return value
}

describe('window chrome', () => {
  it('preserves the existing hidden macOS title bar and traffic lights', () => {
    expect(windowChromeOptions('darwin', 'night')).toEqual({
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 14 }
    })
  })

  it('hides the Windows title strip while preserving native controls', () => {
    const options = windowChromeOptions('win32', 'day')
    expect(options).toEqual({
      autoHideMenuBar: false,
      frame: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#f3f4f4',
        symbolColor: '#171b20'
      }
    })
    expect(options).not.toHaveProperty('trafficLightPosition')
    expect(options.titleBarOverlay).not.toHaveProperty('height')
  })

  it('keeps the Windows title-bar overlay in sync with the resolved theme', () => {
    expect(windowsTitleBarOverlay('day')).toEqual({
      color: themeToken(':root', '--rail'),
      symbolColor: themeToken(':root', '--ink')
    })
    expect(windowsTitleBarOverlay('night')).toEqual({
      color: themeToken(':root[data-theme="night"]', '--rail'),
      symbolColor: themeToken(':root[data-theme="night"]', '--ink')
    })

    const setTitleBarOverlay = vi.fn()
    applyWindowChromeAppearance({ setTitleBarOverlay }, 'win32', 'night')
    expect(setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#11161a',
      symbolColor: '#e7ecef'
    })

    setTitleBarOverlay.mockClear()
    applyWindowChromeAppearance({ setTitleBarOverlay }, 'darwin', 'day')
    expect(setTitleBarOverlay).not.toHaveBeenCalled()
  })

  it('leaves other desktop platforms on their native frame', () => {
    expect(windowChromeOptions('linux', 'day')).toEqual({ frame: true })
  })
})
