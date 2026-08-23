---
document_type: prototype-archive
status: archived
authority: historical-reference-only
last_updated: 2026-08-23
superseded_by:
  - docs/contracts/camp-attachment-v5.md
  - docs/contracts/camp-composer-draft-v4.md
  - docs/ui/components/conversation-workspace.md
---

# Attachment Composer Prototype Archive

This directory preserves the historical Camp Composer attachment study. It used the former Arctic
Dawn visual direction and recorded several questions that have since been resolved by current
contracts and the production conversation workspace.

Current authority:

- [Camp Attachment v5](../../../contracts/camp-attachment-v5.md)
- [Camp Composer Draft v4](../../../contracts/camp-composer-draft-v4.md)
- [Camp conversation workspace](../../../ui/components/conversation-workspace.md)
- [Conversation drop zone](../../../ui/components/conversation-drop-zone.md)

## Archived files

- `design-brief.md`: the original design brief and unresolved questions at the time.
- `rovai-attachment-composer-prototype.html`: the historical browser loader.
- `payload-1.txt` through `payload-4.txt`: ordered Base64 chunks of one gzip-compressed,
  self-contained HTML prototype. The loader concatenates, decodes and decompresses them in the
  browser. They are synthetic design assets, not credentials or Runtime data.

To view the archived prototype, serve this directory over local HTTP so the loader can fetch the
payload chunks. Do not treat its UI, limits, wording or sample data as current product behavior.
