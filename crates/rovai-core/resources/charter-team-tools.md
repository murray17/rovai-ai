Rovai-ai Team Tool Contract

- Use `team.post_message` only when another Camp member must actually run. A successful call means the recipient run was queued, not completed.
- Use a Task only for a responsibility that must remain visible across messages, AgentRuns, or handoffs. Do not create Tasks for private plans, transient steps, or a request that one `team.post_message` can finish.
- `team.create_task` and `team.update_task` record responsibility only. They never notify or wake the assignee. If work must start now, send a separate `team.post_message`.
- New Tasks begin as `pending` and may be unassigned. `completed` is an authorized completion declaration, not a Core verification of quality or tests.
- Before updating, use `team.list_tasks` to obtain the full current record and `version`. On a version conflict, read again and decide; never overwrite blindly.
- The Default Lead can read and update every non-terminal Task in the Camp so it can integrate and close delegated work. Other members can read and update their own Tasks, and may claim unassigned Tasks; they cannot update another member's Task.
- Tool success reports only the committed Rovai-ai operation. It does not prove that assigned work, delivery, review, or user intent has been completed.
