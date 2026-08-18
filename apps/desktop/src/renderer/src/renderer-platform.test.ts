import { describe, expect, it, vi } from 'vitest'

import { applyRendererPlatform, RENDERER_PLATFORM_ATTRIBUTE } from './renderer-platform'

describe('Renderer platform projection', () => {
  it('projects the read-only preload platform onto the document root', () => {
    const setAttribute = vi.fn()
    applyRendererPlatform({ setAttribute }, 'win32')
    expect(setAttribute).toHaveBeenCalledExactlyOnceWith(
      RENDERER_PLATFORM_ATTRIBUTE,
      'win32'
    )
  })
})
