---
document_type: model-context-change-proposal
runtime: cline-cli
baseline_version: v1.70
target_version: unassigned
revision: 1
confirmation_status: pending
authority: proposal-only
implementation_status: not_started
last_updated: 2026-09-27
---

# Cline ACP Bootstrap 投递：revision 1（待确认）

本提案只改变新接入的 `cline-cli` 对既有冻结 Bootstrap 的投递层级，不改变
Bootstrap／动态 Context 的内容和选择。Cline 尚未进入 Product Runtime Catalog，
没有已发出的生产 Native Binding。Command Code 已确认的普通 Prompt
[`first_payload` revision 4](../command-code-runtime/prompt-guidance-v1.70-proposal.md)
是另一个 Runtime 的独立决定，保持原样。

## 变更前：当前 staged Cline 路径

当前内部代码把 `AdapterKind::ClineCli` 选为 `CharterDeliveryMode::FirstPayload`，
并让共享 ACP `session/prompt` 发送 `PreparedContext.runtime_payload`。令 `B` 为目标
Native Binding 冻结的完整 Bootstrap 原字节，`P` 为本 AgentRun 冻结的完整 Dynamic
Context 原字节。新 Session 或合格补发时，普通用户 Prompt 是 `B + "\n\n" + P`
（补发时 `B` 由共享 redelivery envelope 包裹）；正常 warm/cold 恢复只发 `P`。
`B` 没有进入 ACP 的 System/Developer 指令层。正式 Cline AgentRun 仍被平台
`not_qualified` 阻断；没有生产输入需要迁移。

此处 `B` 的完整 section 顺序、原文字节和出现条件沿用当前
[v1.70 Command Code 基线提案](../command-code-runtime/prompt-guidance-v1.70-proposal.md#变更前当前精确结构与选择)
列出的共享 Bootstrap v5／Formatter 5／Charter 14：`[SESSION_CHARTER]`、
`[MEMBER_IDENTITY]`、`[ROVAI_PLATFORM_SKILLS]`、有条件的
`[MEMORY_ENTRYPOINT]`。`P` 沿用公开 batch 31／Profile 10／Facts 8、非 batch
27／Profile 7／Facts 5 的完整当前 shape、顺序、选择、预算和遗漏规则；旧 Binding
只使用自己的冻结 v4 或 v5 `B`，不热更新。此提案不改写这些大段文本。

## 变更后：每 Run 原生 System Rule

选用已有 `CharterDeliveryMode::ManagedSystemPrompt`，不引入新 mode。
Rovai Host 在私有 Cline Plugin 中通过官方 `registerRule` 注册唯一 Rule：

```javascript
api.registerRule({
  id: "rovai.session.bootstrap",
  source: "plugin",
  content: () => verifiedFrozenBootstrapForThisSessionAndRun.trim(),
});
```

`verifiedFrozenBootstrapForThisSessionAndRun` 只由 Core 已绑定的 Native Binding、
目标 Session ID 和当前 Prompt lease 提供，不从模型历史、项目 `AGENTS.md`、其他成员
Session 或 Cline native 配置推断。Rule 的函数在 Cline 3.0.65 每次 Session Run
组合 System Prompt 时解析；Cline 在同一 `systemPrompt` 字段中把非空 Rule 内容用
`"\n\n"` 与原生 System Prompt 及其他原生 Rule 内容相连。Rovai 交给 Rule 的内容
精确为 `B.trim()`，同一模型请求必须恰好出现一次，并以原生 System Prompt 身份
投递；不控制、不覆盖用户自己的原生 System Prompt 或其他 Rule。插件缺失、Rule
未加载、绑定不匹配、内容缺失／摘要错误或重复时必须在模型调用前失败关闭；产品
准入前还须证明这个前置阻断，而不能仅在回复后发现缺失。

`session/prompt` 的文本每次都精确为 `P`，不再包含 `B` 或补发 envelope。
首次、warm、A→B→A、Host/Core 冷恢复和替代 Session 均通过同一冻结 Binding
选择器取 `B`。若 Binding 冻结的 `B` 确实变化，沿用共享 generation／evidence
规则旋转或拒绝不兼容 Session；绝不把新版 Charter 热注入旧 Session。
对 Cline 选择 `native_system_prompt_preserved`：原生压缩只处理消息历史，
System Rule 每个 Run 重新组合；此前用于 `first_payload` 的合格补发信号不能再把
`B` 追加到用户 Prompt。是否无需信号必须用 manual、threshold、overflow/retry、
压缩后 cold resume 逐项证明；尚未证明时仍阻断准入。

## 不变项、版本与恢复

- `B`、`P` 的来源、section 全文、顺序、条件、Skills／MCP 暴露及附件授权不变。
  `P` 的现行 96 KiB 上限不变；由 `first_payload` 组合输入改为独立 System Rule 后，
  `B` 单独限制为 32 KiB，不能把两份输入的大小误称仍受同一个 96 KiB 总上限。
  Cline 只改变 `B` 所在消息层级及每 Run 的投递时机。
- `rendered_payload`／摘要仍只指 `P`；`runtime_payload`／摘要也只指 `P`。
  Native Binding 保存 `B` 及原有 Bootstrap evidence；Rule attestation 增加独立
  adapter-scoped 证据，不能以模型复述或普通回复代替。
- 沿用当前 Bootstrap v5、公开 Manifest 31、非 batch 27、Profile 10／7、
  Facts 8／5 的版本轴，不重写其他 Runtime 的合同。是否需要新增 Cline 专属
  evidence revision 或迁移，以产品实施时的当前 Contract 审核为准；没有生产
  Cline Binding，故无历史 Cline 数据转换。旧的其他 Runtime Binding 原字节不变。
- 同 Run 恢复只使用已冻结 `P` 和已绑定 `B`，未知接受结果不重投；Session
  更换、Plugin 或原生配置变化必须由共享 compatibility fence 处理。

## 证据与负向验证

2026-09-27 隔离官方 CLI 3.0.65／ACP／sub2api BYOK 探针使用临时 Plugin
注册了静态和函数式 `registerRule`。两种形式都在真实模型调用前的
`beforeModel.request.systemPrompt` 中观察到唯一私有 marker；请求键为
`systemPrompt`、`messages`、`tools`、`modelTools`、`signal`、`options`。
这证明原生接缝可用，**尚未**证明 Core 冻结 `B` 的字节级投递或前置失败关闭。
上游组合规则见固定版本
[Session Runtime Orchestrator](https://github.com/cline/cline/blob/cli-v3.0.65/sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts)
及[官方 Plugin API](https://github.com/cline/cline/blob/main/.agents/skills/cline-sdk/references/plugins/REFERENCE.md)。

实施验收必须逐项核对：

1. 新／旧 Binding 的 `B` 字节、摘要和 generation；每轮 `P` 字节及现行公开／
   非 batch Manifest，不改变其他 Adapter 的模型输入。
2. 真实 Provider-bound System Prompt 包含目标 `B.trim()` 一次，用户消息
   仅含 `P`；首次、warm、A→B→A、冷恢复和替代 Session 不丢失或串线。
3. Plugin 不加载、Rule 读失败、Session／lease／digest 不匹配、绑定变化、
   `B` 超过 32 KiB、`P` 超过 96 KiB 及 native 兼容性变化在模型／Tool 副作用前失败关闭；秘密不进入公开
   事件、argv、diagnostics 或仓库。
4. manual、threshold、overflow+retry 及压缩后 cold resume 保持同一高权限
   Bootstrap、Skills/MCP 和权限；`/compact` 当前 ACP 路径仅是普通 Prompt，
   必须另找可验收的手动入口或形成明确上游 Unsupported 的当前版本决定。

本 revision 尚待 Principal 在看到全文后明确二次确认。确认后须先复制为当时唯一
current 版本的独立模型上下文变更说明，再修改实施、Contract 和 Version Decision；
若投递内容、位置、时机或选择语义变化，递增 revision 并重新确认。
