---
document_type: version-decisions
version: v1.69
authority: decision-rationale
lifecycle: current
last_updated: 2026-09-24
---

# v1.69 版本决定

<a id="v1-69-d01"></a>
## V1.69-D01：Command Code 复用用户层 FirstPayload

- 状态：accepted
- 日期：2026-09-24
- 当前权威：[Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md#command-code-研究接入边界)、[Native Session Bootstrap Redelivery](../../architecture/native-session-bootstrap-redelivery.md)和[ContextManifest Evidence v29](../../contracts/context-manifest-evidence-v29.md)

### 背景

Command Code 1.64.0 的 headless 路径可接收普通用户 Prompt，并支持完整 Session ID 恢复。`appendSystemPrompt` Mod 正常时可进入更高权限层，但缺失或抛错后仍继续模型请求，不能充当必达 Bootstrap。共享 `AGENTS.md` 也无法保证成员私有投递。现有 Core 已有 `first_payload` 的冻结、预算与恢复证据。

### 选择

Command Code 的候选 Product Adapter 复用现有 `first_payload`；首次合成 Bootstrap 与当次冻结 Dynamic Context，普通恢复仅交付当次 Dynamic Context，合格压缩信号后沿用既有补发。明确接受 Charter 在 Command Code 中处于普通用户消息层，低于 Runtime 原生高权限指令。Core 仍独立执行身份、授权和工具门禁。正式 Catalog/平台准入必须另外满足接入清单；本决定不把未验证能力视作通过。

### 后果

- 不新增 delivery mode、marker、每 Run 重投机制或 Bootstrap Mod，也不改写共享项目/用户指令文件。
- 原生 Session 必须真实保留首次引导；压缩、冷恢复及自动重试的连续性仍需单独验收。
- 本决策的普通 Prompt 指令层级偏离[接入清单](../../development/runtime-integration-checklist.md#34-bootstrap-与-context)的高权限目标，产品资格不能借其他 Runtime 的证据推定。

### 未选择方案

- 受管 `appendSystemPrompt` Mod：异常时 fail-open，无法证明 Bootstrap 必达。
- 独立 `prompt_guidance` mode、包裹 marker 或每 Run 重投：当前 Core 已覆盖首轮拼接和有证据的补发，额外语义会改变后续 Run 输入且缺少确认需求。
- 共享 `AGENTS.md`：会把成员私有内容放入项目或用户级可变配置，存在跨成员可见性风险。
