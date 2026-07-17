import type { LumenApi } from '@contracts'

declare global {
  interface Window {
    lumen: LumenApi
  }
}

export {}

