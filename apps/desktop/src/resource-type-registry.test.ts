import { describe, expect, it } from 'vitest'
import {
  getResourceVisualKind,
  type ResourceVisualKind
} from './resource-type-registry'

describe('resource type registry', () => {
  it.each<[string, ResourceVisualKind]>([
    ['config.toml', 'config'],
    ['src/App.tsx:20', 'code'],
    ['notebook.ipynb', 'notebook'],
    ['data.sqlite', 'database'],
    ['photo.heic', 'image'],
    ['installer.dmg', 'executable'],
    ['demo.mp4', 'video']
  ])('maps %s to the shared %s visual kind', (reference, expected) => {
    expect(getResourceVisualKind(reference)).toBe(expected)
  })

  it('keeps unknown extensions on the generic file visual', () => {
    expect(getResourceVisualKind('artifact.rovai-unknown')).toBe('file')
  })
})
