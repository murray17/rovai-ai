---
document_type: protocol-contract
contract: thread-runs-v1
authority: public-thread-execution-query
status: accepted
version: 1
last_updated: 2026-10-03
---

# Thread Runs v1

`thread.runs` / `rovai thread runs` returns live public execution and queued-work items from exactly one Thread. It uses the existing Built-in authentication and [Thread read scope](camp-history-v11.md). It does not create, claim, stop, retry or repair work. Single Chat callers are denied by their existing closed operation policy.

## Input

```ts
type ThreadRunsInput = {
  threadId?: string
  agentId?: string
  active?: boolean
  status?: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
  limit?: number
  cursor?: string
}
```

Each input uses direct flags, one JSON object from stdin, or one `--input-file`; sources cannot be combined. Flags are `--thread-id`, `--agent-id`, `--active`, `--status`, `--limit`, `--cursor`. Unknown fields and format options are rejected. Business output is JSON only.

Omitted threadId selects the authenticated current Thread. An explicit extant public Thread uses its live read boundary, including a historical Thread absent from the frozen discovery catalog. Identifiers and cursor are trimmed and cannot be empty. Agent filtering uses canonical ID, without membership or display-name lookup; an unmatched Agent returns an empty list. Status is case-sensitive.

Default active is false. Active includes domain queued/running/waiting Runs and unclaimed queued work. Explicit active and status cannot coexist, even with active:false. queued matches items with and without a Run ID. Omitted filters include all six domain states; there is no Desktop display-state mapping. Limit defaults to 20 and must be an integer from 1 to 100.

## Output

```ts
type ThreadRunsResult = {
  threadId: string
  observedAt: string
  items: Array<{
    agentRunId: string | null
    agentId: string
    status: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
    messageCount: number | null
    messagePreview: { messageId: string; text: string; truncated: boolean } | null
    waitReason: null
    cancelRequestedAt: string | null
    createdAt: string
    startedAt: string | null
    endedAt: string | null
  }>
  hasMore: boolean
  nextCursor: string | null
}
```

Every shown field is required; objects reject extra properties. Timestamps are RFC 3339 UTC. No `kind`, replacement classifier or synthetic Run ID is exposed. A non-null agentRunId references an actual Run. Null is permitted only with queued, and queued may also have a real ID. Item counts are not Run counts. waitReason:null means the interface supplies no reason, not that none exists.

Logical active state does not prove process liveness, Agent availability, old-execution isolation or eligibility to claim later messages. Run state is not Task/Mission completion evidence.

## Sources and visibility

Select public Runs before deriving count, status or preview. Resolve Thread ownership through `agent_run.camp_id`, falling back to the associated historical `camp_turn.camp_id`. Exclude both Single Chat invocation and private Conversation rows entirely.

Each Thread/Agent's current waiting Deliveries produce at most one queued item. Its count is the entire waiting set, and its creation time and preview source come from the current head by queue_sequence. Its start, end and cancellation timestamps are null. This is a query view: queued messages may be split across future Runs, and no batch is fixed in advance.

For an actual Run, count all frozen `agent_run_input` associations before checking preview visibility. Select the first input by ordinal, never by anchor, trigger, last input or logs. A legacy Run without a provable input set has null count; an unprovable first input has null preview. A current batch missing its required frozen inputs is a read failure, not an empty or legacy result.

Preview uses the same live Agent body projection as thread read. Replace each LF, CR and TAB with one space and trim leading/trailing Unicode whitespace; internal repeated spaces remain. Keep the first 200 Unicode code points. Append U+2026 `…` and set truncated:true only when more remain. A readable empty body retains messageId with text:"" and truncated:false. A missing, withdrawn, tombstoned or inaccessible first source yields null without changing input count or choosing another source. No stored summary, model call or log fallback is used.

## Consistency and pagination

Resolve scope, Runs, queues and preview sources inside one read transaction. Claim continues to atomically create a Run, freeze its inputs and update Delivery state; one response cannot count the same delivery as both waiting and claimed.

Order by creation instant descending, then internal stable identity descending. Compare UTC instants without discarding sub-millisecond precision. Internal real-Run identity is `(1, runId)` and queue identity is `(0, agentId)` within the bound Thread. The cursor binds its version, normalized Thread, Agent/status/active filters and complete last key. Omitted Thread and explicit current Thread normalize identically; omitted active and false normalize identically. Page size may change. A vanished last item does not invalidate a correctly scoped cursor. Cursors are not authorization credentials.

Return hasMore from one additional candidate and expose at most limit items. Return nextCursor:null when no further page exists. observedAt records the read view's observation time. Empty results have items:[], hasMore:false and nextCursor:null.

Execution and queues can change between pages; pagination does not guarantee complete traversal of dynamic queued work. Start at the first page when checking current state. No server snapshots, paging sessions, result caches or cross-request locks are introduced. This does not authorize polling while waiting for another Agent's reply.

## Errors and compatibility

Invalid input or mismatched/malformed cursor returns `builtin_tool.invalid_input` / `fix_input`. An unavailable/deleting Thread returns `thread.runs_unavailable` / `stop`. Caller binding, Single Chat denial, transport failure and output mismatch retain the existing safe error contracts. Raw exceptions and paths are not published.

The current catalog and Agent output projection are closed and versioned by [Built-in Transport v35](builtin-tool-transport-v35.md). Existing raw tool results and receipts remain unchanged. The query adds no database storage, migration, Session invalidation or additional permissions.
