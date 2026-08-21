import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { rcedit } from 'rcedit'

export const WINDOWS_APPLICATION_MANIFEST = resolve(
  import.meta.dirname,
  '..',
  '..',
  'build',
  'windows',
  'rovai.exe.manifest'
)

export function windowsResourceVersion(version) {
  const components = String(version).split('.')
  if (components.length > 4 || components.some((value) => !/^\d+$/.test(value))) {
    throw new Error(`Windows resource version must be numeric: ${version}`)
  }
  return [...components, ...Array(4 - components.length).fill('0')].join('.')
}

export async function stampWindowsExecutable(executable, {
  version,
  description,
  originalFilename,
  iconPath
}) {
  await access(executable)
  await access(WINDOWS_APPLICATION_MANIFEST)
  if (iconPath) await access(iconPath)
  const resourceVersion = windowsResourceVersion(version)
  await rcedit(executable, {
    'application-manifest': WINDOWS_APPLICATION_MANIFEST,
    'file-version': resourceVersion,
    'product-version': resourceVersion,
    'version-string': {
      CompanyName: 'Rovai AI',
      FileDescription: description,
      InternalFilename: originalFilename.replace(/\.exe$/i, ''),
      OriginalFilename: originalFilename,
      ProductName: 'Rovai AI'
    },
    ...(iconPath ? { icon: iconPath } : {})
  })
}
