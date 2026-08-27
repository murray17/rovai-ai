import { createHash } from 'node:crypto'

export function isolatedSafeStorageApplicationName(
  applicationName: string,
  explicitUserDataDirectory: string
): string {
  const namespace = createHash('sha256')
    .update(explicitUserDataDirectory)
    .digest('hex')
    .slice(0, 12)
  return `${applicationName} Isolated ${namespace}`
}
