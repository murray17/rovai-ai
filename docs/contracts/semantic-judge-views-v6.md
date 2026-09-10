---
document_type: interface-contract
contract: semantic-judge-views
version: 6
authority: semantic-judge-model-visible-evidence-and-reconciliation
status: accepted
source_version: v1.57
last_updated: 2026-09-11
---

# Semantic Judge Views v6

v6 继承 [v5](semantic-judge-views-v5.md) 的可观察范围、隔离及一次分歧裁决；新增显式 `generic-task-v6`，旧 profile 和历史产物保持原义。Protocol 2 与规范化 View/Suite Schema 不变。

## 声明与验证

Outcome 将产物事实、验证成功和验证失败分别核对。一次性固定产物允许固定预期值检查，不强求独立算法；可复用程序仍按其任务要求验证。后来有效修复的失败不自动降低最终评价。独立 verifier 的通过只证明产物，不能证明 Agent 自己执行过所声称的检查。

CLI Judge adapter 对 v6 Outcome 的真实响应增加 `claimsAudit`：`claimsComplete` 与 1—32 个逐条声明，每条包含原文 `text`、`sourceSegmentId`、`kind`、`result`、`material`、`evidenceIds`、可空 `evidenceQuote` 和 `reason`。kind 为 `artifact_fact` / `verification_success` / `verification_failure`，result 为 `supported` / `contradicted` / `unknown`。冻结输出 Schema 与调用一同保存；适配器须声明 `claim-audit-v1` 能力，尚不支持的 adapter 不准入本 profile。

代码验证原文来自交付、引用在该项证据闭包中，以及支持声明的证据类型。支持 Agent 自检须有未截断命令回执、可观察输出和相符退出码；含错误掩盖的成功命令还须提供输出中的逐字检查凭据。退出码 0、打印产物或 git 状态本身不能证明子检查通过。无法满足来源要求的声明变为未知，不编造成失败。

代码按“实质矛盾 → 不满足；否则未知或提取未完成 → 未知；否则非实质矛盾 → 部分满足；否则满足”汇总 `claim_accuracy`。其他项仍由固定 rubric Judge 评价。原始响应不改写，`claim-audit.json` 保留模型输入、原响应摘要、逐条校验、问题与派生判定；双副本及裁决仍保留原记录。

准确提取全部声明、判断重要性、辨认凭据是否语义相关仍依赖 Judge；机械引用校验不证明任意 Shell 程序正确，也不保证模型不会漏项。Process 不读取这个 Outcome 审计；Outcome 不因此获得完整 Trace。缺失与分歧依旧阻断必需项完整性。
