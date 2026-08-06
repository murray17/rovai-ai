const { execFileSync } = require('node:child_process')
const { chmodSync } = require('node:fs')
const { join } = require('node:path')

module.exports = async function afterPack(context) {
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
