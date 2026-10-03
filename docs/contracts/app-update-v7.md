---
document_type: interface-contract
contract: app-update
version: 7
status: accepted
authority: app-update-release-notes-language-selection
source_version: v1.72
last_updated: 2026-10-03
---

# App Update v7 Contract

v7 inherits [v6](app-update-v6.md)'s snapshot, installed and candidate release separation, release-date sources,
actions and controlled-exit behavior. It adds bilingual publication and Renderer-only release-note language selection;
it does not change the App Update API or the preference schema/API in [Interface Language v1](interface-language-v1.md).
Release-note prose stays outside the interface translation catalog and is never automatically translated.

## Publication and source ownership

[`build/release-notes.md`](../../build/release-notes.md) remains the single repository-owned source. New publications
must provide non-empty `en` and `zh-CN` sections using the marker rules below, in addition to the inherited exact
package-version heading and 100,000-character limit. The release-source check and Server draft assembly use the same
Markdown parsing and content-eligibility rules as the Renderer; missing, duplicate, malformed or empty required
language sections reject publication. This publication requirement does not reject historical or single-language
notes when reading an existing release.

The official GitHub Release body, platform manifest `releaseNotes`, bundled notes and the Server draft's
`RELEASE-NOTES.md` retain the complete bilingual source, including markers and document-level definitions. Packaging
and verification compare the full manifest notes with the source, never a language-selected copy. Installed
`currentRelease.releaseNotes` retains the exact version-matched bundled text; `availableRelease.releaseNotes` continues
to come only from the existing bounded updater normalization. Main, Preload and the update snapshot do not select a
language. Missing installed notes must not be replaced with candidate or GitHub latest notes.

## Language boundaries

Parse the whole document with the CommonMark/GFM rules used by `SafeMarkdown`, including footnotes and
`singleTilde: false`. A boundary must be a top-level HTML node containing only a single-line comment of the form
`<!-- lang:<tag> -->`, on its own line. Zero to three leading spaces and trailing horizontal whitespace are allowed;
other content on the marker line is not. The `lang` keyword and language tag are case-insensitive. The tag has a
2–3 ASCII-letter primary language followed by zero or more hyphen-separated 2–8 ASCII-alphanumeric subtags; underscores
and incomplete tags are invalid. Horizontal whitespace is allowed after `<!--`, after `lang:` and before `-->`.

The public preamble is everything before the first marker. Each section begins after its marker line and continues
to the next marker or the end of the document; section order is source order. The preamble is retained for every
selected language. It holds the shared version heading and genuinely shared prose; translated summaries, changes and
upgrade instructions belong inside their respective sections.

Marker examples inside fenced or indented code, inline code, blockquotes, lists, footnotes or ordinary comments are
not boundaries. A malformed standalone language comment, duplicate tag after case normalization, a marker mixed with
other line content, an ambiguous HTML block containing marker syntax, a parsing failure or unavailable boundary
positions must fail open to the complete original notes, not truncate or guess a section. Notes with no valid markers
also retain their complete original text. This fallback still uses `SafeMarkdown`; it does not enable raw HTML.

## Content eligibility and fallback

A section is eligible only when it contains renderable note content, evaluated with the original whole-document
reference-link and footnote definition context, not an isolated section parse. Whitespace, HTML/comments,
reference-link or footnote definitions without references, and images suppressed by `SafeMarkdown` do not count.
A reference image whose definition is in another language remains hidden image content, not unresolved visible text.
Recursively empty containers, including blockquotes and lists containing only such hidden nodes, do not count and
must not block fallback. Visible text, code, tables or referenced footnotes inside a container still make that section eligible.
Neither shared preamble content nor imported definitions can make an otherwise empty section eligible.

Normalize the requested and section language tags case-insensitively and consider only eligible sections. Select the
first available choice in this order:

1. Exact complete tag.
2. The bare primary language tag, then the first section with the same primary language in source order.
3. Bare `en`, then the first `en-*` section in source order.
4. The first eligible section in source order.

Thus `zh-CN` may fall back to `zh` or another `zh-*` section, and an English-only release remains readable in a Chinese
interface. Missing translations do not trigger translation, a second source or a request. If every marked section is
empty, retain the complete original notes rather than replace them with an empty selected body. A genuinely absent
source continues to use the inherited explicit empty state.

## Document-level definitions and display cleanup

Language selection preserves the original document's reference-link and footnote definition environment, including
definitions in the preamble, unselected sections and nested containers. Use the Markdown parser's normalized
identifiers, not literal-label or single-line regular-expression matching. For each definition type and identifier,
the first definition in original document order wins; link and footnote identifiers have separate namespaces.
A later definition in the selected section must not override an earlier one in another language. Definitions nested
in footnote bodies retain their document-wide scope independently of which footnote definition wins.

Carry those canonical definitions into the display copy before the preamble and selected body so reparsing retains
first-wins behavior. Only definition nodes may be serialized; retain the preamble and selected body as original source
slices, apart from marker removal and the display-title cleanup below. The display copy need not be byte-identical to
the source, but publication bytes remain unchanged. Preserve whole footnote definitions: all continuation paragraphs,
lists, code blocks and other children, along with their reference dependencies. A referenced footnote is not cut down to its first line or dropped
because its definition appeared outside the selected language. Definition-only content is support data, not a reason
to select an empty section.

After selection, apply the inherited exact leading-version-H1 cleanup to the display copy. Leading reference-link
and footnote definition nodes are non-displaying metadata and must not prevent that cleanup; retain the definitions,
other headings and all non-duplicate content. Both selected and full-text fallback copies go through the shared
`SafeMarkdown` safety boundary. The original source, manifests and release snapshots are never rewritten.

## Renderer coordination

The shared About & Updates body used by Desktop, Desktop-hosted Web and independent Server follows the displayed
interface language. A language change recomputes only the note display copy immediately; it does not reload/remount
the page, reset the installed/candidate release tab, call update `get`/`check` or fetch notes, change the snapshot or
alter check, prompt, download and install eligibility. Preference persistence remains owned by Interface Language v1;
this contract adds no new preference field or language selector.

## References

- [Desktop App Updates architecture](../architecture/desktop-app-updates.md#多语言发布与展示)
- [Interface Language v1](interface-language-v1.md)
- [macOS packaging and shared release source](../development/packaging.md#主动检查更新发布集合)
- [Windows packaging](../development/packaging-windows.md)
- [Settings workspace surface brief](../../apps/desktop/.impeccable/surfaces/settings-workspace.md#关于与更新)
