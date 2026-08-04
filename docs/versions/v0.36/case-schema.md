---
document_type: schema-contract
version: v0.36
authority: qualification-case-v3
status: frozen
last_updated: 2026-08-04
---

# Qualification Case manifest v3

JSON Schema 真源位于 [`schemas/qualification-case-manifest-v3.schema.json`](schemas/qualification-case-manifest-v3.schema.json)
与 [`schemas/challenge-manifest.schema.json`](schemas/challenge-manifest.schema.json)。本文记录跨字段不变量；
仅通过 JSON Schema 不代表 Case 可 admission。

## Manifest shape

```json
{
  "schemaVersion": 3,
  "id": "DC-001",
  "version": "1.0.0",
  "visibility": "diagnostic",
  "title": "Multi-version event normalization pipeline",
  "tags": ["javascript", "collaboration-value", "data-pipeline"],
  "fixtureDirectory": "fixture",
  "promptFile": "prompt.txt",
  "verifierFile": "verifier.mjs",
  "referenceDirectory": "reference",
  "challengeManifestFile": "challenge-manifest.json",
  "requirements": [],
  "verificationCatalog": [],
  "expectedInitialFailureCheckIds": [],
  "publicChecks": [],
  "allowedPaths": ["src/**", "tests/agent/**"],
  "forbiddenPaths": ["tests/public/**", "fixtures/**", "package.json", "README.md"],
  "temporalWritePolicy": "final_tree",
  "toolchain": {
    "runtime": "node",
    "minimumMajorVersion": 26,
    "verificationProfileVersion": 1,
    "publicCheckTimeoutMs": 30000,
    "verifierTimeoutMs": 60000,
    "maxOutputBytes": 1048576
  },
  "budget": {
    "elapsedSeconds": 900,
    "maxAgentRuns": 8,
    "maxAcceptedA2a": 7
  }
}
```

`temporalWritePolicy` 只允许 `final_tree` 或 DC-004 的 `workspace_root_only`。后者由 Case API 的
auditable filesystem behavior验证，不表示Runner拥有完整host writer attribution。

## Closed invariants

1. Requirement数量恰为6，ID按Case绑定并且category顺序固定为
   `workstream_a|workstream_b|workstream_c|integration|regression|change_boundary`。
2. 每个Requirement都是Hard Gate；criticality只允许failure triage，不改变pass公式。
3. publicChecks恰为5，R1～R4各一个`initialExpectation=fail`，R5一个`pass`。
4. public Check command以逻辑`node`开始，只使用Node test runner和Case内protected test locator；
   R5同时包含`tests/agent/**/*.test.mjs`。
5. R1～R4各有`runner/public_check`与`verifier/withheld`两个不同Hard Check；R5有一个
   `runner/public_check` Hard Check；R6恰有一个`runner/change_boundary` Hard Check。
6. `expectedInitialFailureCheckIds`等于初始fixture实际失败Hard Check集合，不是subset hint。
7. `allowedPaths`、`forbiddenPaths`、toolchain和budget必须与上例固定值一致。
8. Manifest中出现`collaboration`或未知字段即失败。

## Challenge Manifest

```json
{
  "schemaVersion": 1,
  "caseId": "DC-001",
  "caseVersion": "1.0.0",
  "manifestCanary": "SCM-<high-entropy-token>",
  "referenceCanaryFile": "reference/.rovai-sealed-canary",
  "verifierCanary": "SCM-<different-token>",
  "verificationPairs": [
    {
      "requirementId": "REQ-DC001-R1",
      "publicCheckId": "CHK-DC001-R1-PUBLIC",
      "withheldCheckIds": ["CHK-DC001-R1-WITHHELD"],
      "publicAssertionDigest": "sha256:<public-test-bytes>",
      "withheldAssertionDigest": "sha256:<withheld-section-bytes>"
    }
  ],
  "mutants": [
    {
      "mutantId": "MUT-DC001-PUBLIC-OVERFIT",
      "faultClass": "public_overfit",
      "directory": "mutants/public-overfit",
      "canaryFile": "mutants/public-overfit/.rovai-sealed-canary",
      "expectedFailingCheckIds": ["CHK-DC001-HID-R2"]
    }
  ]
}
```

至少三个Mutant覆盖`public_overfit`、`domain_edge`、`regression_or_boundary`。所有Canary token必须不同、
至少128 bit entropy且只存在private Pack。Mutant overlay和reference overlay必须过滤sidecar Canary。

## Seal v3

Case Seal canonical input至少绑定：

- manifest、fixture tree、prompt、verifier、requirements、Catalog、public Check contract；
- allowed/forbidden/temporal boundary、toolchain和budget；
- reference tree与两次normalized observation；
- Challenge Manifest、每个Mutant overlay tree、两次normalized observation和exact failure set；
- Hermetic Verification Profile、non-leakage policy和Case schema identities。

Seal和admission使用exclusive private write。已有Seal内容不同即失败，不覆盖。

## v2 compatibility

schemaVersion 2继续使用原字段、public baseline expectation、Case ID范围、Seal算法和admission record。
v3 code不得给v2增加默认`initialExpectation`后重写其identity。v0.36 schema catalog不收录或复制v0.34
历史artifact；reader通过显式version dispatch复用原validator。
