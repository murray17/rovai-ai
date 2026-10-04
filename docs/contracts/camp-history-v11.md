---
document_type: protocol-contract
contract: camp-history-v11
authority: public-camp-history-read-scope
status: accepted
version: 11
last_updated: 2026-10-03
---

# Camp History v11

Inherits [v10](camp-history-v10.md) visibility, live read boundaries, paging, attachments, quotes and withdrawn markers, with [Thread naming](thread-naming-v1.md). This revision adds the existing addressing projection to every normal timeline and reply-chain item. Exact-item addressing is unchanged.

```ts
type MessageAddressing = {
  effectiveAgentRecipients: string[]
  mentionsCurrentUser: boolean
}
```

Normal read items require addressing. Recipients come from the message's persisted effective recipients; mentionsCurrentUser comes from structured content. Empty values are [] and false. Reads do not parse recipients from body text, recompute them from current membership or infer user visibility from mentionsCurrentUser.

Withdrawn items retain exactly messageId, sequence, withdrawn:true and displayText:"Message withdrawn". They contain no addressing. Historical successful tool results and their receipts are not backfilled. Input parameters and all other normal-item fields remain unchanged.

[Thread Runs v1](thread-runs-v1.md) reuses this read scope and body projection for a separate, read-only execution query; it does not alter message timelines or frozen Run inputs.
