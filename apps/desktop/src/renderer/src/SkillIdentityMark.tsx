import type { CSSProperties, JSX } from 'react'
import { identityColorToken } from './theme'

export type SkillIdentityMarkSize = 'default' | 'compact'

export function SkillIdentityMark({
  skillId,
  name,
  size = 'default'
}: {
  skillId: string
  name: string
  size?: SkillIdentityMarkSize
}): JSX.Element {
  return (
    <span
      className={`skill-identity-mark${size === 'compact' ? ' is-compact' : ''}`}
      style={{ '--skill-identity': identityColorToken(skillId) } as CSSProperties}
      aria-hidden="true"
    >
      {skillIdentityMarkText(name)}
    </span>
  )
}

export function skillIdentityMarkText(name: string): string {
  const parts = name.split(/[-_\s]+/u).filter(Boolean)
  const mark = parts.slice(0, 2).map((part) => Array.from(part)[0] ?? '').join('')
  return Array.from(mark.toLocaleUpperCase('en-US')).slice(0, 2).join('') || 'SK'
}
