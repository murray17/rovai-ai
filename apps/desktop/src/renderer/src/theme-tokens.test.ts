import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const requiredTokens = [
  '--canvas',
  '--surface',
  '--surface-raised',
  '--surface-subtle',
  '--surface-muted',
  '--surface-selected',
  '--ink',
  '--muted',
  '--faint',
  '--line',
  '--line-strong',
  '--control-line',
  '--brand',
  '--brand-hover',
  '--brand-contrast',
  '--brand-soft',
  '--success',
  '--success-soft',
  '--attention',
  '--attention-soft',
  '--danger',
  '--danger-soft',
  '--info',
  '--info-soft',
  '--neutral',
  '--neutral-soft',
  '--focus',
  '--overlay',
  '--evidence-canvas',
  '--evidence-surface',
  '--evidence-ink',
  '--evidence-muted',
  '--evidence-line',
  '--diff-add',
  '--diff-add-soft',
  '--diff-remove',
  '--diff-remove-soft'
] as const

function tokenBlock(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match?.[1]) throw new Error(`Missing CSS block: ${selector}`)
  return Object.fromEntries(
    [...match[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)]
      .map((entry) => [entry[1], entry[2].trim()])
  )
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(left: string, right: string): number {
  const leftLuminance = luminance(left)
  const rightLuminance = luminance(right)
  return (Math.max(leftLuminance, rightLuminance) + 0.05)
    / (Math.min(leftLuminance, rightLuminance) + 0.05)
}

function expectTextContrast(tokens: Record<string, string>): void {
  const pairs = [
    ['--ink', '--surface'],
    ['--muted', '--surface'],
    ['--faint', '--surface'],
    ['--brand-contrast', '--brand'],
    ['--success', '--success-soft'],
    ['--attention', '--attention-soft'],
    ['--danger', '--danger-soft'],
    ['--info', '--info-soft'],
    ['--neutral', '--neutral-soft'],
    ['--evidence-ink', '--evidence-surface'],
    ['--evidence-muted', '--evidence-surface'],
    ['--diff-add', '--diff-add-soft'],
    ['--diff-remove', '--diff-remove-soft']
  ] as const
  for (const [foreground, background] of pairs) {
    expect(
      contrast(tokens[foreground], tokens[background]),
      `${foreground} on ${background}`
    ).toBeGreaterThanOrEqual(4.5)
  }
  for (let index = 1; index <= 8; index += 1) {
    const token = `--identity-${index}`
    expect(
      contrast(tokens[token], tokens['--surface']),
      `${token} on --surface`
    ).toBeGreaterThanOrEqual(4.5)
  }
}

describe('Arctic Dawn theme tokens', () => {
  const day = tokenBlock(':root')

  it('defines the complete canonical Day token contract', () => {
    for (const token of requiredTokens) {
      expect(day[token], `Day ${token}`).toBeTruthy()
    }
    for (let index = 1; index <= 8; index += 1) {
      expect(day[`--identity-${index}`]).toBeTruthy()
    }
  })

  it('keeps normal text and semantic labels at WCAG AA contrast', () => {
    expectTextContrast(day)
  })

  it('keeps raw color literals inside the canonical token block', () => {
    const componentCss = css.replace(/:root\s*\{[\s\S]*?\n\}/, '')

    expect(componentCss).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(componentCss).not.toMatch(/\brgba?\(/i)
  })

  it('does not ship an inferred Night token block', () => {
    expect(css).not.toContain(':root[data-theme="night"]')
  })

  it('does not reference undeclared custom properties', () => {
    const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]))
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map((match) => match[1]))
    expect([...used].filter((token) => !declared.has(token))).toEqual([])
  })
})
