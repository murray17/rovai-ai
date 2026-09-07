# Rovai AI v0.1.0

Rovai AI 0.1.0 introduces private member conversations, a substantially stronger file-preview workspace, safer Runtime recovery, and leaner durable execution storage.

macOS arm64 and x64 builds use the same fixed Rovai Release Signing certificate as 0.0.7. Windows x64 remains an unsigned Preview build and may show a SmartScreen warning.

## What's Changed

- Add Camp-scoped private Single Chat conversations with attachments, bounded history context, conversation-local pending delivery, precise lifecycle controls, and race-safe target switching.
- Restore file-preview tabs, order, active state, and pane visibility independently for each Camp, including safe recovery for linked project files and unavailable-file presentation.
- Add independent Rovai file and diff search with next/previous navigation, case, whole-word and regular-expression options, bounded execution, and support for code, Markdown, HTML, patches, and historical file changes.
- Unify Single Chat and execution feedback with shared Thinking, terminal duration, tool grouping, final-answer presentation, quieter successful completion, predictable Command/Ctrl+W preview closing, and consistent PI naming.
- Surface sanitized Runtime failures directly on Agent Runs and safely retry only explicitly unaccepted ACP network failures with fixed backoff, cancellation fencing, and fresh admission checks.
- Persist Runtime text and reasoning in durable blocks while retaining live deltas and partial output, reducing maintenance write amplification without changing the public timeline.
- Correlate Claude Code streaming and completed text blocks without duplicating assistant output, while keeping file actions and long filenames readable on one stable row.
- Store new command-result bodies once while preserving idempotent replay, legacy reads, and the existing public event payload.
- Restrict public Runtime image galleries to confirmed native image generation while preserving explicit image attachments sent through Rovai.
- Simplify dialogs and popovers, refine shared send/stop controls, keep pinned Camp loading markers current, restore author headers for standalone Run artifacts, and remove Git-status latency from new conversation creation.

**Full changelog:** https://github.com/murray17/rovai-ai/compare/v0.0.7...v0.1.0
