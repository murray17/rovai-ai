---
document_type: protocol-contract
contract: camp-history-v12
authority: public-camp-history-read-scope
status: accepted
version: 12
last_updated: 2026-10-09
---

# Camp History v12

Inherits [v11](camp-history-v11.md) visibility, live read boundaries, item/timeline/reply-chain selection,
body/author projection, attachments, quotes, pagination and withdrawn markers.

All newly invoked thread.read normal items require [Message Mentions v1](message-mentions-v1.md) mentions,
replacing addressing entirely. They never include addressing, effectiveAgentRecipients or standalone
mentionsCurrentUser. The three read modes use one Mention builder with the same body-resolved names.
No current membership filter or default-recipient body prefix is introduced.

Historical successful tool results and receipts retain their original shape, bytes and digest.
The CLI first verifies the original envelope/receipt, then validates the prior closed addressing shape
at the compatibility boundary. The live catalog remains closed over the new shape and rejects mixed
old/new metadata; no names are backfilled into replayed results.

This revision advances Agent Output **9 → 10** for the read metadata change. It supersedes that output
axis and read shape in [Transport v36](builtin-tool-transport-v36.md); transport/CLI **36**, capability
builtin_cli.transport.v36, IPC **2**, Envelope/receipt **1**, and Native Binding compatibility stay fixed.
The per-operation current output Schema and model-facing description explain IDs, names, fixed user and
the distinction from execution state. Other operation inputs/results are unchanged.
