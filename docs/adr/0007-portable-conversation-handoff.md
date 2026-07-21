---
status: accepted
version: v0.03
---

# Preserve logical Conversation continuity across Runtime changes

A Lumen Conversation remains the same logical private continuity when its effective Runtime changes. Its current Native Binding identifies an `AdapterInstallation`, that Runtime's Session ID, and an Adapter-produced compatibility digest covering the Host/Session-scoped configuration that affects resume semantics. Recovery may resume only a compatible binding; an Adapter or incompatible configuration switch creates a fresh Native Session and atomically swaps the binding only after the new session is ready.

Cross-adapter handoff carries only Lumen-owned portable context such as Conversation messages, summaries, watermarks, responsibilities, and stable references. Lumen does not promise to transfer a provider's hidden reasoning, private compaction state, undisclosed tool state, or other Runtime-internal context.
