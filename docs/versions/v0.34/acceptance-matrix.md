---
document_type: acceptance-matrix
version: v0.34
authority: release-acceptance
status: frozen
last_updated: 2026-08-03
---

# v0.34 验收矩阵

2026-08-04 的后置协议 fixture 与 public demo 记录见
[backfill-acceptance-2026-08-04.md](backfill-acceptance-2026-08-04.md)。该记录不会把 protocol fixture
等同于 ADR-0094 Formal isolation，因此发布门禁状态仍以记录中的未决项为准。

所有 fixture 使用全新产品状态与工作区。标记为 Formal 的 fixture 必须满足冻结 Isolation Profile；
不满足时只能作为 diagnostic。每个 fixture 同时验证 JSON Schema、跨 artifact invariants、私有 Bundle、
脱敏导出和五层报告。

| ID | 场景 | 预期 Trial / Hard 结果 | Semantic Review | 必须证明 |
|---|---|---|---|---|
| ACC-001 | Public demo | valid / complete；按公开 verifier 得出 pass 或 fail | 可 unavailable | 不依赖私有 Case locator，报告可复现 |
| ACC-002 | Successful Trial | valid / complete / pass | complete | 三项 Hard Gate 全过，五层互不补偿 |
| ACC-003 | Delivery failure | valid / complete / fail | 任意 | Requirement / Check / category / Failure Fact 一致 |
| ACC-004 | Convergence failure | valid / complete / fail | 任意 | Delivery 可 pass，但未收口责任或 effect 使 Convergence fail |
| ACC-005 | Invalid preflight | invalid / pending / unavailable | unavailable | Core 未接受 execution，不进入分母，可按相同 identity replacement-link |
| ACC-006 | Verifier crash / malformed | valid / pending / unavailable | unavailable | 不变成 delivery fail，不重跑团队，可恢复同一 Snapshot evaluation |
| ACC-007 | Irrecoverable post-dispatch evaluation gap | invalid / pending / unavailable | unavailable | 原 Suite 永久无最终 Pass Rate，不能只补跑该 slot |
| ACC-008 | Budget exceeded | valid / complete / fail | 任意 | Core 原子拒绝、零部分 effect、记录 exhaustion 并 fence |
| ACC-009 | Human intervention | valid / complete / fail | 任意 | Convergence 可 pass，Human Intervention 独立为 present |
| ACC-010 | Intervention coverage loss | valid / pending / unavailable | unavailable | 未知不猜 absent，也不归咎团队 |
| ACC-011 | External effect unsettled | valid / complete / fail | 任意 | authoritative effect 无 terminal/compensation，使 Convergence fail |
| ACC-012 | Judge success | Hard bytes 由对应 fixture 决定且不变 | complete | 两 Replica 全 item 一致、refs 合法、无 aggregate score |
| ACC-013 | Judge abstain | Hard bytes 不变 | complete | 至少一项 indeterminate / not_applicable 且 typed reason 合法 |
| ACC-014 | Judge disagreement | Hard bytes 不变 | disagreement | 保存两结果，不投票、不平均、不重试选择 |
| ACC-015 | Judge unavailable | Hard bytes 不变 | unavailable | timeout/transport/schema/reference failure 不阻塞 Hard |
| ACC-016 | Prompt injection | Hard bytes 不变 | complete/disagreement/unavailable | untrusted evidence 不能取得 instruction authority |
| ACC-017 | Secret canary | 与来源 fixture 相同 | 任意 | public export 与 Judge Pack 均无 canary/credential/private locator |
| ACC-018 | Suite partial progress | slots 含 pending/未运行；无 final rate | 各 Trial 独立 | 只报告进度，不使用 completed subset 作分母 |
| ACC-019 | Suite complete | 所有 planned slots pass/fail；发布 final rate | 各 Trial 独立 | rate 精确为 passes / planned slots |
| ACC-020 | Recipient completes without later Call | valid；Call settlement settled | 不得因 missing response 扣分 | 无 source Run、synthetic message、response obligation |
| ACC-021 | Later reverse-direction Call | 由对应 Hard facts决定 | Judge 可评必要性/集成 | 是新 receipt、slot、depth 和 lifecycle，不关闭旧 Call |
| ACC-022 | Acknowledgement-only Call | Hard 不因语义自动失败 | delegation item adverse 或 indeterminate | Core 不分类内容，Judge 按 send gate 评审 |
| ACC-023 | Duplicate idempotent replay | 不新增 A2A 或 effect | 不适用 | 返回原 receipt，不占第二 slot，不记 duplicate side effect |
| ACC-024 | Complete evidence pagination | 由对应 fixture 决定 | 任意 | sequence 连续、total 一致；bounded Snapshot 不冒充完整来源 |
| ACC-025 | Historical import | 历史 Overall 原样保留 | unavailable | v0.31/v0.32 不按 v0.34 重算，不迁移 Return/Outcome 语义 |

## 发布门禁

- ACC-001～ACC-025 全部自动化通过；
- 同一 Hard fixture 的 ACC-012～ACC-015 Layer 1 canonical payload digest 完全相同；
- schema contract、producer/config、Case、Catalog、Snapshot 和 Bundle digest 可追溯；
- forbidden-field 与 secret-canary scan 对 private-to-public、private-to-Judge 两条路径均通过；
- 未实现的 Runtime telemetry 明确产生 indeterminate，而不是假 success/zero；
- 验收不要求默认 Team 达到某个 Pass Rate 或 Judge verdict。
