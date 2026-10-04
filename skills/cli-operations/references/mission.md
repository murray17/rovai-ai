# Mission

Get a known Mission directly; list only to discover one. Reading another Mission does not switch context: update/status still affect the current public Thread's Mission.

`sourceMessageId` is optional for every status, including `needs_you` and `completed`. Update status directly; link a relevant existing public message only when useful. A Mission owns the shared objective; a Task owns independently transferable responsibility. Do not automatically create a duplicate Task. Edit only the established objective and requirements.

Choose status for the whole Mission:

| Status | Meaning |
| --- | --- |
| `not_started` | Work has not begun or has returned to scheduling |
| `in_progress` | Work is advancing, including normal waits without User intervention |
| `needs_you` | The User must answer, decide or act |
| `completed` | The entire objective has been delivered |

A local assignment or Run ending does not complete the Mission. Explaining an existing result does not reopen it. A public message or `--to-user` does not itself change status; call `mission status` only when the whole Mission's state changes.

On a request to start the Mission, read its full current definition with `mission get` first. For other messages, follow the actual current input. Submit only changed fields; later writes to the same field win, with no version parameter. Use [Recovery](recovery.md) for uncertain results.
