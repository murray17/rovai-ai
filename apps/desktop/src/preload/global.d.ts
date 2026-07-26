import type { RovaiApi } from '@contracts'

declare global {
  interface Window {
    rovai: RovaiApi
  }
}

export {}
