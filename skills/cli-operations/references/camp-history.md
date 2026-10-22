# Thread and history

Choose the narrowest scope that answers the question:

| Need | Command |
| --- | --- |
| Find accessible Threads or a Thread ID | `rovai thread list --help` |
| Search the current Thread | `rovai thread search --query "amount"` |
| Search a known historical Thread | `rovai thread search --thread-id <thread-id> --query "amount"` |
| Read messages or their addressing | `rovai thread read --help` |
| Check who is running, queued or waiting | `rovai thread runs --help` |
| Find a message whose Thread is unknown | `rovai history search --help` |

## Read messages

Bare `rovai thread read` returns the latest 20 visible messages. `--thread-id` selects one public Thread; reads use its live state, including historical Threads. Target membership is not a read permission. New Runs list Threads live; cross-Thread message searches retain the Run's frozen boundary.

```bash
rovai thread read --after <lastProcessedSequence>
rovai thread read --before <nextCursor>
rovai thread read --message-id <message-id>
rovai thread read --reply-chain <message-id> --limit 20
```

For timeline or reply-chain pages, use `--before` for older messages or `--after` for newer messages, excluding the given sequence. Use only one flag; while hasMore, pass nextCursor with that same flag. Exact messageId cannot combine with replyChain, before, after or limit; there are no mode or direction input fields.

For later incremental reads, reuse the last successfully processed sequence for the same Thread and scope; keep it on empty pages. hasMore=false describes this read only.

Normal items include mentions: Agent {id,name} entries are saved effective recipients; {id:"user"} marks a structured current User mention. Withdrawn markers have no mentions. Mentions do not prove reading or execution.

When the Thread is unknown, use history search to obtain threadId and messageId, then read that pair. Once the Thread is known, search there if needed. A message ID alone does not search across Threads.

## Read execution state

```bash
rovai thread runs --active
rovai thread runs --agent-id <agent-id> --active
```

Read items by agentId, status and messagePreview. A non-null agentRunId identifies a real Run; a null ID means queued messages not yet assigned to a Run. Queued messages may be split across future Runs. waiting remains distinct from queued.

waitReason:null means this interface does not provide reasons. A preview is the first message readable now, not a work summary. Use the exact help for filters, fields and pagination. Query for a needed status answer; do not poll while waiting for another Agent's reply.

## Scope and recovery

Cross-Thread search requires a real need for wider history. An uncertain mutation outcome follows [Recovery](recovery.md); similar text, author or time cannot prove invocation identity. Send always uses the authenticated current Thread and accepts no caller-supplied Thread ID.
