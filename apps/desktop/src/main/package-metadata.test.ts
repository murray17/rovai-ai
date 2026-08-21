import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageMetadata = JSON.parse(readFileSync(
  new URL('../../../../package.json', import.meta.url),
  'utf8'
))

describe('desktop package metadata', () => {
  it('keeps the visible brand separate from Electron helper bundle identity', () => {
    expect(packageMetadata.productName).toBe('Rovai-ai')
    expect(packageMetadata.build.mac.extendInfo.CFBundleDisplayName).toBe('Rovai AI')
    expect(packageMetadata.build.mac.extendInfo.CFBundleName).toBeUndefined()
  })

  it('does not build or package a native open-panel prewarmer', () => {
    expect(packageMetadata.scripts).not.toHaveProperty('native:build:macos')
    expect(packageMetadata.scripts.dev).not.toContain('native:build:macos')
    expect(packageMetadata.scripts['build:desktop']).not.toContain('native:build:macos')
    expect(packageMetadata.build.mac.extraResources.map(({ to }: { to: string }) => to)).toEqual([
      'legal',
      'bin/rovai-core',
      'bin/rovai'
    ])
  })

  it('packages deterministic legal files and sidecars staged for the selected target', () => {
    expect(packageMetadata.build.mac.extraResources).toEqual([
      {
        from: '.legal-payload',
        to: 'legal'
      },
      {
        from: 'resources/bin/macos-${arch}/rovai-core',
        to: 'bin/rovai-core'
      },
      {
        from: 'resources/bin/macos-${arch}/rovai',
        to: 'bin/rovai'
      }
    ])
    expect(packageMetadata.build.win.extraResources).toEqual([
      {
        from: 'resources/bin/windows-x64/rovai-core.exe',
        to: 'bin/rovai-core.exe'
      },
      {
        from: 'resources/bin/windows-x64/rovai.exe',
        to: 'bin/rovai.exe'
      }
    ])
    expect(packageMetadata.build).not.toHaveProperty('extraResources')
    expect(packageMetadata.scripts['package:mac:unsigned']).toContain('pnpm legal:prepare')
    expect(packageMetadata.scripts['package:mac:unsigned']).toContain('--integrity-only')
    expect(packageMetadata.scripts['dist:mac:release:arm64']).toContain(
      'pnpm legal:check:binary'
    )
    expect(packageMetadata.scripts['dist:mac:release:arm64']).toContain(
      'pnpm build:macos:arm64'
    )
    expect(packageMetadata.scripts['dist:mac:release:x64']).toContain(
      'pnpm build:macos:x64'
    )
  })
})
