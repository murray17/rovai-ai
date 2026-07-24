import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SkillSettings, formatBytes, importActionLabel, projectionStateLabel } from './SkillSettings'

describe('Skill settings', () => {
  it('renders the Skill Library as the safe default settings surface', () => {
    const markup = renderToStaticMarkup(createElement(SkillSettings))

    expect(markup).toContain('本机技能库')
    expect(markup).toContain('导入 Skill')
    expect(markup).toContain('正在读取 Skill Library')
    expect(markup).toContain('启用 Skill 不会扩大 Agent 权限')
    expect(markup).not.toContain('允许执行')
  })

  it('explains import and projection states without relying on color', () => {
    expect(importActionLabel('create')).toBe('新 Skill')
    expect(importActionLabel('update')).toContain('需要确认更新')
    expect(importActionLabel('bundled_conflict')).toContain('不能覆盖')
    expect(projectionStateLabel('shadowed')).toContain('项目同名')
    expect(projectionStateLabel('unsupported')).toContain('不支持')
    expect(projectionStateLabel('corrupted')).toContain('损坏')
  })

  it('formats import sizes compactly and deterministically', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1_536)).toBe('1.5 KB')
    expect(formatBytes(2 * 1_024 * 1_024)).toBe('2.0 MB')
  })
})
