import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteRetiredManagedDirectory } from './quick-chat-cutover'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) =>
    import('node:fs/promises').then(({ rm }) => rm(path, { recursive: true, force: true }))
  ))
})

describe('Quick Chat incompatible cutover', () => {
  it('deletes only the exact retired managed directory', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'rovai-quick-chat-cutover-'))
    cleanup.push(userDataPath)
    await mkdir(join(userDataPath, 'lobby', 'nested'), { recursive: true })
    await writeFile(join(userDataPath, 'lobby', 'nested', 'discard.txt'), 'obsolete')
    await writeFile(join(userDataPath, 'keep.txt'), 'keep')

    await deleteRetiredManagedDirectory(userDataPath)

    await expect(readFile(join(userDataPath, 'lobby', 'nested', 'discard.txt'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(join(userDataPath, 'keep.txt'), 'utf8')).resolves.toBe('keep')
  })

  it('unlinks a retired symlink without following it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rovai-quick-chat-cutover-'))
    cleanup.push(root)
    const userDataPath = join(root, 'user-data')
    const outsidePath = join(root, 'outside')
    await mkdir(userDataPath)
    await mkdir(outsidePath)
    await writeFile(join(outsidePath, 'preserved.txt'), 'preserved')
    await symlink(outsidePath, join(userDataPath, 'lobby'))

    await deleteRetiredManagedDirectory(userDataPath)

    await expect(readFile(join(userDataPath, 'lobby'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(outsidePath, 'preserved.txt'), 'utf8')).resolves.toBe('preserved')
  })
})
