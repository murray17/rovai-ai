---
document_type: protocol-contract
contract: builtin-tool-transport-v35
authority: builtin-tool-transport
status: accepted
version: 35
last_updated: 2026-10-03
---

# Built-in Tool Transport v35

Inherits [v34](builtin-tool-transport-v34.md) authentication, transport, receipt and naming compatibility. Contract/CLI are 35, Agent Output is 8 and runtime capability is `builtin_cli.transport.v35`. IPC 2, Envelope 1, receipt 1 and evidence projection schema 4 stay unchanged.

Adds canonical `thread.runs` mapped to `rovai thread runs`, with the input, result and errors in [Thread Runs v1](thread-runs-v1.md). It uses canonical-result-v1 Agent output, without format options. Existing CLI family normalization remains; no camp.runs operation or campId input alias is added. Evidence projection keeps bounded identity, status, count and filter facts, not preview text.

`thread.read` collection output now requires addressing under [Camp History v11](camp-history-v11.md); withdrawn markers remain separate. Current responses undergo current closed Schema validation. Historical result blobs and their original receipts retain their bytes and digests, with no fabricated addressing backfill.

New Session Charter revision 19 adds runs to the catalog and extends the existing no-polling rule to execution status. Binding compatibility remains 16, including its frozen Bootstrap v4/Formatter 4 and Run context 26 tuple; Antigravity retains its existing tool compatibility identity. Live catalog changes do not rotate Sessions. Existing bindings resume/redeliver their frozen Bootstrap; new bindings use the new Charter with Bootstrap v5/Formatter 5. Dynamic Context versions remain unchanged.

Bundled cli-operations files update the same managed paths at Core startup and new Run preparation. Both old and new Sessions can read the new files. The frozen platform index's description is unchanged; previously read dialogue text is not rewritten. No additional migration, notification or synchronization system is introduced.
