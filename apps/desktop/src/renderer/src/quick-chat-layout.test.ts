import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

describe('Quick Chat layout', () => {
  it('shrinks long recent Camp titles into the available row width', () => {
    expect(styles).toMatch(
      /\.truncate\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;[^}]*\}/
    )
    expect(styles).toMatch(
      /\.quick-chat-continue-row \.truncate\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 auto;[^}]*\}/
    )
  })
})
