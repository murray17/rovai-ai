import type { AppUpdateRelease } from '@contracts'

const MAX_RELEASE_NOTES_LENGTH = 100_000

export interface BundledReleaseMetadata {
  version: string
  releaseDate: string
}

/** Bundled release facts belong only to the exact running App version. */
export function currentReleaseFromBundledSources(
  currentVersion: string,
  bundledNotes: string | null | undefined,
  metadata?: BundledReleaseMetadata | null
): AppUpdateRelease {
  const version = currentVersion.trim().replace(/^v/i, '')
  const lines = typeof bundledNotes === 'string' ? bundledNotes.split('\n') : []
  const headingIndex = lines.findIndex((line) => line.trim().length > 0)
  const hasMatchingHeading = headingIndex >= 0
    && lines[headingIndex] === `# Rovai AI v${version}`
  const hasBody = lines.slice(headingIndex + 1).join('\n').trim().length > 0
  const releaseNotes = bundledNotes
    && bundledNotes.length <= MAX_RELEASE_NOTES_LENGTH
    && hasMatchingHeading
    && hasBody
    ? bundledNotes
    : null
  const date = metadata?.version === version ? metadata.releaseDate : null
  const releaseDate = typeof date === 'string' && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString() === date
    ? date
    : null

  return {
    version,
    releaseName: `Rovai AI v${version}`,
    releaseDate,
    releaseNotes
  }
}
