---
document_type: implementation-plan
version: v0.75
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-14
---

# v0.75 实施与验收计划

## Checkpoint 0：版本与协议边界

- [x] 将 v0.74 按真实未完成状态冻结为 historical，并建立唯一 current v0.75；
- [x] 接受 ADR-0182，冻结 exact current-Camp display-name alias、canonical precedence 与 fail-closed 歧义；
- [x] 新增 Camp Message Send v6，保持 `--to`、wire、Envelope、result、Delivery 与数据库 schema 不变；
- [x] 完成九项跨版本文档影响判断。

## Checkpoint 1：Core parser 与 canonical freeze

- [x] 活跃 Camp 成员查询同时加载 canonical Agent ID 和当前显示名；
- [x] parser 在既有 literal/URL/escape 边界内先解析 canonical token，再解析 exact display-name alias；
- [x] alias 命中后复用既有 occurrence、Structured Mention、recipient validation、去重和 Delivery 链路；
- [x] 同长歧义 fail closed，显示名不进入持久 recipient identity。

## Checkpoint 2：教学与回归

- [x] 更新 schema、exact help 与 smoke，使 alias grammar、`--to` canonical-only 和
  `effectiveRecipients` 后置条件可见；
- [x] parser tests 覆盖正向、边界、优先级、最长匹配、歧义及 literal exclusions；
- [x] 集成测试证明 `@爱丽丝` 在无 `to` 时只创建一条 canonical Delivery；
- [x] 运行格式、定向/完整 Core tests、文档治理和 diff 检查。

## Checkpoint 3：发布

- [x] 复查只纳入 v0.75 范围，不包含并行的品牌资源改动；
- [x] 将验证证据回填版本文档并标记完成；
- [x] 提交并推送到 `main`。

## Checkpoint 4：Review Duo 结果恢复

- [x] 用 expected/accepted parts、连续 finding IDs、ranges/counts 与 transmitted/total 汇总冻结轴结果；
- [x] 让发送者检查 accepted `effectiveRecipients`，让 Lead exact-read 验证可信发送者、reply、snapshot 与
  `addressing.effectiveAgentRecipients`；
- [x] 将最终报告保持为有界摘要，只引用可 exact-read 的 manifest 与 part message IDs；
- [x] 从头审读 bundled Skill，运行 validator、official bundle 定向回归、文档治理和 diff 检查。

## Checkpoint 5：Memory correctness closure

- [x] 移除与 ADR-0022/0026 冲突的 Supersession same-Scope/Kind 门禁，并把 successor candidate、cycle 与
  最终容量检查全部放到首个写入前；
- [x] Search/authorized Read 返回 Agent-relative Scope identity，body-free stale/unavailable 结果省略身份；
- [x] Revise closed input 重复 Scope identity，Core 在 CAS/no-change 前校验 authorization 与 exact target；
- [x] 将 typed Memory command 的可预期领域错误收敛为 durable rejected result，保留基础设施 `Err`；
- [x] 升级 Memory Capture v2、Built-in Tool Transport v10、ADR-0183、Skill、Architecture 与文档路由；
- [x] 增加 Supersession cross-Scope/final-capacity、Relationship counterparty、wrong-target anti-oracle、
  Presence/quota/capacity durable replay 回归并运行完整门禁；
- [x] 提交并以非强推方式快进发布到 `main`。

## 当前证据与缺口

- 已完成：版本切换、ADR-0182、Camp Message Send v6、Core parser、help/schema/smoke 与 canonical
  persistence/Delivery integration；Review Duo 结果恢复使用消息身份、关系、part 序列与正文结构；Memory
  correctness closure 的实现、合同和定向回归已完成；
- 已通过：最新 `main` 基线完整 `rovai-core` lib 430 / CLI 11 / Core binary 73 tests（3 项既有 manual
  Runtime smoke ignored）、文档 21 项单测、Vitest 329 项、Node/benchmark 179 项、TypeScript、Clippy
  `-D warnings`、Rust format、普通治理、真实 base CI、ADR generation、script syntax 与 diff 检查；
- 已发布：alias 实现提交 `80bd36aa`、Review Duo 结构校准与 Memory correctness closure 实现提交
  `91bb0bf5` 均已推送到 `main`；本计划不再保留发布缺口。
