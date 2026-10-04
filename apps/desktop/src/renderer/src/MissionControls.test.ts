import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { GeneralPreferencesApi, InterfaceLanguage, MissionRecord, MissionStatus } from '@contracts'
import { missionCardVisibleAvatarCount, StatusMenu } from './MissionControls'
import { missionDate } from './MissionBoard'
import { changeInterfaceLanguage, translateUi } from './interface-language'
import { DEFAULT_GENERAL_PREFERENCES } from '../../shared/general-preferences-model'

const component = readFileSync(new URL('./MissionControls.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./mission.css', import.meta.url), 'utf8')

describe('Mission status language', () => {
  const preferences = {
    setInterfaceLanguage: async (interfaceLanguage: InterfaceLanguage) => ({
      ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguage
    })
  } as GeneralPreferencesApi

  afterEach(async () => { await changeInterfaceLanguage(preferences, 'zh-CN') })

  it('updates visible and accessible labels for all four statuses', async () => {
    await changeInterfaceLanguage(preferences, 'en')
    for (const [status, label] of [
      ['needs_you', 'Needs you'],
      ['not_started', 'Not started'],
      ['in_progress', 'In progress'],
      ['completed', 'Complete']
    ] as const satisfies ReadonlyArray<readonly [MissionStatus, string]>) {
      const mission = { title: 'Roadmap', status } as MissionRecord
      const markup = renderToStaticMarkup(createElement(StatusMenu, { m: mission, onStatus: () => undefined }))
      expect(markup).toContain(`<span>${label}</span>`)
      expect(markup).toContain(`aria-label="Change status for Roadmap. Current: ${label}"`)
    }
    expect(translateUi('en', '暂无{0}的使命', 'Needs you')).toBe('No missions marked Needs you')

    await changeInterfaceLanguage(preferences, 'zh-CN')
    const chinese = renderToStaticMarkup(createElement(StatusMenu, {
      m: { title: '计划', status: 'needs_you' } as MissionRecord,
      onStatus: () => undefined
    }))
    expect(chinese).toContain('<span>需要你</span>')
    expect(chinese).toContain('aria-label="修改 计划 的状态，当前需要你"')
  })

  it('formats Mission dates in the selected interface language', async () => {
    const value = '2000-01-02T03:04:00.000Z'
    const date = new Date(value)
    await changeInterfaceLanguage(preferences, 'en')
    expect(missionDate(value)).toBe(date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }))
    await changeInterfaceLanguage(preferences, 'zh-CN')
    expect(missionDate(value)).toBe(date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', year: 'numeric' }))
    const today = new Date()
    await changeInterfaceLanguage(preferences, 'en')
    expect(missionDate(today.toISOString())).toBe(today.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }))
  })
})

describe('Mission card action menu interaction', () => {
  it('keeps submenus click-open while giving every action a visible hover and keyboard-focus state', () => {
    expect(component).toContain('onPointerMove={event => event.preventDefault()}')
    expect(component).toContain("onClick={event => { event.preventDefault(); setPanel(current => current === id ? null : id) }}")
    expect(styles).toMatch(/\.mission-action-menu \.compact-option:is\(:hover,:focus-visible\),\.mission-action-menu \.compact-option\[data-state="open"\]\s*\{\s*background:\s*var\(--surface-hover\);\s*\}/)
    expect(styles).toMatch(/\.mission-action-menu \.mission-danger-item:is\(:hover,:focus-visible,\[data-highlighted\]\)\s*\{[^}]*background:\s*var\(--danger-soft\);/)
  })
})

describe('Mission card roster fitting', () => {
  const measure = (label: string): number => label.length * 7

  it('keeps five 23px avatars with 7px overlap at regular card width', () => {
    expect(missionCardVisibleAvatarCount(5, 87, measure)).toBe(5)
    expect(missionCardVisibleAvatarCount(8, 105, measure)).toBe(5)
  })

  it('reduces visible avatars and recalculates +N when footer space is narrow', () => {
    expect(missionCardVisibleAvatarCount(8, 73, measure)).toBe(3)
    expect(missionCardVisibleAvatarCount(12, 41, measure)).toBe(1)
  })

  it('keeps one avatar as the final compact fallback', () => {
    expect(missionCardVisibleAvatarCount(8, 1, measure)).toBe(1)
  })
})
