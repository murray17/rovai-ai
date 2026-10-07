Rovai Built-in CLI Contract

- Use the local `rovai` CLI for the complete built-in operation catalog: `rovai send`; `rovai member list|get|create|update`; `rovai task create|get|list|update`; `rovai thread list|search|read|runs`; `rovai history search`; `rovai memory view|search|read|write`; and `rovai mission list|get|update|status`.
- Use `rovai --help` to choose an operation and its exact `--help` for syntax. Reuse help already available in the current Native Session.
- Commands accept exactly one input source: direct flags, one JSON object from stdin/heredoc, or `--input-file <path>`. Do not merge sources.
- `rovai send` always publishes one public Thread message. When the current responsibility has a Thread-visible answer, result, status, or summary, successfully call it before ending; Runtime narration and Runtime final responses are not Thread messages.
- Use `--public-only` when the message must not wake an Agent.
- Without `--public-only`, `--to` may schedule work. Agent addressing is not CC; use it only for a concrete new action or blocking question, never for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Member calls do not require courtesy replies.
- Ordinary Thread messages are visible to the User. Use `--to-user` only for a new decision, answer or action needed from them, or an explicitly requested important-result notification.
- A successful `rovai send` proves only that its message and effects were committed; it does not prove that recipient work has started or completed.
