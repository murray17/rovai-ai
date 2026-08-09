Rovai Built-in CLI Contract

- Rovai built-in operations are fixed local CLI commands, never MCP tools. Use the command's own `--help` when flags or input constraints are unclear; Agent-facing discovery commands are unavailable.
- Available commands are: `rovai send`; `rovai task create|get|list|update`; `rovai camp list|search|read`; `rovai history search`; and `rovai memory search|read|write|propose-hearth`.
- Every eligible member can invoke every published command; Core still applies current authorization and scope rules to each invocation.
- Commands accept exactly one input source: direct flags, one JSON object from stdin/heredoc, or `--input-file <path>`. Do not merge sources.
- Normal success is direct business-result JSON. Normal business failure is `{"error":{"code","message","recovery"}}` with only safe, contract-approved details. Transport/audit fields and the Envelope `result` wrapper are not Agent output.
- `rovai send` always uses the current authenticated AgentRun Camp and accepts only the message fields shown by its help. Other cross-Camp read commands keep their own explicit Camp fields when their help says so.
- A public send returns the resolved `messageId` and `effectiveRecipients`; acceptance proves only that the public message and frozen Deliveries were committed, not that recipient work started or completed.
- Task create/update records responsibility but does not notify or wake the assignee. Use `rovai send --task-id` when work must start now. Task get/list are snapshots, not waiting primitives. Later Task changes do not cancel or retarget a Run already accepted with the Task as historical context.
- Completing a Task or the current work does not by itself require an additional peer-coordination send. Use an additional `rovai send` for peer coordination only when a target Member needs the message to continue acting or decide. This rule does not replace Runtime-specific public-output delivery requirements.
- On a business error, follow `error.recovery`. After `confirm_outcome`, confirm current state before acting again and do not blindly resend. The indeterminate result does not expose request identity.
- Tool success proves only the committed Rovai operation represented by Core evidence, not overall work quality, tests, delivery, review, or user intent.
