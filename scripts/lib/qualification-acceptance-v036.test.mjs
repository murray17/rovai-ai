import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { digestJson, verifyStoredCaseSeal } from './qualification-common.mjs'
import { validateQualificationSchemaCatalog } from './qualification-schema-validation.mjs'
import { validateV036Schema, validateV036SchemaCatalog } from './qualification-v036-schema-validation.mjs'

const root = resolve(import.meta.dirname, '../..')

test('v0.36 schema catalog and public Case identities are closed, digest-bound, and locator-free', async () => {
  assert.ok(validateQualificationSchemaCatalog().schemas.length > 0)
  assert.equal(validateV036SchemaCatalog().schemas.length, 13)
  const catalog = JSON.parse(await readFile(
    resolve(root, 'qualification/diagnostic/v0.36/cases.json'),
    'utf8'
  ))
  validateV036Schema('diagnostic-case-public-catalog.schema.json', catalog)
  const payload = Object.fromEntries(Object.entries(catalog).filter(([key]) => key !== 'payloadDigest'))
  assert.equal(catalog.payloadDigest, `sha256:${digestJson(payload)}`)
  const serialized = JSON.stringify(catalog)
  for (const forbidden of [
    'sealedPackLocator',
    'referenceImplementation',
    'challengeManifest',
    'mutants',
    'canary',
    '/Users/',
    '/private/'
  ]) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

test('v0.36 reader preserves the historical v2 DEMO-001 Seal', async () => {
  const record = await verifyStoredCaseSeal(resolve(root, 'qualification/demo/DEMO-001'))
  assert.equal(record.contract.manifest.schemaVersion, 2)
  assert.equal(record.seal, '99acc0ab472d43321dde89907128b8688a454c96270db9a0fab9cc714f3b074b')
})
