import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SkillSettings, formatBytes, importActionLabel, projectionStateLabel } from './SkillSettings'

describe('Skill settings', () => {
  it('renders the Skill Library as the safe default settings surface', () => {
    const markup = renderToStaticMarkup(createElement(SkillSettings))

    expect(markup).toContain('已安装 Skills')
    expect(markup).toContain('添加 Skill')
    expect(markup).toContain('正在读取 Skill Library')
    expect(markup).toContain('应用全局配置')
    expect(markup).toContain('管理 Rovai 内置与用户导入的 Skill')
    expect(markup).toContain('class="settings-page-heading"')
    expect(markup).toContain('<h1>Skill 管理</h1>')
    expect(markup).toContain('id="skill-import-local-tab"')
    expect(markup).toContain('aria-controls="skill-import-local-panel"')
    expect(markup).toContain('aria-labelledby="skill-import-local-tab"')
    expect(markup).toContain('导入前会先生成安全预览')
    expect(markup).not.toContain('class="skill-import-help"')
    expect(markup).not.toContain('允许执行')
  })

  it('explains import and projection states without relying on color', () => {
    expect(importActionLabel('create')).toBe('新 Skill')
    expect(importActionLabel('update')).toContain('新 Revision')
    expect(importActionLabel('official_conflict')).toContain('不能覆盖')
    expect(projectionStateLabel('shadowed')).toContain('项目同名')
    expect(projectionStateLabel('stale')).toContain('下次运行')
    expect(projectionStateLabel('pending_removal')).toContain('释放')
  })

  it('formats import sizes compactly and deterministically', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1_536)).toBe('1.5 KB')
    expect(formatBytes(2 * 1_024 * 1_024)).toBe('2.0 MB')
  })
})
