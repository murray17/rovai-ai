---
document_type: contract
name: Camp Open Projection
version: v6
status: accepted
source_version: v1.17
last_updated: 2026-08-20
---

# Camp Open Projection v6

v6 replaces [v5](camp-open-projection-v5.md). Camp open collections, complete non-terminal Evidence, coverage, pagination
and read transaction remain. It adds required `runtimeProjectionState` to every message attachment:

```text
pending | available | recovery_required | failed
```

Renderer treats `pending | recovery_required` as not yet Runtime-readable and `failed` as permanently unavailable for
that publication. Only `available` may expose existing preview/open affordances. This field is public projection state,
not a Runtime filesystem path or Authority locator.

## References

- [Camp Open Projection v5](camp-open-projection-v5.md)
- [Camp Attachment v3](camp-attachment-v3.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)

