import assert from 'node:assert/strict'
import test from 'node:test'
import {
  qualificationSchemaReference,
  validateQualificationSchemaCatalog
} from './qualification-schema-validation.mjs'

test('v0.34 schema catalog digests, references, and draft 2020-12 metaschemas compile', () => {
  const catalog = validateQualificationSchemaCatalog()
  assert.equal(catalog.catalogVersion, '1.3.0')
  assert.equal(catalog.schemas.length, 21)
  assert.deepEqual(
    qualificationSchemaReference('judge-evidence-pack.schema.json'),
    {
      artifactId: 'json-schema:judge-evidence-pack:1.0.0',
      schemaId: 'rovai.qualification.json-schema',
      schemaVersion: '1.0.0',
      payloadDigest: 'sha256:a075c2b44e97abef21574ad347391de9b586d2d6b377a6d89d557fe2e0f650ab'
    }
  )
})
