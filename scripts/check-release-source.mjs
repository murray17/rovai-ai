import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  RELEASE_METADATA_FILE,
  configuredReleaseNotesFile,
  validateReleaseMetadataSource
} from './lib/release-notes.mjs'
import { validateBilingualReleaseNotesSource } from './lib/release-notes-localization.mjs'

const root = resolve(import.meta.dirname, '..')
const packageMetadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const releaseNotes = await readFile(resolve(root, configuredReleaseNotesFile(packageMetadata)), 'utf8')
const releaseMetadata = JSON.parse(await readFile(resolve(root, RELEASE_METADATA_FILE), 'utf8'))

validateBilingualReleaseNotesSource(releaseNotes, packageMetadata.version)
validateReleaseMetadataSource(releaseMetadata, packageMetadata.version)
