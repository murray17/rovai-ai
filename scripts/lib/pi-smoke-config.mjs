import { access, chmod, copyFile, mkdir } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export async function prepareIsolatedPiAgentDir(fixtureRoot) {
  const source = resolve(
    process.env.ROVAI_PI_CONFIG_SOURCE ?? join(homedir(), '.pi', 'agent')
  )
  const destination = join(fixtureRoot, 'pi-agent')
  if (!isAbsolute(source) || !isAbsolute(destination)) {
    throw new Error('Pi smoke config isolation requires absolute paths')
  }
  await mkdir(destination, { recursive: true, mode: 0o700 })
  await chmod(destination, 0o700)
  for (const name of ['auth.json', 'settings.json', 'models.json']) {
    const sourceFile = join(source, name)
    try {
      await access(sourceFile, fsConstants.R_OK)
    } catch (error) {
      if (name === 'models.json') continue
      throw new Error(`Pi smoke requires readable official ${name}: ${error.message}`)
    }
    const destinationFile = join(destination, name)
    await copyFile(sourceFile, destinationFile)
    await chmod(destinationFile, 0o600)
  }
  return destination
}
