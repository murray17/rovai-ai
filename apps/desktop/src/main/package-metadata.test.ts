import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageMetadata = JSON.parse(readFileSync(
  new URL('../../../../package.json', import.meta.url),
  'utf8'
))

describe('macOS package metadata', () => {
  it('keeps the visible brand separate from Electron helper bundle identity', () => {
    expect(packageMetadata.productName).toBe('Rovai-ai')
    expect(packageMetadata.build.mac.extendInfo.CFBundleDisplayName).toBe('Rovai AI')
    expect(packageMetadata.build.mac.extendInfo.CFBundleName).toBeUndefined()
  })

  it('does not build or package a native open-panel prewarmer', () => {
    expect(packageMetadata.scripts).not.toHaveProperty('native:build:macos')
    expect(packageMetadata.scripts.dev).not.toContain('native:build:macos')
    expect(packageMetadata.scripts['build:desktop']).not.toContain('native:build:macos')
    expect(packageMetadata.build.extraResources.map(({ to }: { to: string }) => to)).toEqual([
      'bin/rovai-core',
      'bin/rovai'
    ])
  })
})
