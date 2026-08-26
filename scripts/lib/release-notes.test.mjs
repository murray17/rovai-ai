import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  MAX_RELEASE_NOTES_LENGTH,
  RELEASE_NOTES_FILE,
  assertUpdateInfoReleaseNotes,
  configuredReleaseNotesFile,
  validateReleaseNotesSource
} from './release-notes.mjs'

const VERSION = '0.0.3'
const NOTES = '# Rovai AI v0.0.3\n\n## Fixed\n\n- Reliable updates\n'

test('repository release notes are present and bound to the package version', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const packageMetadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const releaseNotesFile = configuredReleaseNotesFile(packageMetadata)
  const releaseNotes = await readFile(resolve(root, releaseNotesFile), 'utf8')

  assert.equal(
    validateReleaseNotesSource(releaseNotes, packageMetadata.version),
    releaseNotes
  )
})

test('accepts configured release notes that exactly match the update manifest', () => {
  const packageMetadata = {
    build: { releaseInfo: { releaseNotesFile: RELEASE_NOTES_FILE } }
  }

  assert.equal(configuredReleaseNotesFile(packageMetadata), RELEASE_NOTES_FILE)
  assert.equal(validateReleaseNotesSource(NOTES, VERSION), NOTES)
  assert.doesNotThrow(() => assertUpdateInfoReleaseNotes({
    updateInfo: { releaseNotes: NOTES },
    releaseNotes: NOTES,
    version: VERSION,
    manifestName: 'latest.yml'
  }))
})

test('rejects a missing or different configured release notes source', () => {
  assert.throws(
    () => configuredReleaseNotesFile({ build: {} }),
    /releaseNotesFile must be/
  )
  assert.throws(
    () => configuredReleaseNotesFile({
      build: { releaseInfo: { releaseNotesFile: 'release-notes.md' } }
    }),
    /releaseNotesFile must be/
  )
})

test('rejects empty, oversized, and stale-version release notes', () => {
  assert.throws(
    () => validateReleaseNotesSource('  \n', VERSION),
    /non-empty/
  )
  assert.throws(
    () => validateReleaseNotesSource(`${NOTES}${'x'.repeat(MAX_RELEASE_NOTES_LENGTH)}`, VERSION),
    /exceeds/
  )
  assert.throws(
    () => validateReleaseNotesSource('# Rovai AI v0.0.2\n', VERSION),
    /Rovai AI v0\.0\.3/
  )
  assert.throws(
    () => validateReleaseNotesSource('# Rovai AI v0.0.3\n', VERSION),
    /include content/
  )
})

test('rejects missing or changed manifest release notes', () => {
  assert.throws(
    () => assertUpdateInfoReleaseNotes({
      updateInfo: {},
      releaseNotes: NOTES,
      version: VERSION,
      manifestName: 'latest-mac.yml'
    }),
    /latest-mac\.yml has no releaseNotes/
  )
  assert.throws(
    () => assertUpdateInfoReleaseNotes({
      updateInfo: { releaseNotes: `${NOTES}\n` },
      releaseNotes: NOTES,
      version: VERSION,
      manifestName: 'latest-mac.yml'
    }),
    /differ from build\/release-notes\.md/
  )
})
