---
document_type: development-guide
authority: core-model-context-change-governance
last_updated: 2026-08-16
---

# 核心模型上下文变更治理

Native Session Bootstrap 与 AgentRun Dynamic Context 是 Rovai-ai 的核心模型输入合同。它们决定模型在
一个 Native Session 中稳定看到什么，以及每个 AgentRun 开始时精确看到什么。任何需求只要改变这些
输入的字节、结构、选择、语义或可复现证据，就必须先经过独立变更说明和开发者二次确认；普通需求描述、
初次同意或实现者自己的判断不能替代该门槛。

## 触发范围

下列任一变化都触发本规则：

- Bootstrap 中 `SESSION_CHARTER`、`MEMBER_IDENTITY`、Memory Entrypoint 或其他模型可见内容；
- Dynamic Context 的 section 名称、顺序、发送条件、JSON 字段、字段省略规则或解释语义；
- 历史、Task、协作、Run facts、Current Input 的选择、截断、预算、遗漏或恢复 locator；
- Native Session Bootstrap Evidence、ContextManifest、Runtime Input Delivery Evidence 的证明内容；
- Bootstrap、AgentRun Formatter、ContextManifest 或 Context Delivery Profile 的版本轴；
- 会导致既有 Bootstrap、Binding、Manifest、冻结投递或恢复输入失效的 clean break。

纯内部重构只有在可证明模型可见字节、选择结果、证据与版本轴均不变时才不触发。判断不清时按触发处理。

## 实施前必备文件

触发本规则的当前版本必须在 `docs/versions/<current>/` 下保存独立的
`model-context-change.md`；同一版本存在多个互不相干的调整时可使用
`model-context-change-<slug>.md`。版本概览 Front Matter 必须声明
`model_context_change: true`；没有此类变化时声明 `false`。

每份说明必须独立于版本概览和实施计划，并至少包含：

1. 精确“变更前”内容或结构；
2. 精确“变更后”内容或结构；
3. 明确不变的 section、选择/预算、权威和证据边界；
4. 涉及的合同与 formatter/profile/manifest 版本轴；
5. 数据迁移、失效、恢复和兼容策略；
6. 可执行验证与关键负向测试；
7. 变更说明 revision 及对应的二次确认记录。

只有摘要而没有字段级或完整文本的“前/后”对照不合格。大段文本合同应给出完整替换文本；结构化合同应给出
完整 shape、可选/省略规则和字段语义。

## 二次确认门槛

二次确认必须发生在开发者已经看过完整变更说明之后，并且明确同意实施该 revision：

- 原始需求、第一次方案同意或“请开始分析”不算二次确认；
- 确认记录必须包含 `confirmation_status: confirmed`、`confirmed_by`、`confirmed_at`、
  `revision` 和与之相等的 `confirmed_revision`；
- 说明内容发生语义变化时必须递增 `revision`，旧确认立即失效，重新取得开发者确认；
- Coding Agent、自动化或实现者不能替开发者自我确认；
- 未取得确认时可以继续调查和编辑提案文档，但不得修改实现、Schema、当前合同或执行 clean break。

`pnpm docs:check` 会验证当前版本是否显式声明该影响，并在声明为 `true` 时拒绝缺失、未确认、revision
不一致或缺少前后对照章节的说明。门禁只验证记录完整性；代码评审仍必须核对实际 diff 是否与已确认说明一致。

## 版本收口

实现完成后，同一份说明追加实际版本号、迁移结论和验证结果，不重写已经确认的前后合同。若实现偏离说明，先
更新 revision 并重新二次确认。版本概览的九范围影响表、ADR、Contract、Architecture 与领域词汇仍按各自
治理规则同步；本文件不替代这些长期权威。
