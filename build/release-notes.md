# Rovai AI v0.0.4

Rovai AI 0.0.4 makes updates proactive, expands Camp membership management, and improves long-running collaboration reliability.

macOS arm64 and x64 builds use the same fixed Rovai Release Signing certificate as 0.0.3. Windows x64 remains an unsigned Preview build and may show a SmartScreen warning.

## What's Changed

- Proactively check for new releases and surface update prompts while keeping download, installation, and restart under explicit user control.
- Add and remove members from an existing Camp with lifecycle-safe handling for runs, deliveries, gathers, tasks, and lead replacement.
- Ingest new managed attachments without waiting for active runs or the legacy publication gate.
- Drop high-volume Codex command deltas before persistence to reduce event amplification and improve Camp recovery.
- Show the latest command in live tool activity and keep completed, failed, and stopped summaries stable.
- Preserve failed installer retries without redownloading, and keep the app usable when the native updater is unavailable.
- Coordinate Windows upgrades with planned shutdown before the installer replaces running files.
- Fix IME input after trailing newlines, make cut operations atomic, and simplify the new-conversation empty state.
- Clarify Camp member invitation and multiline message guidance.

**Full changelog:** https://github.com/murray17/rovai-ai/compare/v0.0.3...v0.0.4
