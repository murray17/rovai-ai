export const RELEASE_NOTES_FILE = 'build/release-notes.md'
export const MAX_RELEASE_NOTES_LENGTH = 100_000

export function configuredReleaseNotesFile(packageMetadata) {
  const configured = packageMetadata?.build?.releaseInfo?.releaseNotesFile
  if (configured !== RELEASE_NOTES_FILE) {
    throw new Error(
      `build.releaseInfo.releaseNotesFile must be ${JSON.stringify(RELEASE_NOTES_FILE)}`
    )
  }
  return configured
}

export function validateReleaseNotesSource(releaseNotes, version) {
  if (typeof releaseNotes !== 'string' || releaseNotes.trim().length === 0) {
    throw new Error('release notes source must be a non-empty UTF-8 document')
  }
  if (releaseNotes.length > MAX_RELEASE_NOTES_LENGTH) {
    throw new Error(`release notes source exceeds ${MAX_RELEASE_NOTES_LENGTH} characters`)
  }

  const lines = releaseNotes.split('\n')
  const headingIndex = lines.findIndex((line) => line.trim().length > 0)
  const firstNonEmptyLine = lines[headingIndex]
  const expectedHeading = `# Rovai AI v${version}`
  if (firstNonEmptyLine !== expectedHeading) {
    throw new Error(`release notes must begin with ${JSON.stringify(expectedHeading)}`)
  }
  if (lines.slice(headingIndex + 1).join('\n').trim().length === 0) {
    throw new Error('release notes must include content after the version heading')
  }
  return releaseNotes
}

export function assertUpdateInfoReleaseNotes({
  updateInfo,
  releaseNotes,
  version,
  manifestName
}) {
  const expected = validateReleaseNotesSource(releaseNotes, version)
  if (typeof updateInfo?.releaseNotes !== 'string') {
    throw new Error(`${manifestName} has no releaseNotes`)
  }
  if (updateInfo.releaseNotes !== expected) {
    throw new Error(`${manifestName} releaseNotes differ from ${RELEASE_NOTES_FILE}`)
  }
}
