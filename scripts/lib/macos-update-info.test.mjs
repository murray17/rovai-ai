import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeMacUpdateInfoDocuments, mergeMacUpdateInfoYaml } from './macos-update-info.mjs'

const SHA_X64 = 'x'.repeat(88)
const SHA_ARM64 = 'a'.repeat(88)

function updateInfo(architecture, overrides = {}) {
  const zip = `Rovai-AI-0.0.2-${architecture}.zip`
  const dmg = `Rovai-AI-0.0.2-${architecture}.dmg`
  const sha512 = architecture === 'x64' ? SHA_X64 : SHA_ARM64
  return {
    version: '0.0.2',
    files: [
      { url: zip, sha512, size: architecture === 'x64' ? 120 : 140 },
      { url: dmg, sha512: `${sha512.slice(0, 87)}d`, size: architecture === 'x64' ? 220 : 240 }
    ],
    path: zip,
    sha512,
    releaseDate: architecture === 'x64'
      ? '2026-08-24T12:00:00.000Z'
      : '2026-08-24T12:01:00.000Z',
    releaseNotes: '# Rovai AI v0.0.2\n\n- Reliable updates\n',
    ...overrides
  }
}

test('merges both macOS architectures with deterministic ZIP-first ordering', () => {
  const merged = mergeMacUpdateInfoDocuments([updateInfo('arm64'), updateInfo('x64')])

  assert.equal(merged.version, '0.0.2')
  assert.deepEqual(merged.files.map((file) => file.url), [
    'Rovai-AI-0.0.2-x64.zip',
    'Rovai-AI-0.0.2-arm64.zip',
    'Rovai-AI-0.0.2-x64.dmg',
    'Rovai-AI-0.0.2-arm64.dmg'
  ])
  assert.equal(merged.path, 'Rovai-AI-0.0.2-x64.zip')
  assert.equal(merged.sha512, SHA_X64)
  assert.equal(merged.releaseDate, '2026-08-24T12:01:00.000Z')
  assert.equal(merged.releaseNotes, '# Rovai AI v0.0.2\n\n- Reliable updates\n')
  assert.match(mergeMacUpdateInfoYaml([updateInfo('arm64'), updateInfo('x64')]), /version: 0\.0\.2/)
})

test('rejects version mismatches', () => {
  assert.throws(
    () => mergeMacUpdateInfoDocuments([
      updateInfo('arm64'),
      updateInfo('x64', { version: '0.0.3' })
    ]),
    /cannot merge macOS update versions/
  )
})

test('rejects a manifest without both updater ZIP architectures', () => {
  assert.throws(
    () => mergeMacUpdateInfoDocuments([updateInfo('arm64'), updateInfo('arm64')]),
    /no x64 ZIP/
  )
})

test('rejects conflicting release metadata', () => {
  assert.throws(
    () => mergeMacUpdateInfoDocuments([
      updateInfo('arm64', { releaseName: 'Stable' }),
      updateInfo('x64', { releaseName: 'Preview' })
    ]),
    /disagree on release metadata/
  )
})

test('rejects conflicting release notes across macOS architectures', () => {
  assert.throws(
    () => mergeMacUpdateInfoDocuments([
      updateInfo('arm64'),
      updateInfo('x64', { releaseNotes: '# Rovai AI v0.0.2\n\n- Different notes\n' })
    ]),
    /disagree on release metadata/
  )
})
