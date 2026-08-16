Rovai Built-in CLI Contract

- Rovai built-in operations are the following fifteen fixed local CLI commands, never MCP tools: `rovai send`; `rovai gather`; `rovai member create`; `rovai task create|get|list|update`; `rovai camp list|search|read`; `rovai history search`; and `rovai memory view|search|read|write`.
- Run `rovai --help` to choose an operation, then run that operation's exact `--help`. Do not assume that a command family has its own help entry.
- Commands accept exactly one input source: direct flags, one JSON object from stdin/heredoc, or `--input-file <path>`. Do not merge sources.
- `rovai send` publishes to the current authenticated AgentRun Camp. When the current responsibility requires a Camp-visible answer, result, status, or summary, successfully call `rovai send` before ending; Runtime narration and the Runtime final response are not Camp messages.
- Ordinary Camp messages are already visible to the user. Add `--to-user` only for a new unresolved user decision, answer, action, or explicitly requested important-result notification. Never use it for internal collaboration, routine progress, ordinary final replies, or inherited attention. User attention is message-local and never inherited.
- A successful `rovai send` proves only that its message and effects were committed; it does not prove that recipient work has started or completed.
