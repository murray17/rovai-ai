---
document_type: contract
name: Runtime Launch and Verification
version: v15
status: accepted
source_version: v1.20
last_updated: 2026-08-21
---

# Runtime Launch and Verification v15

v15 replaces [v14](runtime-launch-and-verification-v14.md). Launch, readiness, Run tmp, Session, terminal failure,
non-terminal diagnostic lifecycle and public payload boundaries remain unchanged. It adds Claude Code's observed
structured `system/api_retry` stream event as the authoritative live retry source for `--print --output-format
stream-json`; the v14 bounded stderr grammar remains a compatibility fallback.

## Structured API retry event

The Adapter accepts only a session-bound stream event with all of the following fields:

```json
{
  "type": "system",
  "subtype": "api_retry",
  "attempt": 2,
  "max_retries": 10,
  "retry_delay_ms": 1124,
  "session_id": "<expected native session>"
}
```

`attempt`, `max_retries` and `retry_delay_ms` MUST be unsigned integers; attempts require
`1 <= attempt <= max_retries`. A mismatched Session is a protocol violation. Missing, malformed or out-of-range retry
fields produce no public diagnostic. Duplicate `(attempt, max_retries)` events within one stream produce at most one
diagnostic.

The public `runtime.diagnostic` remains the v14 six-field shape. `max_retries` maps to `maxAttempts`; integer
`retry_delay_ms / 1000` maps to `retryAfterSeconds`. Provider `error`, `error_status`, event UUID, Session ID and every
unknown field MUST NOT enter Execution Evidence. The diagnostic MUST be emitted as soon as the complete NDJSON event
arrives, without waiting for stream EOF, process exit or retry exhaustion.

## Compatibility fallback

The bounded stderr recognizer from v14 remains available for Claude variants that report only the fixed interactive
retry grammar. It does not override a structured event, broaden public fields or change terminal stderr capture.
Renderer grouping by the stable `diagnosticId` keeps repeated source observations from becoming multiple visible
notices.

## Acceptance

- an observed Claude Code 2.1.220 `system/api_retry` event emits the diagnostic before stdout EOF;
- attempt 2, max 10 and delay 1124 ms project to `2`, `10` and `1` second;
- `error_status`, provider error, UUID and Session ID do not enter the public payload;
- malformed counters fail closed and duplicate attempts do not duplicate the normalized event;
- v14 stderr compatibility, terminal outcome authority and Canonical Activity exclusion remain unchanged.

## References

- [Runtime Launch and Verification v14](runtime-launch-and-verification-v14.md)
- [Run Process Detail Surface v18](run-process-detail-surface-v18.md)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
