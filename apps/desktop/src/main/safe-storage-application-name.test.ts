import { describe, expect, it } from 'vitest'
import { isolatedSafeStorageApplicationName } from './safe-storage-application-name'

describe('isolated safeStorage application name', () => {
  it('uses a stable non-sensitive namespace per explicit user-data directory', () => {
    const first = isolatedSafeStorageApplicationName('Rovai AI', '/private/tmp/fixture-a/user-data')
    const same = isolatedSafeStorageApplicationName('Rovai AI', '/private/tmp/fixture-a/user-data')
    const other = isolatedSafeStorageApplicationName('Rovai AI', '/private/tmp/fixture-b/user-data')

    expect(first).toBe(same)
    expect(first).not.toBe(other)
    expect(first).toMatch(/^Rovai AI Isolated [a-f0-9]{12}$/)
    expect(first).not.toContain('/private/tmp')
  })
})
