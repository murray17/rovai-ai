---
document_type: interface-contract
contract: app-update
version: 5
status: accepted
authority: desktop-app-update-current-and-available-release-notes
source_version: v1.70
last_updated: 2026-09-25
---

# App Update v5 Contract

v5 inherits [v4](app-update-v4.md)'s check, prompt, download, install and controlled-exit behavior. It adds an
independent installed-release projection to the Desktop snapshot; `availableRelease` remains only a newer, actionable
update candidate.

## Installed release

Desktop `AppUpdatesApi.get()` and `onChanged()` always include `currentRelease: AppUpdateRelease`. Its `version` is the
running `currentVersion` without an optional leading `v`, `releaseName` is `Rovai AI v<version>`, and `releaseDate` is
`null` because the bundled source has no publication date. The `releaseNotes` field contains the exact bundled
`build/release-notes.md` text only when its first non-empty line is exactly `# Rovai AI v<version>`, its body is
non-empty, and it is at most 100,000 characters. Otherwise `releaseNotes` is `null`. Older and Server snapshots may
omit `currentRelease`; the Renderer treats a missing or version-mismatched value as an installed release with no
built-in notes. It must never substitute the GitHub latest release or a candidate release for that missing content.

The source is compiled into the Desktop Main bundle at build time. Reading the About page or switching versions makes
no network request. Packaging checks still bind the same source to update manifests; the installed snapshot check
binds it to the actual running App version. An installation restart loads the newly installed bundle and its own
`currentRelease`.

## Candidate and presentation

`availableRelease` continues to come only from the existing updater check result, with Main's bounded normalization.
Checking or a failed check retains a known candidate. A successful up-to-date result clears only the candidate and
prompt, leaving `currentRelease` available offline. An absent candidate displays the installed release by default;
when a candidate exists, the page defaults to that release and offers keyboard-accessible tabs for the candidate and
installed release. Selecting the installed tab does not change download eligibility or prompt state. Candidate notes
that were not supplied by the updater show an explicit empty state, without a secondary fetch.

The release header owns the version title. For display only, the Renderer removes the first Markdown root node when
it is a level-one plain-text heading exactly matching the normalized release name or exact version title. Other
headings and the original release text remain unchanged. Both sources continue through `SafeMarkdown`.

## References

- [Desktop App Updates architecture](../architecture/desktop-app-updates.md)
- [Settings workspace surface brief](../../apps/desktop/.impeccable/surfaces/settings-workspace.md#关于与更新)
