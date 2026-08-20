# Rovai AI Legal Payload

This directory is the directly readable legal payload distributed outside
`app.asar` in packaged desktop applications. `THIRD_PARTY_NOTICES.md` is the
entry point. `manifest.json` authenticates every other payload file by path,
size, and SHA-256 without timestamps or machine-local paths.

The source repository remains authoritative for the generated dependency
manifests and provenance records. A successful integrity check confirms that
the expected files were packaged without alteration; it is not a legal review
or an approval to release.

For the MPL-covered `option-ext 0.2.0` component, use these directly readable
payload routes:

- `rust/sources/option-ext-0.2.0.crate` — exact unmodified source archive;
- `rust/sources/README.md` — source availability and future-modification policy;
- `rust/licenses/option-ext@0.2.0/LICENSE.txt` — complete MPL-2.0 text;
- `provenance/option-ext-0.2.0.md` — checksum, dependency path, and compliance record.
