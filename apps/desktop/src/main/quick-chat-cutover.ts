import { lstat, realpath, rm, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

const RETIRED_MANAGED_DIRECTORY_NAME = 'lobby'

export async function deleteRetiredManagedDirectory(userDataPath: string): Promise<void> {
  const authoritativeUserDataPath = resolve(userDataPath)
  const retiredPath = join(authoritativeUserDataPath, RETIRED_MANAGED_DIRECTORY_NAME)

  if (
    dirname(retiredPath) !== authoritativeUserDataPath
    || basename(retiredPath) !== RETIRED_MANAGED_DIRECTORY_NAME
  ) {
    throw new Error('Quick Chat cutover refused an unsafe retired-directory target')
  }

  let metadata
  try {
    metadata = await lstat(retiredPath)
  } catch (error) {
    if (isMissingPathError(error)) return
    throw error
  }

  if (metadata.isSymbolicLink()) {
    await unlink(retiredPath)
    return
  }

  const canonicalUserDataPath = await realpath(authoritativeUserDataPath)
  const canonicalRetiredPath = await realpath(retiredPath)
  if (
    dirname(canonicalRetiredPath) !== canonicalUserDataPath
    || basename(canonicalRetiredPath) !== RETIRED_MANAGED_DIRECTORY_NAME
  ) {
    throw new Error('Quick Chat cutover refused a retired directory outside userData')
  }

  await rm(retiredPath, { recursive: true, force: false })
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
