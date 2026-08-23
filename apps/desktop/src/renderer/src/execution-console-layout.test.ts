import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

function styleBlock(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null
}

describe('execution console layout', () => {
  it('keeps the avatar-to-name spacing equal in the bottom dock and right sidecar', () => {
    expect(styleBlock('.run-pulse-chip-copy')).toMatch(/margin-inline-start:\s*4px/)
    expect(styleBlock('.run-pulse-inspector .run-pulse-chip-copy') ?? '')
      .not.toMatch(/margin(?:-inline-start)?:/)
  })
})
