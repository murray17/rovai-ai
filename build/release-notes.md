# Rovai AI v0.0.7

Rovai AI 0.0.7 adds the Pi coding agent, strengthens Camp message composition and attachment handling, and makes conversations easier to read and navigate.

macOS arm64 and x64 builds use the same fixed Rovai Release Signing certificate as 0.0.6. Windows x64 remains an unsigned Preview build and may show a SmartScreen warning.

## What's Changed

- Add and qualify the Pi coding agent on macOS arm64, macOS x64, and Windows x64, with native execution, lifecycle ownership, runtime capabilities, private storage, and platform-specific verification.
- Replace the Camp composer with structured Text + Atom editing, a single Core-owned draft authority, safer synchronization, and reliable publication of attachment-only pending messages.
- Persist the latest draft before Camp navigation, app quit, and macOS window close so accepted exits no longer lose recent composition state.
- Preserve source attachments, unify pending and published attachment cards, partition Runtime attachments by author, and make file-drop routing consistent.
- Improve conversation reading with automatic history loading, stable prepend anchors, remembered timeline positions, clearer Markdown code layers, compact user bubbles, and refined long-message actions.
- Tighten explicit Markdown file-link recognition and resource opening, with clearer file-type and preview-tab icons while preserving the existing safe-open boundary.
- Stabilize Sidecar project order, reduce execution-detail rendering cost, and place agent actions after complete output.
- Show each Camp member's configured team role in the `@` mention picker, with a clear fallback when no role is configured.

**Full changelog:** https://github.com/murray17/rovai-ai/compare/v0.0.6...v0.0.7
