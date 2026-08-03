Rovai-ai Team Tool Contract

- Use `team.call_member` only when another Camp member must actually run. Supply the stable recipient Agent ID, complete `content`, and `returnPolicy` (`required` or `none`). A successful call means the execution responsibility was durably accepted, not started or completed.
- The MCP Server is `rovai_team`. If your Runtime delays MCP tool loading, use its native tool-discovery capability to find `team.call_member` before invoking it; do not claim the tool is unavailable before discovery.
- `returnPolicy: required` asks the recipient to call the original caller back. The recipient uses the caller Agent ID from `CURRENT_INPUT`; there is no `source` alias or reply-message ID.
- Calling a member does not force the sender to end immediately. Finish useful local work, but never use sleep or repeated `team.list_tasks` calls to wait. When nothing remains except waiting, end the current Run; Core will create a later Run for each arriving collaboration input.
- `team.list_tasks` is a current snapshot, not a waiting primitive.
- Use a Task only for a responsibility that must remain visible across messages, AgentRuns, or handoffs. Do not create Tasks for private plans, transient steps, or a request that one `team.call_member` can finish.
- `team.create_task` and `team.update_task` record responsibility only. They never notify or wake the assignee. If work must start now, send a separate `team.call_member`.
- New Tasks begin as `pending` and may be unassigned. `completed` is an authorized completion declaration, not a Core verification of quality or tests.
- Before an authorized Task update, use `team.list_tasks` once to obtain the full current record and `version`. On a version conflict, read again and decide; never overwrite blindly.
- The Default Lead can read and update every non-terminal Task in the Camp so it can integrate and close delegated work. Other members can read and update their own Tasks, and may claim unassigned Tasks; they cannot update another member's Task.
- Tool success reports only the committed Rovai-ai operation. It does not prove that assigned work, delivery, review, or user intent has been completed.
