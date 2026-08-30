import { describe, expect, it } from 'vitest'
import { filePreviewAssetUrl, parseFilePreviewAssetUrl } from './file-preview-asset-url'

const token = '123e4567-e89b-12d3-a456-426614174000'

describe('file preview asset URLs', () => {
  it('resolves local references inside the authorized root', () => {
    const url = filePreviewAssetUrl('../images/hero 1.png#crop', token, 'pages/guides')
    expect(url).toBe(`rovai-preview://asset/${token}/pages/images/hero%201.png#crop`)
    expect(parseFilePreviewAssetUrl(url as string)).toEqual({
      tabToken: token,
      pathSegments: ['pages', 'images', 'hero 1.png']
    })
  })

  it('rejects schemes and traversal beyond the root', () => {
    expect(filePreviewAssetUrl('https://example.com/x.js', token, 'pages')).toBeNull()
    expect(filePreviewAssetUrl('../../secret.txt', token, 'pages')).toBeNull()
    expect(parseFilePreviewAssetUrl(`rovai-preview://asset/${token}/%2e%2e/secret.txt`)).toBeNull()
  })
})
