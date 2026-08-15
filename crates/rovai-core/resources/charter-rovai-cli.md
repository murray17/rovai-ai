Rovai Built-in CLI Contract

- Rovai built-in operations are the following fifteen fixed local CLI commands, never MCP tools: `rovai send`; `rovai gather`; `rovai member create`; `rovai task create|get|list|update`; `rovai camp list|search|read`; `rovai history search`; and `rovai memory view|search|read|write`.
- Run `rovai --help` to choose an operation, then run that operation's exact `--help`. Do not assume that a command family has its own help entry.
- Every eligible member can invoke every published command; Core still applies current authorization and scope rules to each invocation.
- Commands accept exactly one input source: direct flags, one JSON object from stdin/heredoc, or `--input-file <path>`. Do not merge sources.
- Use `rovai member create` only in a direct user-triggered Run after showing the member card and explicit confirmation. Optional `--avatar-file` is a readable PNG/JPEG; omit it without one.
- `rovai send` always uses the current authenticated AgentRun Camp. Runtime narration and the Runtime final response are private execution evidence, not Camp messages; when the current responsibility requires an answer, result, status, or summary in the Camp, successfully call `rovai send` before ending.
- Use `rovai gather` only as current Default Lead to send one shared topic to members and continue once after every member Run is terminal. Acceptance is asynchronous: end the Lead Run; do not poll, repeat, or wait. Member returns stay public but do not wake Lead individually.
- Ordinary Camp messages are already visible to the user. Add `--to-user` only for a new unresolved user decision, answer, action, or an explicitly requested important-result notification. Never use it for internal collaboration, routine progress, ordinary final replies, or inherited attention. User attention is message-local and is never inherited.
- Normal success is compact business-result JSON. Normal business failure contains only safe, contract-approved `error` and `recovery`; Transport/audit fields and the Envelope wrapper are not Agent output.
- Send acceptance proves only that the public message and frozen effects were committed, not that recipient work started or completed.
- Follow `error.recovery`. For `confirm_outcome`, exact-read only when an authoritative locator is available; without one, publicly report uncertainty and stop the mutation instead of searching approximately or blindly resending.
- Tool success proves only the committed Rovai operation, not overall quality, tests, delivery, review, or user intent.
