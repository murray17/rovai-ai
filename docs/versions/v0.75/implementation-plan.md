---
document_type: implementation-plan
version: v0.75
authority: implementation-plan-and-acceptance
status: in_progress
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
- [ ] 提交并推送到 `main`。

## 当前证据与缺口

- 已完成：版本切换、ADR-0182、Camp Message Send v6、Core parser、help/schema/smoke 与 canonical
  persistence/Delivery integration；
- 已通过：parser 8 项定向回归、完整 `rovai-core` lib 425 / CLI 11 / Core binary 73 tests（3 项既有
  manual Runtime smoke ignored）、文档 21 项单测、普通治理、真实 base CI、ADR generation check、Rust
  format、smoke script syntax 与 diff 检查；
- 尚未完成：提交与推送；完成后本计划不再保留发布缺口。
