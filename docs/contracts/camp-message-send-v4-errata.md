---
document_type: protocol-errata
authority: camp-message-send-v4-errata
status: accepted
last_updated: 2026-08-13
---

# Camp Message Send v4 Errata

Camp Message Send v4 input, output, addressing, persistence, errors and version remain unchanged. Its Current User
Attention lifecycle and Renderer projection now follow
[Current User Attention v2](current-user-attention-v2.md), and locator-present exact verification follows
[Built-in Tool Transport v7 Errata](builtin-tool-transport-v7-errata.md).

These corrections make the existing `--to-user` result readable and navigable as specified without adding Agent
fields or another send outcome.

## References

- [Camp Message Send v4](camp-message-send-v4.md)
- [Current User Attention v2](current-user-attention-v2.md)
- [Built-in Tool Transport v7 Errata](builtin-tool-transport-v7-errata.md)
- [ADR-0170](../versions/v0.67/decisions.md#adr-0170)
