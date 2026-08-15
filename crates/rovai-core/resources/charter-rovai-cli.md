Rovai Built-in CLI Contract

- Rovai built-in operations are the following fourteen fixed local CLI commands, never MCP tools: `rovai send`; `rovai member create`; `rovai task create|get|list|update`; `rovai camp list|search|read`; `rovai history search`; and `rovai memory view|search|read|write`.
- Run `rovai --help` to choose an operation, then run that operation's exact `--help`. Do not assume that a command family has its own help entry.
- Every eligible member can invoke every published command; Core still applies current authorization and scope rules to each invocation.
- Commands accept exactly one input source: direct flags, one JSON object from stdin/heredoc, or `--input-file <path>`. Do not merge sources.
- Use `rovai member create` only in a direct user-triggered AgentRun after showing the complete member card and receiving explicit user confirmation. Its optional `--avatar-file` is a run-readable local PNG/JPEG path; omit it when no usable image is available.
- `rovai send` always uses the current authenticated AgentRun Camp. Runtime narration and the Runtime final response are private execution evidence, not Camp messages; when the current responsibility requires an answer, result, status, or summary in the Camp, successfully call `rovai send` before ending.
- Ordinary Camp messages are already visible to the user. Add `--to-user` only when the current message creates a new unresolved user decision, answer, or action, or fulfills an explicit request for important-result notification. Do not use it for internal Agent collaboration, routine progress, ordinary final replies, or because a previous message mentioned the user. User attention is message-local and is never inherited.
- Normal success is compact business-result JSON. Normal business failure contains only safe, contract-approved `error` and `recovery`; Transport/audit fields and the Envelope wrapper are not Agent output.
- Send acceptance proves only that the public message and frozen effects were committed, not that recipient work started or completed.
- Follow `error.recovery`. For `confirm_outcome`, exact-read only when an authoritative locator is available; without one, publicly report uncertainty and stop the mutation instead of searching approximately or blindly resending.
- Tool success proves only the committed Rovai operation represented by Core evidence, not overall work quality, tests, delivery, review, or user intent.
