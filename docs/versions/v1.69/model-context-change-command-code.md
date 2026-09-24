---
document_type: model-context-change
version: v1.69
change_id: command-code
revision: 3
confirmation_status: confirmed
confirmed_by: Principal
confirmed_at: 2026-09-24T05:24:42Z
confirmed_revision: 3
authority: proposed-model-input-change-statement
implementation_status: in_progress
last_updated: 2026-09-24
---

# Command Code 普通 Prompt 引导：模型输入变更说明（revision 3）

开发者已选择将 Command Code 改为“普通 Prompt 引导”的接入。本文件把已确认的 revision 3 纳入唯一 current 版本的模型输入变更范围；它本身不修改当前 Context Contract 或 Product Runtime Catalog。原审阅稿保存在[研究提案](../../research/command-code-runtime/prompt-guidance-proposal.md)。

revision 2 将基线更新到已合入的 v1.68：v1.67 删除 Core 生成模型投影中的 `schemaVersion` 并升级 Bootstrap，v1.68 移除公开 Camp 的自动历史投影，改由 `RUN_FACTS.historyHint` 提示按需读取历史。revision 3 进一步复核现有 Context 实现，改为复用已有 `first_payload`；此前拟新增的 `prompt_guidance` mode、包裹 marker 和每 Run 重投均不是开发者已要求或现有共用主链所必需的行为。该修订改变首次后续 Run 的输入字节与连续性策略，旧 revision 不能沿用。

## 变更前

仓库只有内部 [`command_code.rs`](../../../crates/rovai-core/src/command_code.rs) headless 传输：`request.prompt` 原样写入 `--print --output-format json` 的 stdin，没有 Command Code Product Adapter、ContextManifest、Native Binding 或正式 Bootstrap 投递。隔离 fixture 中的 `--mod` 仅用于验证 1.64.0 能以 `appendSystemPrompt` 注入，以及 Mod 缺失或回调抛错后仍会请求模型；正式执行路径没有生成或传递 Mod。

此前研究候选的输入等价于：

```text
system = commandCodeBaseSystemPrompt + "\n\n" + B
user   = P
```

其中 `B` 是当时 Bootstrap 的完整字节，`P` 是当时 Run 的冻结 Dynamic Context。该候选未进入正式 Adapter，也没有可恢复的生产数据。当前实现基线是 Bootstrap 合同 v4 / Formatter 4、Session Charter revision 13；Command Code 仍没有正式输入路径。

## 变更后

### 1. 精确模型输入

Command Code 使用现有的 `first_payload` Charter delivery mode 和 `compose_first_payload`。定义：

```text
B = render_session_bootstrap(
      frozenSessionCharter,
      memberIdentityPrettyJsonAtEligibleInput,
      frozenMemoryEntrypoint
    )
P = exact frozen Dynamic Context payload for this AgentRun
bootstrapRequired = requiresNewNativeSession || bootstrapEvidenceDigestChanged
bootstrapPayload = if pendingQualifiedCompactionRedelivery then
                     render_bootstrap_redelivery_overlay(B)
                   else if bootstrapRequired then B
                   else none
U = if bootstrapPayload exists then bootstrapPayload + "\n\n" + P else P
```

这是现有 `first_payload` 的选择和拼接语义：首次 Native Session 或已证明的 Bootstrap 变更包含完整 `B`；已有 Binding 的普通后续 Run 只发送 `P`；合格压缩信号形成待补发 revision 后，在下一次 eligible 输入使用现有补发 Envelope。完整 UUID 恢复本身不强制重投 `B`。本提案不新增 `ROVAI_PROMPT_GUIDANCE` 文本、每 Run 重投开关或独立 delivery mode。

`B` 沿用当前 Bootstrap 合同 v4 / Formatter 4 的完整结构，不修改其中任何标题或正文：

```text
[SESSION_CHARTER]
{frozenSessionCharter.trim()}
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
{existing six-field Member Identity pretty JSON}
[/MEMBER_IDENTITY]

[MEMORY_ENTRYPOINT]
{frozenMemoryEntrypoint.trim()}
[/MEMORY_ENTRYPOINT]
```

`MEMBER_IDENTITY` 只含 `name`、`teamRole`、`professionalResponsibilities`、`personalityTraits`、`workingPrinciples`、`growthTopic` 六个业务字段；空字符串和空数组仍输出，不含 `schemaVersion`。最后一个 section 仍遵守既有规则：Memory Entrypoint 为空时整段省略。现有 assembler 使用本 Session 的 Charter/Memory evidence，并在实际包含 Bootstrap 的 eligible 输入上读取当时的成员身份；身份编辑本身不强制重投。公开 Camp 的 Charter revision 13 明确要求按需使用 `rovai camp read`，而非把 `historyHint` 误认为已读或已处理水位。

`P` 原样沿用当前公开 Camp Formatter 29 / Manifest 29 / Profile 9 / Run Facts 7，或非 batch（含 Single Chat）Formatter 26 / Manifest 26 / Profile 6 / Run Facts 5 的 section、字段、顺序、选择、预算及遗漏规则。当前公开 Camp 的完整 section 顺序为：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[RUN_FACTS]
[WORKSPACE]?
[RUN_INPUT]
```

公开 `RUN_FACTS` 必有 `attachmentOutputRoot` 和 `historyHint`，可选 `mission`、`taskContext`、`sessionContinuity`、`externalEffect`；不含 `schemaVersion`。`RUN_INPUT.messages` 完整保留本 Run 的有序当前工作项。公开 `P` 不含 `SHARED_CONVERSATION`、自动公屏历史、历史摘要或遗漏提示；`historyHint` 的两种固定文案和水位语义沿用 [Run Facts v7](../../contracts/run-facts-v7.md)。同一 Run 恢复复用已冻结的 `P`，不按新水位重算。

非 batch `P` 的完整 section 相对顺序为：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[SHARED_CONVERSATION]?
[RUN_FACTS]
[WORKSPACE]?
[A2A_GUIDANCE]? / [SINGLE_CHAT_GUIDANCE]?
[CURRENT_INPUT]
```

两种 Guidance 只在各自模式下出现；Single Chat 不投递 `SELF_ACTIVE_TASKS`，且其 `RUN_FACTS.conversationMode` 必有。非 batch 不含 `historyHint`；其他字段和省略规则仍由 [ContextManifest v29](../../contracts/context-manifest-evidence-v29.md)、[ContextManifest v28](../../contracts/context-manifest-evidence-v28.md)、[Single Chat v8](../../contracts/single-chat-v8.md) 及各自引用的当前合同确定。本提案不会借引导前缀恢复已退役的公开自动历史投影。

Core 在每个 Command Code AgentRun（包括按完整 UUID 恢复的 Run）把当次 `U` 作为**一个普通用户 Prompt**通过 stdin 传给 `--print --output-format json`。本方案依赖 Command Code 原生 Session 在后续精确恢复时仍保留首次投递的 `B`；必须实测证明该历史仍可见，不能仅凭 `--resume` 返回成功推断。Rovai 不生成 Bootstrap Mod、不传 `--mod`、不为成员改写项目或用户 `AGENTS.md`。Command Code 自身的原生配置和 Mod 仍按其原生规则加载，但不作为 Rovai Bootstrap 的投递或证明。

### 2. 权限与连续性边界

`B` 虽然仍包含 Session Charter 字样，但在 Command Code 中属于普通用户消息，可被更高权限的原生指令覆盖，也可能受到同层后续输入影响。Core 的身份、授权、CLI operation、文件和附件门禁继续在 Core 执行，不能仅依赖模型遵守 `B`。产品资料和可执行资格必须如实标记这项差异；不得宣称高权限 Bootstrap parity。

现有 `first_payload` 在普通后续 Run 依赖原生 Session 保留首次的用户层引导。Command Code 的 `compaction_*` 事件尚未证明能形成合格的 Core 补发信号；同一 `--print` 进程内部的压缩与自动重试也暂无逐模型调用重注入点。因此压缩、冷恢复后 Charter 连续性均保持未验证；若无法证明现有补发机制可以覆盖，就不能按 First-Class 准入。不得把“每 Run 重投”当作已实现的缓解，也不能凭一次模型复述宣称连续性通过。

### 3. 冻结、预算与恢复证据

- `rendered_payload` 和其摘要仍只指 `P`；`runtime_payload` 与其摘要精确绑定当次 `U`。复用现有 `first_payload` mode、`bootstrap_in_runtime_payload` presence、Bootstrap evidence 和 Runtime Input Delivery 的冻结与 digest，不新增投递证据形状。
- `B` 使用本次 Run 已验证的 Native Binding/generation 和 Bootstrap evidence。公开 Profile 9 的完整 FIFO `RUN_INPUT`、必有的 `historyHint`、可选 Task 裁剪和默认 96 KiB UTF-8 payload capacity 保持现有规则；包含 `B` 或补发 Envelope 时，合成后的 `U` 超限就在启动 CLI 前拒绝，不裁剪 `B`。
- 失败恢复只能重用冻结的 `U` 或为新的 Run 重新物化；不根据已接受但结果未知的输入自动重发。Native Session 仍只用完整 UUID 精确恢复。
- 新 Command Code Adapter 使用现有 `first_payload` 与当前 Context compatibility identity；不新增 prompt-guidance mode/revision。此前不存在正式 Command Code Binding/Manifest/Delivery，旧数据无需迁移；既有 Runtime 的冻结输入和 mode 不改变。

## 明确不变

- `SESSION_CHARTER`、六字段 `MEMBER_IDENTITY` 和 `MEMORY_ENTRYPOINT` 的现有内容、来源与 Formatter 4 字节不变。
- 当前公开 Camp 29/29/Profile 9 与非 batch 26/26/Profile 6 的 Dynamic Context section、字段、选择、预算和证据不变；其他 Adapter 的交付模式与模型输入不变。公开 `historyHint` 只作为现有 `P` 的一部分投递，不新增自动历史选择或阅读确认。
- `NATIVE_SESSION_BOOTSTRAP_CONTRACT_VERSION = native_session_bootstrap_v4`、Bootstrap Formatter 4、Session Charter revision 13 和现有 delivery mode 集合不变；不为本接入额外引入 Context 版本轴。
- Built-in `rovai` CLI 的权限由 Core 逐次验证；Prompt 不代替授权或审批。
- 本说明只解决 Bootstrap 投递选择。Skills、External MCP、权限、Usage、真实认证 Smoke 与逐平台准入仍按 [Parity Matrix](../../research/command-code-runtime/parity-matrix.md) 单独验收。没有完成前不把 Command Code 宣称为 First-Class。

## 版本、迁移与兼容

确认后实施新增 Runtime 时，按届时唯一 current 版本的范围规则记录普通用户 Prompt 的产品差异，并由 Version Decision 明确接受它与[Runtime 接入 Checklist](../../development/runtime-integration-checklist.md#34-bootstrap-与-context)高权限 Bootstrap 要求的偏差。复用现有 `first_payload` 不要求新增 Charter delivery mode、Context Formatter/Manifest/Profile 版本或其 Schema 枚举值；如后续证据要求改变投递频率、marker、预算、恢复语义或现有 Context 合同，先递增本 revision 并按[核心模型上下文变更治理](../../development/model-context-change-governance.md)重新确认，必要时执行[版本切换清单](../../versions/README.md#版本切换清单)。

生产接入只生成新 Command Code Binding/Delivery；旧 staged transport 测试没有持久化的产品状态。既有公开 Manifest 28 及更早的冻结输入只保留审计原字节，不转换为 29 或重新派发。这个提案不授权把未经真实验证的平台标成 `qualified`。

## 验证

1. 在 Context 既有 owner 中检查 Bootstrap v4 的完整字节、首次 `B + "\n\n" + P` 与后续 `P`、空 Memory section、省略规则、预算和双摘要；公开 `P` 为 29/9/7，必有冻结 `historyHint` 且无 `SHARED_CONVERSATION`，非 batch `P` 为 26/6/5；既有 Adapter 的模型输入字节保持不变。
2. 在隔离 Command Code 1.64.0 fixture 中检查首次模型请求只把 `B` 放在 user message，精确 UUID 恢复的后续请求没有新 `B`、却仍能从原生 Session 看到首次引导；启动不传 `--mod`。证明失败时不能宣称 Continuation 通过。
3. 检查缺失/损坏 Bootstrap evidence、首次组合超限、Session ID 错误和 stdin/进程失败均不会在缺少应有 `U` 时启动模型；已接受或未知结果不自动重发。验证合格压缩信号后的下一次补发；没有合格信号时明确记录 continuity gap。
4. 完成真实账号、Tool、权限、MCP、Skill、取消、Usage、压缩和目标平台 Golden Flows 前维持 Research 或明确的受限 Preview，不将 fixture 当作正式资格。

## 二次确认

`revision: 3 / confirmation_status: confirmed`。用户最初选择了普通 Prompt 路线；revision 1/2 又分别使用旧 Context 基线或额外的新投递语义，均不算对本 revision 的二次确认。在 revision 3 完整说明发给用户后，Principal 于 2026-09-24 05:24:42 UTC 以 Camp 消息 `c45a7510-05c0-4ac8-91f3-1525bc46052d` 回复“行，那你开始”，确认按本 revision 实施。此确认只覆盖上述模型输入方案，不将未验证的 Runtime 能力提升为正式资格。

## 阶段记录：2026-09-24

本说明实际纳入 v1.69。内部 Command Code 传输现要求 Core `PreparedContext` 且只发送 `runtime_payload`，拒绝非 `first_payload` mode；没有新 Product Binding、Manifest 或旧数据迁移。固定 1.64.0 的隔离 Home/本机模型 fixture 已验证首轮 user 层 `B + P`、完整 UUID 恢复后的新 `P` 和原生请求历史中保留的旧 `B`；还未证明真实认证、压缩或 Core 冷恢复。完整 AgentRun Context/Input Delivery 接线仍未实施，不能把传输夹具视为模型上下文合同已经在产品路径完成。
