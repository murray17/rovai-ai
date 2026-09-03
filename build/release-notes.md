# Rovai AI v0.0.6

Rovai AI 0.0.6 improves persistent Camp controls, safer resource navigation, trustworthy Runtime compaction visibility, and DingTalk channel management.

macOS arm64 and x64 builds use the same fixed Rovai Release Signing certificate as 0.0.5. Windows x64 remains an unsigned Preview build and may show a SmartScreen warning.

## What's Changed

- Keep execution, task, and member detail popovers open while you work elsewhere, with explicit dismissal from the active entry, close button, or Escape.
- Fix the shared-memory review drawer layering so its content stays visible and interactive above the page overlay.
- Recognize local resources only from explicit Markdown links or whole inline-code references, with clearer file-type and web-link icons and the existing safe-open boundary preserved.
- Show explicitly attributable Runtime compaction as a standalone non-Tool execution row with bounded token or summary details, neutral imminent state, and active started state.
- Keep compaction display tied to existing native Runtime events without installing display-only hooks, plugins, or configuration overlays.
- Add durable DingTalk multi-bot aggregation, ordered target admission, restart-safe collection, replay deduplication, bounded parent-message context, and privacy-safe diagnostics.
- Open DingTalk as a selectable channel provider with typed account, connection, Bot, and management-link controls, while unsupported attachment and native-interaction capabilities remain independently gated.

**Full changelog:** https://github.com/murray17/rovai-ai/compare/v0.0.5...v0.0.6
