---
document_type: interface-contract
contract: app-update
version: 6
status: accepted
authority: desktop-app-update-installed-release-date
source_version: v1.72
last_updated: 2026-09-28
---

# App Update v6 Contract

v6 inherits [v5](app-update-v5.md)'s snapshot, installed and candidate release separation, actions, and presentation. It
changes only the installed release date source. The v5 rule that always set `currentRelease.releaseDate` to `null` is
replaced here.

## Installed release date

`build/release-metadata.json` contains the version and canonical UTC ISO `releaseDate` declared for the packaged
release. The version must exactly match `package.json.version`; the timestamp must be valid and canonical. Release
preparation updates this file alongside `build/release-notes.md`. `build:desktop` rejects missing, stale or malformed
metadata before bundling. The publication date is checked against the official GitHub Release during publication; if
the release crosses a calendar day, its metadata and artifacts must be corrected before distribution.

Desktop Main and Desktop-hosted Web compile the same metadata into their bundles. `currentRelease.releaseDate` is the
bundled timestamp only when its version matches the running version and the timestamp is valid. Otherwise the field is
`null`, and About keeps its explicit unavailable-date state. A newer `availableRelease.releaseDate` still comes only
from the updater result. Opening About or switching between releases makes no network request, and the installed date
remains visible offline. Older and Server snapshots retain the v5 missing-value fallback.

## References

- [Desktop App Updates architecture](../architecture/desktop-app-updates.md)
- [macOS packaging](../development/packaging.md)
- [Settings workspace surface brief](../../apps/desktop/.impeccable/surfaces/settings-workspace.md#关于与更新)
