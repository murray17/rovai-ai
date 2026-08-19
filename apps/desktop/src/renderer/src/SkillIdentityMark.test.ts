import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SkillIdentityMark, skillIdentityMarkText } from './SkillIdentityMark'
import { identityColorToken } from './theme'

describe('SkillIdentityMark', () => {
  it('derives a short readable mark from Latin, CJK, emoji, and empty names', () => {
    expect(skillIdentityMarkText('analyze-agent-codebase')).toBe('AA')
    expect(skillIdentityMarkText('图像生成')).toBe('图')
    expect(skillIdentityMarkText('🧰-文档')).toBe('🧰文')
    expect(skillIdentityMarkText('___')).toBe('SK')
  })

  it('uses one stable identity color in default and compact geometry', () => {
    const skillId = '019ff120-6051-7c63-a88f-eff3ecc059fb'
    const expectedStyle = `style="--skill-identity:${identityColorToken(skillId)}"`
    const regular = renderToStaticMarkup(createElement(SkillIdentityMark, {
      skillId,
      name: 'analyze-agent-codebase'
    }))
    const compact = renderToStaticMarkup(createElement(SkillIdentityMark, {
      skillId,
      name: 'analyze-agent-codebase',
      size: 'compact'
    }))

    expect(regular).toContain('class="skill-identity-mark"')
    expect(compact).toContain('class="skill-identity-mark is-compact"')
    expect(regular).toContain(expectedStyle)
    expect(compact).toContain(expectedStyle)
    expect(regular).toContain('aria-hidden="true"')
    expect(compact).toContain('aria-hidden="true"')
    expect(regular).toContain('>AA</span>')
    expect(compact).toContain('>AA</span>')
  })
})
