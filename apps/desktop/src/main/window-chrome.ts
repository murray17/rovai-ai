import type { ResolvedTheme } from '@contracts'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  'autoHideMenuBar' | 'frame' | 'titleBarOverlay' | 'titleBarStyle' | 'trafficLightPosition'
>
type TitleBarOverlayOptions = Exclude<
  BrowserWindowConstructorOptions['titleBarOverlay'],
  boolean | undefined
>

const MACOS_TRAFFIC_LIGHT_POSITION = { x: 12, y: 14 } as const
const WINDOWS_TITLE_BAR_OVERLAYS: Record<ResolvedTheme, TitleBarOverlayOptions> = {
  day: {
    color: '#f3f4f4',
    symbolColor: '#171b20'
  },
  night: {
    color: '#11161a',
    symbolColor: '#e7ecef'
  }
}

export function windowsTitleBarOverlay(theme: ResolvedTheme): TitleBarOverlayOptions {
  return { ...WINDOWS_TITLE_BAR_OVERLAYS[theme] }
}

export function windowChromeOptions(
  platform: NodeJS.Platform,
  theme: ResolvedTheme
): WindowChromeOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hidden',
      trafficLightPosition: MACOS_TRAFFIC_LIGHT_POSITION
    }
  }
  if (platform === 'win32') {
    return {
      autoHideMenuBar: false,
      frame: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: windowsTitleBarOverlay(theme)
    }
  }
  return { frame: true }
}

export function applyWindowChromeAppearance(
  window: Pick<BrowserWindow, 'setTitleBarOverlay'>,
  platform: NodeJS.Platform,
  theme: ResolvedTheme
): void {
  if (platform === 'win32') window.setTitleBarOverlay(windowsTitleBarOverlay(theme))
}
