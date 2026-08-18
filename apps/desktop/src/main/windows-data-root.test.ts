import { describe, expect, it, vi } from 'vitest'

import {
  bindWindowsDataRootBeforeReady,
  expectedWindowsDataRootLayout,
  parseWindowsDataRootLayout,
  prepareWindowsDataRoot,
  resolveWindowsDataRoot
} from './windows-data-root'

describe('Windows data-root startup', () => {
  it('uses LOCALAPPDATA for daily state and the exact explicit acceptance root', () => {
    expect(resolveWindowsDataRoot(null, 'C:\\Users\\慕雪\\AppData\\Local')).toBe(
      'C:\\Users\\慕雪\\AppData\\Local\\Rovai AI'
    )
    expect(resolveWindowsDataRoot('D:/Rovai fixtures/case 01', undefined)).toBe(
      'D:\\Rovai fixtures\\case 01'
    )
  })

  it('rejects UNC, traversal, relative, and volume-root storage', () => {
    expect(() => resolveWindowsDataRoot('\\\\server\\share\\rovai', undefined)).toThrow(
      'windows_storage.not_local'
    )
    expect(() => resolveWindowsDataRoot('C:\\fixtures\\..\\daily', undefined)).toThrow(
      'must be normalized'
    )
    expect(() => resolveWindowsDataRoot('relative\\root', undefined)).toThrow(
      'windows_storage.not_local'
    )
    expect(() => resolveWindowsDataRoot('C:\\', undefined)).toThrow(
      'windows_storage.path_outside_tested_envelope'
    )
  })

  it('accepts only the exact closed layout returned by the native preparer', () => {
    const root = 'C:\\Users\\Murray\\AppData\\Local\\Rovai AI'
    const layout = expectedWindowsDataRootLayout(root)
    expect(parseWindowsDataRootLayout(root, `${JSON.stringify(layout)}\r\n`)).toEqual(layout)

    expect(() => parseWindowsDataRootLayout(root, JSON.stringify({
      ...layout,
      core: 'C:\\other'
    }))).toThrow('unexpected core path')
    expect(() => parseWindowsDataRootLayout(root, JSON.stringify({
      ...layout,
      unknown: true
    }))).toThrow('unknown layout shape')
  })

  it('invokes the native sidecar once before returning paths', () => {
    const root = 'C:\\Users\\Murray\\AppData\\Local\\Rovai AI'
    const layout = expectedWindowsDataRootLayout(root)
    const prepare = vi.fn(() => ({
      status: 0,
      signal: null,
      stdout: `${JSON.stringify(layout)}\n`,
      stderr: ''
    }))

    expect(prepareWindowsDataRoot('C:\\Program Files\\Rovai AI\\rovai-core.exe', root, prepare))
      .toEqual(layout)
    expect(prepare).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledWith(
      'C:\\Program Files\\Rovai AI\\rovai-core.exe',
      ['--prepare-windows-data-root', root]
    )
  })

  it('binds every Electron-owned path without reusing Core storage', () => {
    const layout = expectedWindowsDataRootLayout('C:\\Rovai AI')
    const electronApp = {
      setPath: vi.fn(),
      setAppLogsPath: vi.fn()
    }
    bindWindowsDataRootBeforeReady(electronApp, layout)

    expect(electronApp.setPath.mock.calls).toEqual([
      ['userData', layout.electronUserData],
      ['sessionData', layout.electronSessionData],
      ['crashDumps', layout.crashDumps]
    ])
    expect(electronApp.setAppLogsPath).toHaveBeenCalledWith(layout.logs)
    expect(electronApp.setPath).not.toHaveBeenCalledWith(expect.anything(), layout.core)
  })

  it('fails closed when native preparation fails', () => {
    expect(() => prepareWindowsDataRoot('C:\\rovai-core.exe', 'C:\\Rovai', () => ({
      status: 1,
      signal: null,
      stdout: '',
      stderr: 'windows_storage.not_ntfs: expected NTFS'
    }))).toThrow('windows_storage.not_ntfs')
  })
})
