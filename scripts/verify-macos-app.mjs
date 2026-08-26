import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyMacosApp } from './lib/macos-app-verification.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const arch = process.argv[2]
const appPath = resolve(process.argv[3] ?? (
  arch === 'x64'
    ? `${root}/dist/mac/Rovai AI.app`
    : `${root}/dist/mac-arm64/Rovai AI.app`
))

if (arch !== 'arm64' && arch !== 'x64') {
  console.error('Usage: node scripts/verify-macos-app.mjs <arm64|x64> [app-path]')
  process.exit(2)
}

try {
  const result = verifyMacosApp(appPath, arch, { root })
  console.log(`Stable macOS ${result.architecture} App signature verified`)
  console.log(`App: ${result.appPath}`)
  console.log(`Authority: ${result.authority}`)
  console.log(`Certificate root: ${result.certificateRoot}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
