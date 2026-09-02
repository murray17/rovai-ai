import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

interface CssRule {
  selectors: string[]
  body: string
  order: number
}

function cssRules(): CssRule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match, order) => ({
      selectors: match[1]
        .split(',')
        .map((selector) => selector.trim())
        .filter(Boolean),
      body: match[2],
      order
    }))
}

function specificity(selector: string): number {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0
  const classes = selector.match(/\.[\w-]+/g)?.length ?? 0
  return ids * 100 + classes * 10
}

function selectorMatchesClasses(selector: string, classNames: string[]): boolean {
  const requiredClasses = selector.match(/\.[\w-]+/g)?.map((name) => name.slice(1)) ?? []
  return requiredClasses.length > 0
    && requiredClasses.every((className) => classNames.includes(className))
}

function computedZIndex(classNames: string[]): number | null {
  let winner: { value: number, specificity: number, order: number } | null = null
  for (const rule of cssRules()) {
    for (const selector of rule.selectors) {
      if (!selectorMatchesClasses(selector, classNames)) continue
      const zIndex = rule.body.match(/(?:^|;)\s*z-index:\s*(-?\d+)/)?.[1]
      if (!zIndex) continue
      const next = {
        value: Number.parseInt(zIndex, 10),
        specificity: specificity(selector),
        order: rule.order
      }
      if (
        !winner
        || next.specificity > winner.specificity
        || (next.specificity === winner.specificity && next.order > winner.order)
      ) {
        winner = next
      }
    }
  }
  return winner?.value ?? null
}

describe('memory review drawer layering', () => {
  it('keeps the modal overlay below the interactive review drawer', () => {
    const overlayZIndex = computedZIndex(['dialog-overlay', 'memory-drawer-overlay'])
    const drawerZIndex = computedZIndex(['memory-review-drawer'])

    expect(overlayZIndex).not.toBeNull()
    expect(drawerZIndex).not.toBeNull()
    expect(overlayZIndex).toBeLessThan(drawerZIndex as number)
  })
})
