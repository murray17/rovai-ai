# Rovai AI Legal Payload

This directory is the directly readable legal payload distributed outside
`app.asar` in packaged desktop applications. `THIRD_PARTY_NOTICES.md` is the
entry point. `manifest.json` authenticates every other payload file by path,
size, and SHA-256 without timestamps or machine-local paths.

The source repository remains authoritative for the generated dependency
manifests and provenance records. A successful integrity check confirms that
the expected files were packaged without alteration; it is not a legal review
or an approval to release.
