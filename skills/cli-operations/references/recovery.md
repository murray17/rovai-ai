# Recovery

Follow `error.recovery`, not guesses based on error wording:

| Recovery | Next action |
| --- | --- |
| `fix_input` | Read exact help and correct supported fields |
| `refresh_then_decide` | Read authoritative state, then decide whether a new mutation is needed |
| `retry_same_request` | Retry within the returned bounds using the same request identity |
| `stop` | Stop the operation and report that it did not commit |
| `confirm_outcome` | Check for an authoritative locator for this invocation |

## Uncertain outcome

With an authoritative ThreadMessage locator, read that stable message ID exactly and decide from its current state. The current Run may verify its own committed message; this exception does not allow a later neighborhood, reply chain, timeline, search, or another author/Run's messages. Missing downstream completion does not imply Send failure.

Without a locator, report the uncertain outcome and stop the mutation. Do not search by similar content, author or time, guess request identity, or resend with a new identity. Approximate matches prove neither success nor failure.

After recovery, verify the remaining business objective separately; CLI success does not prove tests, review or delivery.
