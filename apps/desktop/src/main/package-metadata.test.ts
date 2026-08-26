import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageMetadata = JSON.parse(readFileSync(
  new URL('../../../../package.json', import.meta.url),
  'utf8'
))

describe('desktop package metadata', () => {
  it('keeps the visible brand separate from Electron helper bundle identity', () => {
    expect(packageMetadata.productName).toBe('Rovai AI')
    expect(packageMetadata.version).toBe('0.0.3')
    expect(packageMetadata.build.productName).toBe('Rovai AI')
    expect(packageMetadata.build.mac.executableName).toBeUndefined()
    expect(packageMetadata.build.win.executableName).toBe('Rovai-ai')
    expect(packageMetadata.build.mac.artifactName).toBe('Rovai-AI-${version}-${arch}.${ext}')
    expect(packageMetadata.build.win.artifactName).toBe('Rovai-AI-${version}-${arch}.${ext}')
    expect(packageMetadata.build.mac.extendInfo.CFBundleDisplayName).toBe('Rovai AI')
    expect(packageMetadata.build.mac.extendInfo.CFBundleName).toBeUndefined()
  })

  it('packages GitHub update metadata and a macOS zip beside the install DMG', () => {
    expect(packageMetadata.build.publish).toEqual([{
      provider: 'github',
      owner: 'murray17',
      repo: 'rovai-ai',
      releaseType: 'release'
    }])
    expect(packageMetadata.build.mac.target).toEqual(['dir', 'dmg', 'zip'])
    expect(packageMetadata.scripts['dist:mac:release:arm64']).toContain('--mac dmg zip')
    expect(packageMetadata.scripts['dist:mac:release:x64']).toContain('--mac dmg zip')
  })

  it('uses the fixed release identity for daily installation artifacts', () => {
    const stableSigning = [
      packageMetadata.scripts['package:mac:daily'],
      packageMetadata.scripts['dist:mac:release:arm64'],
      packageMetadata.scripts['dist:mac:release:x64']
    ]
    for (const command of stableSigning) {
      expect(command).toContain('-c.mac.identity="Rovai Release Signing"')
      expect(command).toContain('-c.forceCodeSigning=true')
      expect(command).not.toContain('identity=-')
    }
    expect(packageMetadata.scripts['package:mac:daily']).toContain(
      'scripts/verify-macos-app.mjs arm64'
    )
    expect(packageMetadata.scripts['install:mac:daily']).toContain(
      'scripts/install-macos-daily.mjs'
    )
    expect(packageMetadata.scripts['package:mac:unsigned']).toContain('identity=-')
    expect(packageMetadata.scripts['package:mac']).toContain('identity=-')
  })

  it('does not build or package a native open-panel prewarmer', () => {
    expect(packageMetadata.scripts).not.toHaveProperty('native:build:macos')
    expect(packageMetadata.scripts.dev).not.toContain('native:build:macos')
    expect(packageMetadata.scripts['build:desktop']).not.toContain('native:build:macos')
    expect(packageMetadata.build.mac.extraResources.map(({ to }: { to: string }) => to)).toEqual([
      'bin/rovai-core',
      'bin/rovai'
    ])
  })

  it('packages sidecars staged for the selected target without a legal preparation pipeline', () => {
    expect(packageMetadata.build.mac.extraResources).toEqual([
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
    expect(Object.keys(packageMetadata.scripts).some((name) => name.startsWith('legal:'))).toBe(false)
    expect(packageMetadata.scripts.test).not.toContain('legal:')
    expect(packageMetadata.scripts['package:mac:unsigned']).not.toContain('legal:')
    expect(packageMetadata.scripts['package:mac']).not.toContain('legal:')
    expect(packageMetadata.scripts['dist:mac']).not.toContain('legal:')
    expect(packageMetadata.scripts['dist:mac:release:arm64']).toContain(
      'pnpm build:macos:arm64'
    )
    expect(packageMetadata.scripts['dist:mac:release:arm64']).not.toContain('legal:')
    expect(packageMetadata.scripts['dist:mac:release:x64']).toContain(
      'pnpm build:macos:x64'
    )
    expect(packageMetadata.scripts['dist:mac:release:x64']).not.toContain('legal:')
    expect(packageMetadata.scripts['package:windows:x64']).toContain('pnpm build:windows:x64')
    expect(packageMetadata.scripts['dist:windows:x64']).toContain('scripts/package-windows.mjs nsis')
    expect(packageMetadata.scripts['dist:windows:release:x64']).toContain('--require-signed')
    expect(packageMetadata.scripts['package:windows:x64']).not.toContain('legal:')
    expect(packageMetadata.scripts['dist:windows:x64']).not.toContain('legal:')
    expect(packageMetadata.scripts['dist:windows:release:x64']).not.toContain('legal:')
  })
})
