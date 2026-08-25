import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { chmod, lstat, readFile, readdir, rm, rmdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'

const INSTANCE_KEY_DOMAIN = 'rovai-runtime-camp-files-instance-v1\0'

function instanceKey(canonicalDataDirectory) {
  return `v1-${createHash('sha256')
    .update(INSTANCE_KEY_DOMAIN, 'utf8')
    .update(canonicalDataDirectory, 'utf8')
    .digest('hex')}`
}

function canonicalPath(path, platform = process.platform) {
  const absolute = platform === 'win32' ? win32.resolve(path) : resolve(path)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

export function runtimeCampFilesRootForDataDirectory(
  dataDirectory,
  {
    platform = process.platform,
    homeDirectory = homedir()
  } = {}
) {
  const canonicalDataDirectory = canonicalPath(dataDirectory, platform)
  if (platform === 'win32') {
    return win32.join(canonicalDataDirectory, 'runtime-files')
  }
  const key = instanceKey(canonicalDataDirectory)
  return join(
    canonicalPath(homeDirectory, platform),
    '.rovai',
    'instances',
    key,
    'runtime-files'
  )
}

export function coreDataDirectoryArguments(dataDirectory, options = {}) {
  const canonicalDataDirectory = canonicalPath(dataDirectory)
  return [
    '--data-dir',
    canonicalDataDirectory,
    '--runtime-camp-files-root',
    runtimeCampFilesRootForDataDirectory(canonicalDataDirectory, options)
  ]
}

export async function removeEphemeralRuntimeCampFilesRoot(
  dataDirectory,
  {
    platform = process.platform,
    homeDirectory = homedir(),
    temporaryDirectory = tmpdir()
  } = {}
) {
  if (platform === 'win32') return false
  if (platform !== process.platform) {
    throw new Error('Runtime Files Root cleanup requires the current host platform')
  }

  const canonicalDataDirectory = canonicalPath(dataDirectory, platform)
  const canonicalTemporaryDirectory = canonicalPath(temporaryDirectory, platform)
  const relativeToTemporary = relative(canonicalTemporaryDirectory, canonicalDataDirectory)
  if (
    relativeToTemporary === ''
    || relativeToTemporary === '..'
    || relativeToTemporary.startsWith(`..${sep}`)
    || isAbsolute(relativeToTemporary)
  ) {
    throw new Error('Refusing to clean a Runtime Files Root for a non-temporary data directory')
  }

  const root = runtimeCampFilesRootForDataDirectory(canonicalDataDirectory, {
    platform,
    homeDirectory
  })
  const markerPath = join(root, '.runtime-camp-files-root.json')
  let marker
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  const expectedPlatform = platform === 'darwin' ? 'macos' : platform
  if (
    (marker?.schemaVersion !== 1 && marker?.schemaVersion !== 2)
    || marker.instanceKey !== instanceKey(canonicalDataDirectory)
    || marker.platform !== expectedPlatform
  ) {
    throw new Error('Refusing to clean a Runtime Files Root with a mismatched ownership marker')
  }

  await makeTreeRemovableWithoutFollowingLinks(root)
  await rm(root, { recursive: true, force: false })
  try {
    await rmdir(dirname(root))
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') throw error
  }
  return true
}

async function makeTreeRemovableWithoutFollowingLinks(path) {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink()) {
    throw new Error(`Refusing to clean a symlink in Runtime Files Root: ${path}`)
  }
  if (metadata.isDirectory()) {
    await chmod(path, 0o700)
    for (const name of await readdir(path)) {
      await makeTreeRemovableWithoutFollowingLinks(join(path, name))
    }
  } else if (!metadata.isFile()) {
    throw new Error(`Refusing to clean an unsupported Runtime Files Root node: ${path}`)
  }
}
