---
document_type: schema-contract
version: v0.36
authority: diagnostic-portfolio
status: frozen
last_updated: 2026-08-04
---

# Diagnostic Portfolio schema family

JSON Schema 真源位于本目录的 [`schemas/`](schemas/)；所有artifact使用closed object、canonical JSON digest
和显式schema identity。Private Case locator不是任何artifact字段。

## Definition

Definition固定`DCP-001@1.0.1`、四个按Case ID排序的`DC-001`～`DC-004` Seal、每Case两个repeat slot、
四成员team configuration、统一budget、observable execution fingerprints、v0.34/v0.36 schema catalog
fingerprints、Judge policy和non-leakage policy。

Definition生成后使用exclusive create。`definitionDigest`覆盖除自身外的完整canonical payload。任何Case、
team、budget、toolchain或policy变化都创建新Portfolio version。

## Ledger event

每个event包含：

- `schemaVersion=1`、Portfolio binding；
- monotonic `sequence`、stable `eventId`、`previousEventDigest`；
- `slotId`、`attemptId`和可选`relatedAttemptId`；
- closed `eventType`和对应typed payload；
- producer、occurredAt、payloadDigest与eventDigest。

Event文件名由zero-padded sequence与eventId派生，使用`wx`创建。Loader拒绝gap、fork、duplicate、unknown
transition和digest mismatch。`portfolio-status.json`没有authority，可随时从Ledger重建。

## Hard Outcome Fingerprint

Fingerprint只接受bundle-verified的valid+complete Trial。Canonical payload包括完整Layer 1、Convergence
subfacts、R1～R6 verdict和build/regression/change-boundary verdict，以及Case Seal和Portfolio config digest。
所有数组按stable ID排序；不存在timestamp、message、Tool count、latency、failure stage或Judge字段。

## Completion Attestation

Completion要求八个slot都terminal且通过non-leakage gate。它绑定Definition digest、Ledger head、每个
authoritative attempt、Evidence Bundle digest、Hard Outcome Fingerprint和Case Stability。Artifact使用
exclusive create；独立verifier必须从源artifact重算。

正式Completion/verification还必须接收private Evidence Map，逐slot打开对应Bundle与Case Pack，重算
Result Revision binding、配置、Fingerprint和non-leakage observation。Evidence Map不是artifact，不进入任何
digest或公开投影；它只是对既有content identity的private locator resolution。

允许Case Stability：`stable_pass|stable_fail|investigation_required|incomplete`。Completion artifact不能包含
`incomplete`；该状态只出现在progress/status投影并阻止生成Completion。

## Public projection

Public report只导出：

- Portfolio ID/version/config digest和完成状态；
- Case ID/version/Seal、两个public slot state、Hard public fields与Fingerprint digest；
- Case Stability和显式limitations；
- non-leakage policy version与`no_observed_leak`结果。

Schema明确禁止locator、成员真实identity、raw messages/commands、reference/verifier/mutant字段、Canary、
Pass Rate、Pass@k、rank、score、comparison、formal isolation或Judge fixture claim。

## Recovery invariants

- pre-dispatch Invalid可replacement-link，但原attempt保留；
- dispatch accepted后禁止replacement；
- Evaluation Pending只恢复同一Snapshot与sealed evaluator identity；
- irrecoverable evidence/config/leak产生incomplete，不生成Completion；
- valid Hard fail和pass同样terminal；
- repeat mismatch不授权第三个slot；
- correction只能创建新Case/Portfolio version。
