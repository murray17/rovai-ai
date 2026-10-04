import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { revealProjectDirectory } from './reveal-project-directory'

describe('native Project reveal', () => {
  it('reveals the exact Project root and rejects missing or non-directory paths', async () => {
    const root = resolve('/workspace/project')
    const reveal = vi.fn()
    await revealProjectDirectory(root, reveal, async () => ({ isDirectory: () => true }))
    expect(reveal).toHaveBeenCalledWith(root)
    reveal.mockClear()
    await expect(revealProjectDirectory(root, reveal, async () => ({ isDirectory: () => false }))).rejects.toThrow('重新选择')
    await expect(revealProjectDirectory(root, reveal, async () => { throw new Error('ENOENT') })).rejects.toThrow('重新选择')
    expect(reveal).not.toHaveBeenCalled()
  })

  it('rejects relative paths and invalid native inputs before inspecting or revealing', async () => {
    const reveal = vi.fn(), inspect = vi.fn()
    for (const path of [null, {}, 'relative/path', '', '/project\0']) {
      await expect(revealProjectDirectory(path, reveal, inspect)).rejects.toThrow('无效')
    }
    expect(inspect).not.toHaveBeenCalled()
    expect(reveal).not.toHaveBeenCalled()
  })
})
