import type { BrowserWindowConstructorOptions } from 'electron'

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  'frame' | 'titleBarStyle' | 'trafficLightPosition'
>

const MACOS_TRAFFIC_LIGHT_POSITION = { x: 12, y: 14 } as const

export function windowChromeOptions(platform: NodeJS.Platform): WindowChromeOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hidden',
      trafficLightPosition: MACOS_TRAFFIC_LIGHT_POSITION
    }
  }
  return { frame: true }
}
