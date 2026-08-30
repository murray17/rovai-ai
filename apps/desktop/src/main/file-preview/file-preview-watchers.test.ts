import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { RootWatchRegistry } from './file-preview-watchers'

class FakeWatcher extends EventEmitter {
  close = vi.fn()
}

describe('RootWatchRegistry', () => {
  it('reuses one watcher per root and closes it after the final subscription', () => {
    const watchers: FakeWatcher[] = []
    const registry = new RootWatchRegistry({
      notify: vi.fn(),
      watchFactory: () => {
        const watcher = new FakeWatcher()
        watchers.push(watcher)
        return watcher as never
      }
    })
    registry.subscribe('/project', {
      handleId: 'one', webContentsId: 1, campId: 'camp', previewKey: 'a', canonicalFilePath: '/project/a.ts'
    })
    registry.subscribe('/project', {
      handleId: 'two', webContentsId: 1, campId: 'camp', previewKey: 'b', canonicalFilePath: '/project/src/b.ts'
    })
    expect(watchers).toHaveLength(1)
    expect(registry.rootCount).toBe(1)
    registry.unsubscribe('one')
    expect(watchers[0].close).not.toHaveBeenCalled()
    registry.unsubscribe('two')
    expect(watchers[0].close).toHaveBeenCalledOnce()
    expect(registry.rootCount).toBe(0)
  })

  it('matches exact files and directory events without reading the filesystem', async () => {
    vi.useFakeTimers()
    const notify = vi.fn()
    let listener: ((eventType: string, filename: string | Buffer | null) => void) | null = null
    const registry = new RootWatchRegistry({
      notify,
      watchFactory: (_root, nextListener) => {
        listener = nextListener
        return new FakeWatcher() as never
      }
    })
    registry.subscribe('/project', {
      handleId: 'one', webContentsId: 2, campId: 'camp', previewKey: 'a', canonicalFilePath: '/project/a.ts'
    })
    registry.subscribe('/project', {
      handleId: 'two', webContentsId: 2, campId: 'camp', previewKey: 'b', canonicalFilePath: '/project/src/b.ts'
    })
    expect(listener).not.toBeNull()
    const emit = listener as unknown as (eventType: string, filename: string | Buffer | null) => void
    emit('change', 'src')
    await vi.advanceTimersByTimeAsync(60)
    expect(notify).toHaveBeenCalledWith({ webContentsId: 2, campId: 'camp', previewKeys: ['b'] })
    emit('rename', null)
    await vi.advanceTimersByTimeAsync(60)
    expect(notify).toHaveBeenLastCalledWith({ webContentsId: 2, campId: 'camp', previewKeys: ['a', 'b'] })
    registry.closeAll()
    vi.useRealTimers()
  })
})
