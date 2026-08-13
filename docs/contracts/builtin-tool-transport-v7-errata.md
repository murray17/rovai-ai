---
document_type: protocol-errata
authority: builtin-tool-transport-v7-errata
status: accepted
last_updated: 2026-08-13
---

# Built-in Tool Transport v7 Errata

This errata does not change the v7 operation catalog, request/response shape, error set, CLI parser, help, capability
or version constants.

For the existing locator-present `confirm_outcome` path, exact `camp.read(mode="item")` may return the current Run's
own accepted send above its immutable history fence only under
[ADR-0170](../adr/0170-current-run-committed-self-write-exact-read.md). The returned item keeps the existing v7 shape,
including `addressing`. Every collection mode and every other post-boundary message remains unavailable.

The correction makes v7's already-required exact verification executable without widening history authority.

## References

- [Built-in Tool Transport v7](builtin-tool-transport-v7.md)
- [ADR-0170](../adr/0170-current-run-committed-self-write-exact-read.md)
- [Camp Message Send v4](camp-message-send-v4.md)
- [Current User Attention v2](current-user-attention-v2.md)
