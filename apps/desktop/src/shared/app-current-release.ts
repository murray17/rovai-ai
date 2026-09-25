import type { AppUpdateRelease } from '@contracts'

const MAX_RELEASE_NOTES_LENGTH = 100_000

/** The bundled document belongs only to the exact running App version. */
export function currentReleaseFromBundledNotes(
  currentVersion: string,
  bundledNotes: string | null | undefined
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

  return {
    version,
    releaseName: `Rovai AI v${version}`,
    releaseDate: null,
    releaseNotes
  }
}
