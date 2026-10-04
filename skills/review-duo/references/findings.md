# Findings and reports

Report a locatable problem with evidence or a rule, real impact and a useful correction. Exclude preferences, harmless observations and duplicates within an axis.

Per axis: at most 8 findings, ordered by severity and impact. Each problem/evidence/impact/recommendation field uses 1-2 sentences. Aim for 2,000-2,500 Chinese characters, or comparable brevity in the user's language. If important evidence will not fit, mark `partial`, state coverage limits and suggest a narrower review.

| Severity | Meaning |
| --- | --- |
| `blocker` | Unsafe to merge; severe data, security or core-requirement failure |
| `high` | Major functional error, persistent inconsistency or missing key requirement |
| `medium` | Important boundary, maintenance or test risk usually needing a pre-merge fix |
| `low` | Local quality or clarity issue with concrete value |

## Finding

Use `STD-01` for Standards or `SPEC-01` for Spec, preserving stable IDs. Spec also names the requirement ID. Localize labels, not identifiers:

```markdown
### STD-01 / SPEC-01: high
Location: `path/to/file.ts:42`
Requirement: `REQ-03` (Spec only)
Problem: ...
Evidence: ...
Impact: ...
Recommendation: ...
Needs verification: <only when evidence is insufficient>
```

## Complete axis result

Title the result Standards and quality or Spec compliance, in the user's language:

```markdown
Scope: <fixed identifier>
Reviewer: <member>
Status: complete | partial | blocked | not_assessed
Finding count: <0-8>

Findings:
<full findings, or no reportable findings>

Coverage and limits:
- Reviewed: ...
- Not reviewed: ...
- Not run: ...
```

Standards cannot be `not_assessed`. Zero findings does not prove correctness; retain coverage limits. Carry only the fixed scope, without extra correlation keys, result fragments or manifests.

## Final report

Present Standards first, then Spec:

```markdown
# Review Duo result
Scope: <fixed identifier>
Mode: duo | solo fallback
Freshness: current | stale

## Standards and quality
Reviewer: ...
Status: complete | partial | blocked
Finding count: ...
Key findings: <at most 3; original order, ID, severity and problem statement>
Coverage limits: ...

## Spec compliance
Reviewer: ...
Status: complete | partial | blocked | not_assessed
Finding count: ...
Key findings: <at most 3; original order, ID, severity and problem statement>
Coverage limits: ...

## Overall limits
Not reviewed: ...
Not run: ...
Full findings remain in the two preceding axis results.
This report applies only to the fixed scope above.
```

Do not repeat both full finding lists, merge/delete/renumber findings across axes, change severity, or produce a combined score that hides either axis.
