import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const entry = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
const manifest = readFileSync(new URL('./graphite-command.css', import.meta.url), 'utf8')
const css = [
  'graphite-command-foundation.css',
  'graphite-command-sidebar.css',
  'graphite-command-workspaces.css',
  'graphite-command-settings.css',
  'graphite-command-overlays.css'
].map((file) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')).join('\n')

describe('Graphite Command renderer layer', () => {
  it('loads after the canonical renderer stylesheet', () => {
    expect(entry.indexOf("import './graphite-command.css'"))
      .toBeGreaterThan(entry.indexOf("import './styles.css'"))
    expect(manifest.match(/@import/g)).toHaveLength(5)
  })

  it('covers every top-level desktop workspace without replacing behavior', () => {
    for (const selector of [
      '.unified-sidebar',
      '.quick-chat-workspace',
      '.camp-workspace',
      '.content.members-content',
      '.memory-library',
      '.content.settings-content',
      '.new-camp-dialog',
      '.notification-drawer'
    ]) {
      expect(css, selector).toContain(selector)
    }
  })

  it('keeps the shared Graphite palette and reduced-motion contract explicit', () => {
    expect(css).toContain('--graphite-sidebar-active: #272e38')
    expect(css).toContain('--graphite-accent: #6ed8c3')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
