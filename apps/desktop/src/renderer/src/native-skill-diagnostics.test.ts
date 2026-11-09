import { describe, expect, it } from 'vitest'
import type { NativeSkillDiagnostic } from '@contracts'
import { nativeSkillCatalogNotices, nativeSkillDiagnosticLabel } from './native-skill-diagnostics'

describe('native Skill diagnostics', () => {
  const fallback: NativeSkillDiagnostic = { kind: 'metadata', path: '/s/review/SKILL.md', message: 'description must be a string', skillId: 'native:1' }
  const config: NativeSkillDiagnostic = { kind: 'metadata', path: '/home/.codex/config.toml', message: 'TOML parse error' }
  const denied: NativeSkillDiagnostic = { kind: 'file_read', path: '/s/blocked/SKILL.md', message: 'Permission denied', skillId: 'native:2' }

  it('keeps recovered document metadata out of composer notices but reports config and read failures', () => {
    const notices = nativeSkillCatalogNotices([fallback, config, denied])
    expect(notices).toHaveLength(2)
    expect(notices.join('\n')).not.toContain('description must be a string')
    expect(notices[0]).toContain('禁用配置无法解析')
    expect(notices[1]).toContain('Permission denied')
  })

  it('labels document metadata and disable configuration separately', () => {
    expect(nativeSkillDiagnosticLabel(fallback)).toBe('元数据异常')
    expect(nativeSkillDiagnosticLabel(config)).toBe('禁用配置无法解析')
  })
})
