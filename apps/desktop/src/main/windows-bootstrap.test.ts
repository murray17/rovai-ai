import { describe, expect, it, vi } from 'vitest'
import { assessWindowsDesktopBootstrap, windowsBootstrapInstanceKey } from './windows-bootstrap'
import {
  expectedWindowsDataRootLayout,
  prepareWindowsBootstrapRoot,
  prepareWindowsDataRoot,
  resolveWindowsDataRoot
} from './windows-data-root'

const key = windowsBootstrapInstanceKey(null)
const { core: _core, ...shell } = expectedWindowsDataRootLayout(`C:\\Users\\测试\\AppData\\Local\\Rovai AI Bootstrap\\${key}`)
const formal = expectedWindowsDataRootLayout('D:\\Rovai fixture')

function appFixture(primary = true) {
  const paths = new Map<string, string>()
  return {
    paths,
    setPath: vi.fn((name: string, value: string) => { paths.set(name, value) }),
    setAppLogsPath: vi.fn((value: string) => { paths.set('logs', value) }),
    requestSingleInstanceLock: vi.fn(() => {
      expect(paths.get('userData')).toBe(shell.electronUserData)
      return primary
    })
  }
}

describe('Windows pre-ready Bootstrap composition', () => {
  it('locks the stable private shell profile before preparing and binding the formal root', () => {
    const electronApp = appFixture()
    const prepareAuthority = vi.fn(() => {
      expect(electronApp.requestSingleInstanceLock).toHaveBeenCalledOnce()
      return formal
    })
    expect(assessWindowsDesktopBootstrap({ electronApp, prepareShell: () => shell, prepareAuthority }))
      .toEqual({ kind: 'ready', layout: formal })
    expect(electronApp.paths.get('userData')).toBe(formal.electronUserData)
    expect(electronApp.paths.get('sessionData')).toBe(formal.electronSessionData)
  })

  it.each(['missing-localappdata', 'missing-core', 'acl', 'timeout', 'malformed'])(
    'keeps a bound shell and a retryable assessment for %s without an authority path', (fault) => {
      const electronApp = appFixture()
      const assessment = assessWindowsDesktopBootstrap({
        electronApp,
        prepareShell: () => shell,
        prepareAuthority: () => {
          if (fault === 'missing-localappdata') resolveWindowsDataRoot(null, undefined)
          if (fault === 'missing-core') throw new Error('Core binary was not found')
          return prepareWindowsDataRoot('C:\\bin\\rovai-core.exe', formal.root, () => ({
            status: fault === 'malformed' ? 0 : null,
            signal: null,
            stdout: fault === 'malformed' ? 'invalid JSON' : '',
            stderr: fault === 'acl' ? 'windows_storage.private_acl_invalid' : '',
            error: fault === 'timeout' ? new Error('ETIMEDOUT') : undefined
          }))
        }
      })
      expect(assessment).toMatchObject({ kind: 'blocked', error: {
        code: 'windows_data_root_preparation_failed', retryable: true
      } })
      expect(assessment).not.toHaveProperty('layout')
      expect(electronApp.paths.get('userData')).toBe(shell.electronUserData)
      expect(electronApp.paths.get('sessionData')).toBe(shell.electronSessionData)
      expect(electronApp.paths.get('logs')).toBe(shell.logs)
      expect(electronApp.paths.get('crashDumps')).toBe(shell.crashDumps)
    }
  )

  it('does not resolve the Core binary or prepare the shared formal root in a secondary instance', () => {
    const prepareAuthority = vi.fn(() => formal)
    expect(assessWindowsDesktopBootstrap({ electronApp: appFixture(false), prepareShell: () => shell, prepareAuthority }))
      .toEqual({ kind: 'secondary' })
    expect(prepareAuthority).not.toHaveBeenCalled()
  })

  it('restores every shell path if formal Electron path binding throws halfway', () => {
    const electronApp = appFixture()
    const setPath = electronApp.setPath.getMockImplementation()!
    electronApp.setPath.mockImplementation((name, value) => {
      if (value === formal.electronSessionData) throw new Error('session path unavailable')
      setPath(name, value)
    })
    expect(assessWindowsDesktopBootstrap({ electronApp, prepareShell: () => shell, prepareAuthority: () => formal }).kind)
      .toBe('blocked')
    expect(electronApp.paths.get('userData')).toBe(shell.electronUserData)
    expect(electronApp.paths.get('sessionData')).toBe(shell.electronSessionData)
  })

  it('does not substitute unsafe storage if even the independent private shell cannot be admitted', () => {
    const prepareAuthority = vi.fn(() => formal)
    const electronApp = appFixture()
    expect(assessWindowsDesktopBootstrap({ electronApp, prepareShell: () => { throw new Error('no private storage') }, prepareAuthority }).kind)
      .toBe('shell_storage_unavailable')
    expect(electronApp.requestSingleInstanceLock).not.toHaveBeenCalled()
    expect(prepareAuthority).not.toHaveBeenCalled()
  })

  it('accepts only a closed Core-free native bootstrap layout for the requested stable instance', () => {
    const prepare = vi.fn(() => ({ status: 0, signal: null, stdout: JSON.stringify(shell), stderr: '' }))
    expect(prepareWindowsBootstrapRoot('C:\\bin\\rovai.exe', key, prepare)).toEqual(shell)
    expect(prepare).toHaveBeenCalledWith('C:\\bin\\rovai.exe', ['--prepare-windows-bootstrap-root', key])
    prepare.mockReturnValueOnce({ status: 0, signal: null, stdout: JSON.stringify({ ...shell, core: formal.core }), stderr: '' })
    expect(() => prepareWindowsBootstrapRoot('C:\\bin\\rovai.exe', key, prepare)).toThrow('unknown layout shape')
    expect(windowsBootstrapInstanceKey('D:/Rovai fixture')).toBe(windowsBootstrapInstanceKey('d:\\rovai fixture'))
    expect(windowsBootstrapInstanceKey('D:/Rovai fixture')).not.toBe(key)
  })
})
