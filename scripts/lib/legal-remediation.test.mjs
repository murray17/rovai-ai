import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  generateArtworkManifest,
  prepareLegalPayload,
  readJson,
  validateSkillLineage,
  validateArtworkManifest,
  verifyManifestLicenseFiles,
  verifyPayload,
  verifySource
} from './legal-common.mjs'

const root = resolve(import.meta.dirname, '../..')

test('project artwork manifest covers tracked, embedded, duplicate, and design assets', () => {
  const committed = readJson(join(root, 'legal/manifests/project-artwork.json'))
  validateArtworkManifest(root, committed)
  assert.deepEqual(committed, generateArtworkManifest(root))
  assert.equal(committed.assets.length, 19)
  assert.equal(committed.embedded_assets.length, 16)
  assert.equal(new Set(committed.embedded_assets.map((asset) => asset.sha256)).size, 8)
  assert.equal(
    committed.assets.filter((asset) => asset.sha256 === '9bf86dcef1bf9a9c743d390b783c38a024f925e3faa98e745df8ba1a4338d1dc').length,
    2
  )
})

test('REVIEW_REQUIRED artwork fails the source gate validator', () => {
  const manifest = structuredClone(readJson(join(root, 'legal/manifests/project-artwork.json')))
  manifest.assets[0].status = 'REVIEW_REQUIRED'
  assert.throws(() => validateArtworkManifest(root, manifest), /requires review/)
})

test('source provenance gate covers Skills, runtime logos, schemas, and dependencies', () => {
  const result = verifySource(root)
  assert.equal(result.source_release_gate, 'PASS')
  assert.equal(result.binary_release_gate, 'BLOCKED:FACTS_COLLECTED_REVIEW_PENDING')
  assert.equal(result.javascript_source_instances, 494)
  assert.equal(result.javascript_binary_instances, 144)
  assert.equal(result.rust_third_party_crates, 119)
})

test('unresolved Grill lineage and unknown licenses fail closed', () => {
  assert.throws(
    () => validateSkillLineage('grill-duo', 'EXTERNAL_LINEAGE_UNRESOLVED'),
    /lineage remains unresolved/
  )
  const manifest = structuredClone(readJson(join(root, 'legal/manifests/javascript-source-dependencies.json')))
  manifest.dependencies[0].license_expression = 'UNKNOWN'
  assert.throws(() => verifyManifestLicenseFiles(root, manifest), /unknown or custom license expression/)
})

test('legal payload generation is deterministic and missing files fail closed', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'rovai-legal-payload-test-'))
  const first = join(temporary, 'first')
  const second = join(temporary, 'second')
  try {
    prepareLegalPayload(root, first)
    prepareLegalPayload(root, second)
    assert.equal(readFileSync(join(first, 'manifest.json'), 'utf8'), readFileSync(join(second, 'manifest.json'), 'utf8'))
    assert.deepEqual(verifyPayload(first, { enforceReleaseGate: false }).integrity, 'PASS')
    const manifestText = readFileSync(join(first, 'manifest.json'), 'utf8')
    assert.doesNotMatch(manifestText, /\/Users\/[^/]+\//)
    assert.doesNotMatch(manifestText, /"(?:created|generated|timestamp|time)_at"/i)

    unlinkSync(join(second, 'LICENSE'))
    assert.throws(() => verifyPayload(second, { enforceReleaseGate: false }), /misses LICENSE|manifest paths/)
    assert.throws(() => verifyPayload(first), /binary release blocked/)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('packaged application exposes legal files outside app.asar', { skip: !process.env.ROVAI_PACKAGED_APP }, () => {
  const app = resolve(process.env.ROVAI_PACKAGED_APP)
  assert.ok(existsSync(join(app, 'Contents/Resources/legal/manifest.json')))
  assert.ok(existsSync(join(app, 'Contents/Resources/app.asar')))
  assert.equal(verifyPayload(app, { enforceReleaseGate: false }).integrity, 'PASS')
})
