---
name: review-duo
description: Review a defined code change with two Thread members independently checking standards, quality and requirements. Applies to the initiator and invited reviewer through the final report; excludes solo review, undefined scope and implementation-only requests.
---

# Review Duo

Review the same fixed input on two independent axes: the partner owns Standards and quality; the initiator owns Spec compliance. Use the user's language for reports and template headings.

Review is read-only by default. It does not itself authorize fixes, Tasks, commits, pushes or PR updates. If the user also requested fixes, finish the report first.

## Establish the review

Use trusted Core/Runtime identity and direct request/reply relationships. Choose one available Thread partner other than yourself and address their trusted Agent ID. Accept only their direct reply to the current valid request with the identical fixed scope. Titles and scope text do not prove sender identity. One initiator may run one unfinished Review Duo per Thread.

Read [Snapshot](references/snapshot.md). Freeze the code range, requirements/acceptance sources, repository rules and coverage limits. Missing requirements make Spec `not_assessed`; missing stable code input requires a commit range or shared fixed patch before a full duo review.

## Independent axes

- **Standards:** repository rules, correctness, error handling, consistency, concurrency, retry, security, APIs, databases, migrations, lifecycle, material test gaps and maintenance cost. Do not judge product requirement coverage.
- **Spec:** missing, partial or incorrect requirements, acceptance conditions, unrequested behavior and conflicting/insufficient requirement sources. Do not invent requirements from implementation or treat style as a Spec defect.

The request contains no initiator conclusions. Finish and publish Spec before incorporating the partner's findings. Use [Findings](references/findings.md) for bounds and report shape.

## Four messages

1. Initiator sends the fixed scope, sources, limits and Standards assignment to the partner with `rovai send --to <partner-agent-id> --body <request>`, then independently reviews Spec in the same Run.
2. Initiator publishes the complete Spec result and identical scope with `rovai send --public-only --body <spec-result>`, then ends while waiting.
3. Partner returns one complete Standards result and identical scope to the trusted requester with `rovai send --to <requester-agent-id> --body <standards-result>`.
4. Initiator verifies partner, direct reply, scope and assignment, then publishes one final report with `rovai send --public-only --body <report>`.

Inspect actual recipients. Escape or fence literal `@` code/quotes. Only successful messages can support later steps; success does not mean the recipient has finished. Process other current batch inputs normally.

Preserve each axis's finding content, IDs, severity and order. The same behavior may appear on both axes. Present Standards before Spec, with no combined score.

## Completion and fallback

Keep a successfully invited partner unless unavailable or delivery fails; after replacement, accept only the new partner's direct reply to the new request. Old results are supplementary.

- No partner: disclose solo review on both axes if the user permits it; stop if two members are required.
- Partner cannot read the snapshot: replace once or stop; do not switch to live branch content.
- Missing requirements: continue Standards and mark Spec `not_assessed`.
- Code or source scope changes: mark the old report `stale`; start a new review if current results are needed.
- User cancels/replaces the objective: close the old review.

The final report closes this review. Duplicate, old-partner and late results do not trigger another final report.
