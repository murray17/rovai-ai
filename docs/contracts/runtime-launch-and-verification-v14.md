---
document_type: contract
name: Runtime Launch and Verification
version: v14
status: accepted
source_version: v1.20
last_updated: 2026-08-21
---

# Runtime Launch and Verification v14

v14 replaces [v13](runtime-launch-and-verification-v13.md). Machine Ready, dispatch admission, exact Camp Attachment
root, exact writable Run tmp, Host compatibility, Session continuity and terminal failure semantics remain unchanged. It
adds a narrow live diagnostic boundary for a Runtime-owned retry that happens before the Runtime process exits.

## Live Runtime retry diagnostic

When Claude Code writes its known API retry status to stderr while the child process remains alive, the Adapter MAY
publish `runtime.diagnostic` immediately. Recognition MUST be bounded and fail closed: after terminal-control removal,
the line must contain the fixed API-error/retrying grammar and a valid `attempt N/M` with `1 <= N <= M`. The Adapter
MUST preserve the existing bounded stderr capture, byte count and digest used by terminal diagnostics; live recognition
does not consume, rewrite or promote raw stderr.

The public payload is restricted to:

```json
{
  "diagnosticId": "claude-api-retry",
  "code": "runtime_api_retrying",
  "status": "retrying",
  "attempt": 1,
  "maxAttempts": 10,
  "retryAfterSeconds": 0
}
```

Raw stderr, provider response bodies, prompts, credentials, environment values, usernames and filesystem paths MUST
NOT enter Runtime Evidence through this projection. Unknown wording, malformed counters and a generic API error without
the complete retry grammar produce no public diagnostic.

## Lifecycle and evidence semantics

`runtime.diagnostic` is non-terminal Execution Evidence. It does not prove input completion, change AgentRun status,
settle the Runtime process or create Canonical Tool Activity. Repeated attempts MAY create durable Evidence records;
the Renderer groups them by `diagnosticId` and presents the latest valid attempt for the active Run.

If the Runtime later succeeds, fails, is cancelled or otherwise becomes terminal, that terminal authority remains the
only Run outcome. The live retry diagnostic must not replace the existing safe public terminal failure. A terminal Run
does not continue displaying the stale live retry notice.

## Acceptance

- a known ANSI-decorated retry line emits a safe diagnostic before stderr reaches EOF and before child exit;
- `attempt`, `maxAttempts` and retry delay are exact non-negative integers with valid bounds;
- generic or malformed API-error text emits no diagnostic;
- public Evidence contains only the six allowlisted fields and no raw provider text or credential;
- the diagnostic is durable, live-restorable and excluded from Canonical Activity;
- process exit, terminal failure, cancellation and Session verification keep their existing authority.

## References

- [Runtime Launch and Verification v13](runtime-launch-and-verification-v13.md)
- [Run Process Detail Surface v18](run-process-detail-surface-v18.md)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
- [产品/执行表面不变量](../architecture/foundational-invariants.md#product-execution-surface)
