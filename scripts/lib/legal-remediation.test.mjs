import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  generateArtworkManifest,
  inspectOptionExtArchive,
  OPTION_EXT_SOURCE,
  prepareLegalPayload,
  readJson,
  sha256,
  validateSkillLineage,
  validateArtworkManifest,
  validateOptionExtCompliance,
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
  assert.equal(result.binary_release_gate, 'PASS')
  assert.equal(result.javascript_source_instances, 494)
  assert.equal(result.javascript_binary_instances, 144)
  assert.equal(result.rust_third_party_crates, 119)
})

test('exact option-ext source archive is fixed, complete, and metadata-correct', () => {
  const archive = join(root, OPTION_EXT_SOURCE.path)
  const inspected = inspectOptionExtArchive(archive)
  assert.equal(inspected.sha256, OPTION_EXT_SOURCE.sha256)
  assert.equal(inspected.metadata.name, 'option-ext')
  assert.equal(inspected.metadata.version, '0.2.0')
  assert.equal(inspected.metadata.license, 'MPL-2.0')
  assert.ok(inspected.entries.includes('option-ext-0.2.0/Cargo.toml.orig'))
  assert.ok(inspected.entries.includes('option-ext-0.2.0/LICENSE.txt'))
})

test('option-ext source and compliance metadata fail closed on every required fact', () => {
  const rustManifest = readJson(join(root, 'legal/manifests/rust-release-dependencies.json'))
  const provenance = readFileSync(join(root, 'legal/provenance/option-ext-0.2.0.md'), 'utf8')
  const thirdPartyNotice = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  const sourceReadme = readFileSync(join(root, 'legal/sources/rust/README.md'), 'utf8')
  const validate = (overrides = {}) => validateOptionExtCompliance(root, {
    rustManifest,
    provenance,
    thirdPartyNotice,
    sourceReadme,
    requireTracked: false,
    ...overrides
  })
  assert.equal(validate().status, 'APPROVED_COMPLIANCE_PLAN')

  const pending = structuredClone(rustManifest)
  pending.option_ext_review_status = 'FACTS_COLLECTED_REVIEW_PENDING'
  assert.throws(() => validate({ rustManifest: pending }), /review status/)
  assert.throws(
    () => validate({ provenance: provenance.replace('APPROVED_COMPLIANCE_PLAN', 'FACTS_COLLECTED_REVIEW_PENDING') }),
    /provenance review status/
  )

  const mit = structuredClone(rustManifest)
  mit.dependencies.find((entry) => entry.id === 'option-ext@0.2.0').license_expression = 'MIT'
  assert.throws(() => validate({ rustManifest: mit }), /MPL-2.0 entry/)

  const missingPath = structuredClone(rustManifest)
  missingPath.option_ext_source.path = 'legal/sources/rust/missing.crate'
  assert.throws(() => validate({ rustManifest: missingPath }), /source manifest metadata/)

  const wrongHash = structuredClone(rustManifest)
  wrongHash.option_ext_source.sha256 = '0'.repeat(64)
  assert.throws(() => validate({ rustManifest: wrongHash }), /source manifest metadata/)

  assert.throws(
    () => validate({ thirdPartyNotice: thirdPartyNotice.replaceAll(OPTION_EXT_SOURCE.path, 'missing-source-path') }),
    /repository source path/
  )
})

test('option-ext archive deletion, byte drift, and missing LICENSE fail closed', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'rovai-option-ext-test-'))
  const source = join(root, OPTION_EXT_SOURCE.path)
  try {
    assert.throws(() => inspectOptionExtArchive(join(temporary, 'option-ext-0.2.0.crate')), /missing/)

    const tamperedDirectory = join(temporary, 'tampered')
    mkdirSync(tamperedDirectory)
    const tampered = join(tamperedDirectory, 'option-ext-0.2.0.crate')
    const bytes = readFileSync(source)
    const changed = Buffer.from(bytes)
    changed[changed.length - 1] ^= 1
    writeFileSync(tampered, changed)
    assert.throws(() => inspectOptionExtArchive(tampered), /digest mismatch/)

    const extracted = join(temporary, 'extracted')
    mkdirSync(extracted)
    assert.equal(spawnSync('tar', ['-xzf', source, '-C', extracted]).status, 0)
    unlinkSync(join(extracted, 'option-ext-0.2.0/LICENSE.txt'))
    const missingLicenseDirectory = join(temporary, 'missing-license')
    mkdirSync(missingLicenseDirectory)
    const missingLicense = join(missingLicenseDirectory, 'option-ext-0.2.0.crate')
    assert.equal(spawnSync('tar', ['-czf', missingLicense, '-C', extracted, 'option-ext-0.2.0']).status, 0)
    assert.throws(() => inspectOptionExtArchive(missingLicense, sha256(readFileSync(missingLicense))), /LICENSE.txt/)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('option-ext larger-work metadata preserves the file-level license boundary', () => {
  const content = [
    readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
    readFileSync(join(root, 'legal/provenance/option-ext-0.2.0.md'), 'utf8'),
    readFileSync(join(root, 'legal/sources/rust/README.md'), 'utf8')
  ].join('\n')
  assert.doesNotMatch(content, /option-ext is MIT/i)
  assert.doesNotMatch(content, /all Rovai source is MPL/i)
  assert.doesNotMatch(content, /all binary contents are relicensed under MPL/i)
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
    for (const path of [
      'rust/sources/option-ext-0.2.0.crate',
      'rust/sources/README.md',
      'rust/licenses/option-ext@0.2.0/LICENSE.txt',
      'provenance/option-ext-0.2.0.md'
    ]) assert.ok(existsSync(join(first, path)), `legal payload misses ${path}`)

    unlinkSync(join(second, 'LICENSE'))
    assert.throws(() => verifyPayload(second, { enforceReleaseGate: false }), /misses LICENSE|manifest paths/)
    assert.equal(verifyPayload(first).integrity, 'PASS')
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('packaged application exposes legal files outside app.asar', { skip: !process.env.ROVAI_PACKAGED_APP }, () => {
  const app = resolve(process.env.ROVAI_PACKAGED_APP)
  assert.ok(existsSync(join(app, 'Contents/Resources/legal/manifest.json')))
  assert.ok(existsSync(join(app, 'Contents/Resources/legal/rust/sources/option-ext-0.2.0.crate')))
  assert.ok(existsSync(join(app, 'Contents/Resources/app.asar')))
  assert.equal(verifyPayload(app).integrity, 'PASS')
})
