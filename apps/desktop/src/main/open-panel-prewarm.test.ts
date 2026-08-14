import { describe, expect, it, vi } from 'vitest'
import {
  prewarmMacOpenPanel,
  resolveOpenPanelPrewarmerPath
} from './open-panel-prewarm'

const baseOptions = {
  platform: 'darwin' as const,
  isPackaged: false,
  resourcesPath: '/Applications/Rovai AI.app/Contents/Resources',
  appPath: '/workspace/rovai-ai'
}

describe('open-panel prewarming', () => {
  it('resolves development and packaged addon paths', () => {
    expect(resolveOpenPanelPrewarmerPath(baseOptions)).toBe(
      '/workspace/rovai-ai/resources/native/open-panel-prewarm.node'
    )
    expect(resolveOpenPanelPrewarmerPath({ ...baseOptions, isPackaged: true })).toBe(
      '/Applications/Rovai AI.app/Contents/Resources/native/open-panel-prewarm.node'
    )
  })

  it('skips other platforms without loading the addon', () => {
    const load = vi.fn()
    expect(prewarmMacOpenPanel({ ...baseOptions, platform: 'linux', load })).toEqual({
      status: 'skipped'
    })
    expect(load).not.toHaveBeenCalled()
  })

  it('loads and invokes the addon on macOS', () => {
    const prewarm = vi.fn(() => 312.5)
    const result = prewarmMacOpenPanel({
      ...baseOptions,
      load: () => ({ prewarm })
    })
    expect(result.status).toBe('warmed')
    expect(prewarm).toHaveBeenCalledOnce()
    if (result.status === 'warmed') {
      expect(result.nativeElapsedMs).toBe(312.5)
      expect(result.addonPath).toBe('/workspace/rovai-ai/resources/native/open-panel-prewarm.node')
    }
  })

  it('fails open when the addon cannot be loaded', () => {
    const error = new Error('missing addon')
    const result = prewarmMacOpenPanel({
      ...baseOptions,
      load: () => { throw error }
    })
    expect(result).toMatchObject({ status: 'failed', error })
  })
})
