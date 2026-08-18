---
document_type: runtime-activity-maintenance-index
authority: runtime-activity-registry-process
last_updated: 2026-08-15
---

# Runtime Activity Mapping 维护指南

本目录长期管理十个 Agent Runtime 的“结构化事件如何进入 Canonical Runtime Activity”。它回答
“当前有哪些规则、证据来自哪里、怎样安全修改”，不替代 Architecture 的架构边界，也不冒充代码实施事实。

## 权威关系

| 问题 | 真源 |
|---|---|
| 能否从未报告行为推断活动 | [Evidence 与 Canonical Activity 当前架构](../architecture/foundational-invariants.md#evidence-canonical-activity) |
| 当前 Runtime/协议/字段/coverage 清单 | [Mapping Registry](registry.md) |
| 实际分类实现 | `crates/rovai-core/src/runtime_activity_mapping.rs` |
| Evidence 归一化与 Projection 写入 | `execution_evidence.rs`、各 Runtime event normalizer |
| Renderer 展示 | `ui-model.ts`、`CampWorkspace.tsx` |
| 实测安装和 smoke 兼容性 | `docs/runtime-compatibility.md` |

文档与代码冲突时必须报告漂移；不能用 Registry 文档声称代码已经实现，也不能只改代码而留下
过期的长期规则。

## 每次映射变更的原子交付

1. 修改 Core Mapping Registry；
2. 更新 [registry.md](registry.md) 对应 Runtime/协议条目；
3. 增加正例、unknown 例和 started→terminal lifecycle fixture；
4. 说明 tool name 来自 Core Catalog、Runtime 结构化字段还是仅 presentation hint；
5. 验证 live event 与恢复 Read Side 产生相同 Canonical shape；
6. 验证 Renderer 没有按 title、command、provider 或 Runtime 名称重新分类；
7. 更新 fixture/smoke/截图状态，真实 smoke 不可运行时明确写明。

## 变更等级

- 只改本地化文案：Renderer presentation 变更，不升级 classifier；
- 新增同一结构化字段的语义映射：升级 classifier，增加 fixture；
- 改变 operationId 来源或 Evidence 分组：必须同步更新当前 Architecture/Contract，并在唯一 current 版本记录决定理由；
- 推断 Runtime 未报告行为：禁止；
- 新增 Runtime：先以 `unknown`/`run_level` 接入，再凭结构化证据升级 coverage。

## 防漂移门禁

Core 单测必须证明 `AdapterKind::ALL` 恰好覆盖一次。Registry 文档必须逐行列出相同十个
Adapter kind；发布验收再用机器可读报告比对显示名称、coverage、期望 tool label 和来源身份。
