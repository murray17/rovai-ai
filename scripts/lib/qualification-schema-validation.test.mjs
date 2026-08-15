import assert from 'node:assert/strict'
import test from 'node:test'
import {
  qualificationSchemaReference,
  validateQualificationContractSchemaCatalog,
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

test('cross-version contract schema catalog is independent of frozen history', () => {
  const catalog = validateQualificationContractSchemaCatalog()
  assert.equal(catalog.catalogVersion, '1.4.0')
  assert.deepEqual(catalog.schemas.map((entry) => entry.file), [
    'gather-completion-input-v1.schema.json',
    'semantic-judge-view-suite-v1.schema.json',
    'tool-interaction-measurement-v1.schema.json',
    'tool-interaction-measurement-v2.schema.json',
    'tool-use-judge-pack-v1.schema.json',
    'tool-use-judge-pack-v2.schema.json',
    'tool-use-judge-configuration-v1.schema.json',
    'tool-use-judge-replica-result-v1.schema.json',
    'tool-use-review-v1.schema.json',
    'resource-measurement-v1.schema.json',
    'paired-collaboration-experiment-v1.schema.json'
  ])
})
