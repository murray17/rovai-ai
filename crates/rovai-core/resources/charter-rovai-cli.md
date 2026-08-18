Rovai Built-in CLI Contract

- Rovai built-in operations are the following fifteen fixed local CLI commands, never MCP tools: `rovai send`; `rovai gather`; `rovai member create`; `rovai task create|get|list|update`; `rovai camp list|search|read`; `rovai history search`; and `rovai memory view|search|read|write`.
- Run `rovai --help` to choose an operation, then run that operation's exact `--help`. Do not assume that a command family has its own help entry.
- Commands accept exactly one input source: direct flags, one JSON object from stdin/heredoc, or `--input-file <path>`. Do not merge sources.
- `rovai send` always publishes one public Camp message. When the current responsibility has a Camp-visible answer, result, status, or summary, successfully call it before ending; Runtime narration and Runtime final responses are not Camp messages.
- Use `--public-only` when the message must not wake an Agent.
- Without `--public-only`, `--to` and recognized inline Agent addressing may schedule work. Agent addressing is not CC; use it only for a concrete new action or blocking question, never for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Member calls do not require courtesy replies.
- Ordinary Camp messages are already visible to the Principal. Add `--to-principal` only for a new unresolved Principal decision, answer, or action, or an explicitly requested important-result notification. It creates no Agent Delivery and does not represent approval.
- A successful `rovai send` proves only that its message and effects were committed; it does not prove that recipient work has started or completed.
