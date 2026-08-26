import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

function styleBlock(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null
}

describe('execution console layout', () => {
  it('keeps the avatar-to-name spacing equal in the bottom dock and right sidecar', () => {
    expect(styleBlock('.run-pulse-chip')).toMatch(/(?:^|;)\s*gap:\s*6px/)
    expect(styleBlock('.run-pulse-inspector .run-pulse-chip') ?? '')
      .not.toMatch(/(?:^|;)\s*gap:/)
    expect(styleBlock('.run-pulse-chip-copy')).toMatch(/margin-inline-start:\s*4px/)
    expect(styleBlock('.run-pulse-inspector .run-pulse-chip-copy') ?? '')
      .not.toMatch(/margin(?:-inline-start)?:/)
  })

  it('keeps the Tool group operation count visible in the right sidecar', () => {
    expect(styles).not.toMatch(
      /\.execution-drawer-inspector \.tool-group-count\s*\{[^}]*display:\s*none/
    )
  })

  it('places the Tool group icon and copy on one shared 16px center line', () => {
    expect(styleBlock('.tool-group-icon')).toMatch(/height:\s*16px/)
    expect(styleBlock('.tool-group-icon')).toMatch(/align-self:\s*center/)
    expect(styleBlock('.tool-group-copy')).toMatch(/display:\s*flex/)
    expect(styleBlock('.tool-group-copy')).toMatch(/min-height:\s*16px/)
    expect(styleBlock('.tool-group-copy')).toMatch(/align-items:\s*center/)
    expect(styleBlock('.tool-group-line')).toMatch(/align-items:\s*center/)
    expect(styleBlock('.tool-group-line')).toMatch(/line-height:\s*16px/)
  })
})
