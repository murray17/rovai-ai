import type { Menu, MenuItem } from 'electron'
import { describe, expect, it } from 'vitest'

import {
  parseWindowsApplicationMenuPopupRequest,
  prepareWindowsApplicationMenu,
  windowsApplicationSubmenu
} from './windows-application-menu'

describe('Windows application menu projection', () => {
  it('accepts only bounded-shape menu popup requests', () => {
    expect(parseWindowsApplicationMenuPopupRequest({
      section: 'edit',
      x: 43.6,
      y: 31.2,
      sourceType: 'keyboard'
    })).toEqual({
      section: 'edit',
      x: 44,
      y: 31,
      sourceType: 'keyboard'
    })

    expect(parseWindowsApplicationMenuPopupRequest({
      section: 'rovai',
      x: 0,
      y: 0,
      sourceType: 'mouse'
    })).toBeNull()
    expect(parseWindowsApplicationMenuPopupRequest({
      section: 'file',
      x: Number.POSITIVE_INFINITY,
      y: 0,
      sourceType: 'mouse'
    })).toBeNull()
  })

  it('resolves the existing native submenu by role without rebuilding its commands', () => {
    const fileSubmenu = {} as Menu
    const localizedFileItem = {
      label: '文件',
      role: 'fileMenu',
      submenu: fileSubmenu
    } as MenuItem
    const applicationMenu = { items: [localizedFileItem] } as Pick<Menu, 'items'>

    expect(windowsApplicationSubmenu(applicationMenu, 'file')).toBe(fileSubmenu)
    expect(windowsApplicationSubmenu(applicationMenu, 'edit')).toBeNull()
    expect(windowsApplicationSubmenu(null, 'file')).toBeNull()
  })

  it('falls back to Electron accelerator labels when a role is absent', () => {
    const windowSubmenu = {} as Menu
    const applicationMenu = {
      items: [{ label: '&Window', submenu: windowSubmenu } as MenuItem]
    } as Pick<Menu, 'items'>

    expect(windowsApplicationSubmenu(applicationMenu, 'window')).toBe(windowSubmenu)
  })

  it('removes native top-level mnemonics before hiding the system menu bar', () => {
    const file = { label: '&File', role: 'fileMenu', submenu: {} as Menu } as MenuItem
    const edit = { label: '&Edit', role: 'editMenu', submenu: {} as Menu } as MenuItem
    const ordinaryCommand = { label: 'R&D', role: 'copy' } as MenuItem
    const applicationMenu = { items: [file, edit, ordinaryCommand] } as Pick<Menu, 'items'>

    prepareWindowsApplicationMenu(applicationMenu)

    expect(file.label).toBe('File')
    expect(edit.label).toBe('Edit')
    expect(ordinaryCommand.label).toBe('R&D')
  })
})
