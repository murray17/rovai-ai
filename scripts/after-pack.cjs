const { execFileSync } = require('node:child_process')
const { chmodSync } = require('node:fs')
const { join } = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') {
    const { stampWindowsExecutable } = await import('./lib/windows-pe-resources.mjs')
    const appFilename = `${context.packager.appInfo.productFilename}.exe`
    const bundledBin = join(context.appOutDir, 'resources', 'bin')
    const iconPath = await context.packager.getIconPath()
    const version = context.packager.appInfo.version
    await stampWindowsExecutable(join(context.appOutDir, appFilename), {
      version,
      description: 'Rovai AI Desktop',
      originalFilename: appFilename,
      iconPath
    })
    await stampWindowsExecutable(join(bundledBin, 'rovai-core.exe'), {
      version,
      description: 'Rovai AI Core',
      originalFilename: 'rovai-core.exe',
      iconPath
    })
    await stampWindowsExecutable(join(bundledBin, 'rovai.exe'), {
      version,
      description: 'Rovai AI CLI',
      originalFilename: 'rovai.exe',
      iconPath
    })
    return
  }
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const infoPlist = join(context.appOutDir, appName, 'Contents', 'Info.plist')
  const bundledBin = join(context.appOutDir, appName, 'Contents', 'Resources', 'bin')
  chmodSync(join(bundledBin, 'rovai-core'), 0o755)
  chmodSync(join(bundledBin, 'rovai'), 0o755)
  execFileSync('/usr/libexec/PlistBuddy', [
    '-c',
    'Set :NSAppTransportSecurity:NSAllowsArbitraryLoads false',
    infoPlist
  ])
}
