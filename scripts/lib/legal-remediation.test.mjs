import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
  isLegalFileBasename,
  legalFileKind,
  OPTION_EXT_SOURCE,
  packageLegalFiles,
  prepareLegalPayload,
  readJson,
  sha256,
  summarizeLegalCoverage,
  validateSkillLineage,
  validateArtworkManifest,
  validateOptionExtCompliance,
  verifyManifestLicenseFiles,
  verifyPayload,
  verifySource
} from './legal-common.mjs'

const root = resolve(import.meta.dirname, '../..')

test('legal filename matcher recognizes legal families without accepting source files', () => {
  const expected = new Map([
    ['LICENSE', 'LICENSE'],
    ['LICENSE.txt', 'LICENSE'],
    ['LICENSE-MIT', 'LICENSE'],
    ['LICENSE-APACHE', 'LICENSE'],
    ['LICENSE-0BSD', 'LICENSE'],
    ['LICENSE.BSD-3', 'LICENSE'],
    ['LICENCE-MIT', 'LICENSE'],
    ['COPYING', 'LICENSE'],
    ['COPYING.LESSER', 'LICENSE'],
    ['NOTICE-THIRD-PARTY', 'NOTICE'],
    ['COPYRIGHT', 'COPYRIGHT'],
    ['CopyrightNotice.txt', 'COPYRIGHT'],
    ['UNLICENSE', 'LICENSE'],
    ['PATENTS.txt', 'PATENT']
  ])
  for (const [sourceName, kind] of expected) {
    assert.equal(isLegalFileBasename(sourceName), true, sourceName)
    assert.equal(legalFileKind(sourceName), kind, sourceName)
  }
  for (const sourceName of [
    'LICENSE-generator.js',
    'noticeboard.png',
    'copyright-check.test.ts',
    'licenseCheck.json',
    'README.md'
  ]) assert.equal(isLegalFileBasename(sourceName), false, sourceName)
})

test('exact package fixture collects every regular legal file and verifies fail-closed metadata', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'rovai-legal-files-test-'))
  const packageRoot = join(temporary, 'package')
  const outputRoot = join(temporary, 'legal/licenses/rust/fixture@1.0.0')
  const contents = new Map([
    ['LICENSE-APACHE', 'Apache fixture\n'],
    ['LICENSE-MIT', 'MIT fixture\n'],
    ['NOTICE', 'Notice fixture\n']
  ])
  try {
    mkdirSync(packageRoot, { recursive: true })
    mkdirSync(outputRoot, { recursive: true })
    for (const [sourceName, content] of contents) {
      writeFileSync(join(packageRoot, sourceName), content)
      writeFileSync(join(outputRoot, sourceName), content)
    }
    writeFileSync(join(packageRoot, 'README.md'), 'not legal evidence\n')
    writeFileSync(join(packageRoot, 'LICENSE-generator.js'), 'not legal evidence\n')
    mkdirSync(join(packageRoot, 'LICENSE'))
    try {
      symlinkSync('README.md', join(packageRoot, 'LICENSE-SYMLINK'))
    } catch (error) {
      // Ordinary Windows users cannot create file symlinks unless Developer
      // Mode or SeCreateSymbolicLinkPrivilege is enabled. The directory
      // fixture above still proves that non-regular legal-looking entries are
      // ignored; keep the stronger symlink assertion wherever the host allows it.
      if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error
    }

    const collected = packageLegalFiles(packageRoot)
    assert.deepEqual(collected.map((file) => file.source_name), ['LICENSE-APACHE', 'LICENSE-MIT', 'NOTICE'])
    assert.deepEqual(packageLegalFiles(packageRoot), collected)

    const legalFiles = collected.map((file) => {
      const path = `legal/licenses/rust/fixture@1.0.0/${file.source_name}`
      const bytes = readFileSync(join(temporary, path))
      return { ...file, path, sha256: sha256(bytes), size: bytes.length }
    })
    const dependency = {
      id: 'fixture@1.0.0',
      crate: 'fixture',
      version: '1.0.0',
      release: true,
      license_expression: 'MIT OR Apache-2.0',
      license_evidence: { kind: 'PACKAGE_LEGAL_FILES' },
      legal_files: legalFiles,
      license_texts: legalFiles.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
      notice_file_present: true
    }
    const manifest = {
      schema_version: 2,
      ecosystem: 'rust',
      distribution_scope: 'release',
      dependencies: [dependency]
    }
    manifest.coverage = summarizeLegalCoverage(manifest.dependencies)
    const packageRoots = new Map([[dependency.id, packageRoot]])
    verifyManifestLicenseFiles(temporary, manifest, { packageRoots })

    const partial = structuredClone(manifest)
    partial.dependencies[0].legal_files = partial.dependencies[0].legal_files.slice(1)
    partial.dependencies[0].license_texts = partial.dependencies[0].license_texts.slice(1)
    assert.throws(() => verifyManifestLicenseFiles(temporary, partial, { packageRoots }), /represented exactly/)

    const metadataOnly = structuredClone(manifest)
    metadataOnly.dependencies[0].license_evidence = { kind: 'PACKAGE_METADATA_ONLY' }
    metadataOnly.dependencies[0].legal_files = []
    metadataOnly.dependencies[0].license_texts = []
    metadataOnly.dependencies[0].notice_file_present = false
    assert.throws(() => verifyManifestLicenseFiles(temporary, metadataOnly, { packageRoots }), /metadata-only license evidence/)

    const emptyExpression = structuredClone(manifest)
    emptyExpression.dependencies[0].license_expression = ''
    assert.throws(() => verifyManifestLicenseFiles(temporary, emptyExpression, { packageRoots }), /missing license expression/)

    const wrongBasename = structuredClone(manifest)
    wrongBasename.dependencies[0].legal_files[0].source_name = 'LICENSE-WRONG'
    assert.throws(() => verifyManifestLicenseFiles(temporary, wrongBasename, { packageRoots }), /source basename|loses source basename/)

    writeFileSync(join(outputRoot, 'LICENSE-MIT'), 'tampered\n')
    assert.throws(() => verifyManifestLicenseFiles(temporary, manifest, { packageRoots }), /size mismatch|digest mismatch/)
    writeFileSync(join(outputRoot, 'LICENSE-MIT'), contents.get('LICENSE-MIT'))
    unlinkSync(join(outputRoot, 'LICENSE-APACHE'))
    assert.throws(() => verifyManifestLicenseFiles(temporary, manifest, { packageRoots }), /missing legal file/)
    writeFileSync(join(outputRoot, 'LICENSE-APACHE'), contents.get('LICENSE-APACHE'))
    unlinkSync(join(outputRoot, 'NOTICE'))
    assert.throws(() => verifyManifestLicenseFiles(temporary, manifest, { packageRoots }), /missing legal file/)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('project artwork manifest covers tracked, embedded, duplicate, and design assets', () => {
  const committed = readJson(join(root, 'legal/manifests/project-artwork.json'))
  validateArtworkManifest(root, committed)
  assert.deepEqual(committed, generateArtworkManifest(root))
  assert.equal(committed.assets.length, 25)
  const readmeScreenshots = committed.assets.filter((asset) => asset.role === 'readme-screenshot')
  assert.equal(readmeScreenshots.length, 6)
  assert.ok(readmeScreenshots.every((asset) => asset.source_classification === 'FIRST_PARTY_PROJECT_SCREENSHOT'))
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

test('anyhow 1.0.103 retains both upstream licenses in source and binary metadata', () => {
  const manifest = readJson(join(root, 'legal/manifests/rust-release-dependencies.json'))
  const anyhow = manifest.dependencies.find((entry) => entry.id === 'anyhow@1.0.103')
  assert.ok(anyhow)
  assert.equal(anyhow.license_expression, 'MIT OR Apache-2.0')
  assert.equal(anyhow.crates_io_checksum, '2a4385e2e34eb35d6b3efe798b9eb88096925d87726c0798709bf56d9ed84af3')
  assert.equal(anyhow.license_evidence.kind, 'PACKAGE_LEGAL_FILES')
  assert.deepEqual(anyhow.legal_files.map((file) => file.source_name), ['LICENSE-APACHE', 'LICENSE-MIT'])
  for (const file of anyhow.legal_files) {
    const bytes = readFileSync(join(root, file.path))
    assert.equal(bytes.length, file.size)
    assert.equal(sha256(bytes), file.sha256)
  }
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
      'rust/licenses/anyhow@1.0.103/LICENSE-APACHE',
      'rust/licenses/anyhow@1.0.103/LICENSE-MIT',
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
