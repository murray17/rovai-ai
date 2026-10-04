# Send

Read `rovai send --help` for current inputs. A Send can independently:

- publish a message visible to everyone in the current Thread;
- route concrete work to Agents through frozen Deliveries;
- request User attention without creating an Agent Delivery.

Use `--public-only` for a public record that must wake no Agent. Use `--to` for concrete continuing work; repeat it for parallel recipients. Replies go to the requester. Do not address Agents for acknowledgements, closure or status with no new action.

## User attention

Ordinary messages are already visible to the User. Add `--to-user` only for a new unresolved decision, answer or action, or an explicitly requested important asynchronous result notification.

Attention belongs to this message; replies, Tasks and downstream work do not inherit it. The Agent responsible for the user-facing outcome normally decides when to request attention. Internal reviewers return results to their caller; this is workflow guidance, not a Core permission rule.

Combine `--to` and `--to-user` only when each recipient has an independent action. If Agent work depends on a human decision, obtain that decision first.

A one-time answer, update, question or request uses a message. Use a [Task](task.md) only for durable, independently transferable responsibility. A Task-linked Send requires exactly one effective Agent recipient; User attention does not count.

A successful Send proves publication and its frozen effects, not that a recipient has started or finished.

## Files

Use `--file <path>` to publish a file or directory with the message; repeat it to preserve attachment order. No separate upload is required. At least one file can form a message without a body.
