import assert from 'node:assert/strict'
import test from 'node:test'
import { validateV034AcceptanceRegistry } from './qualification-acceptance-v034.mjs'

test('v0.34 acceptance registry maps ACC-001 through ACC-025 to executable fixtures', async () => {
  const result = await validateV034AcceptanceRegistry()
  assert.equal(result.ok, true)
  assert.equal(result.entries, 25)
  assert.match(result.registryDigest, /^sha256:[a-f0-9]{64}$/)
})
