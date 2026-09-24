---
document_type: model-context-change-proposal
runtime: command-code
baseline_version: v1.68
target_version: pending
revision: 2
confirmation_status: pending
authority: proposal-only
implementation_status: not_started
last_updated: 2026-09-24
---

# Command Code 普通 Prompt 引导：模型输入变更提案（revision 2）

开发者已选择将 Command Code 改为“普通 Prompt 引导”的接入。本文件把该选择落实为可审阅的模型输入合同。它是实施前提案，不修改当前 Context Contract 或 Product Runtime Catalog。根据[核心模型上下文变更治理](../../development/model-context-change-governance.md)，开发者读过完整 revision 并二次确认后，才把它纳入当时唯一 current 版本并实施。

revision 2 将提案基线更新到已合入的 v1.68：v1.67 删除 Core 生成模型投影中的 `schemaVersion` 并升级 Bootstrap，v1.68 移除公开 Camp 的自动历史投影，改由 `RUN_FACTS.historyHint` 提示按需读取历史。普通 Prompt 引导的投递方式和权限层级选择不变；此前 revision 1 的版本号、公开 section 列表及冻结输入描述已失效。

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

Command Code 使用新增的 `prompt_guidance` Charter delivery mode。定义：

```text
B = render_session_bootstrap(
      frozenSessionCharter,
      frozenMemberIdentityPrettyJson,
      frozenMemoryEntrypoint
    )
P = exact frozen Dynamic Context payload for this AgentRun
G = "[ROVAI_PROMPT_GUIDANCE level=\"ordinary_user_prompt\"]\n" +
    B +
    "\n[/ROVAI_PROMPT_GUIDANCE]\n\n"
U = G + P
```

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

`MEMBER_IDENTITY` 只含 `name`、`teamRole`、`professionalResponsibilities`、`personalityTraits`、`workingPrinciples`、`growthTopic` 六个业务字段；空字符串和空数组仍输出，不含 `schemaVersion`。最后一个 section 仍遵守既有规则：Memory Entrypoint 为空时整段省略。`B` 使用本 Session 冻结的 Charter、身份和 Memory Entrypoint；公开 Camp 的 Charter revision 13 明确要求按需使用 `rovai camp read`，而非把 `historyHint` 误认为已读或已处理水位。

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

Core 在每个 Command Code AgentRun（包括按完整 UUID 恢复的 Run）把 `U` 作为**一个普通用户 Prompt**通过 stdin 传给 `--print --output-format json`。Rovai 不生成 Bootstrap Mod、不传 `--mod`、不为成员改写项目或用户 `AGENTS.md`。Command Code 自身的原生配置和 Mod 仍按其原生规则加载，但不作为 Rovai Bootstrap 的投递或证明。

### 2. 权限与连续性边界

`ROVAI_PROMPT_GUIDANCE` 标签只标识来源和投递层级，不伪称 System/Developer 权限。`B` 虽然仍包含 Session Charter 字样，但在 Command Code 中属于普通用户消息，可被更高权限的原生指令覆盖，也可能受到同层后续输入影响。Core 的身份、授权、CLI operation、文件和附件门禁继续在 Core 执行，不能仅依赖模型遵守 `B`。产品资料和可执行资格必须如实标记这项差异；不得宣称高权限 Bootstrap parity。

每个新 AgentRun 只组合一次 `G`，不在同一 stdin 消息中重复。按完整 UUID 恢复时重新附上本 Run 的 `G`，因此恢复后的下一次用户输入无需依赖历史会话保留旧引导。原生多轮 Tool 循环发生在同一 `--print` 进程内；若 Command Code 在该进程内压缩上下文且丢失用户层引导，Rovai 暂无可靠的逐模型调用重注入点，必须作为未验证能力记录，不能宣称压缩连续性已通过。

### 3. 冻结、预算与恢复证据

- `rendered_payload` 和其摘要仍只指 `P`；`runtime_payload` 和其摘要改为包含完整 `U`。`prompt_guidance` 是独立的 delivery mode 值，不伪装成既有的 `first_payload`、`native_append` 或 `managed_system_prompt`。
- `B` 使用本次 Run 已验证的 Native Binding/generation 和 Bootstrap evidence。组合发生在 Runtime Input Delivery 的冻结、预算、digest 计算之前。公开 Profile 9 的完整 FIFO `RUN_INPUT`、必有的 `historyHint`、可选 Task 裁剪和默认 96 KiB UTF-8 payload capacity 保持现有规则；超出 payload 上限时在启动 CLI 前拒绝，不裁剪 `B`。
- 失败恢复只能重用冻结的 `U` 或为新的 Run 重新物化；不根据已接受但结果未知的输入自动重发。Native Session 仍只用完整 UUID 精确恢复。
- 新 mode 与 Command Code Prompt Guidance revision 进入该 Adapter 的 compatibility identity。因为此前不存在正式 Command Code Binding/Manifest/Delivery，旧数据无需迁移；既有 Runtime 的冻结输入和 mode 不改变。

## 明确不变

- `SESSION_CHARTER`、六字段 `MEMBER_IDENTITY` 和 `MEMORY_ENTRYPOINT` 的现有内容、来源与 Formatter 4 字节不变。
- 当前公开 Camp 29/29/Profile 9 与非 batch 26/26/Profile 6 的 Dynamic Context section、字段、选择、预算和证据不变；其他 Adapter 的交付模式与模型输入不变。公开 `historyHint` 只作为现有 `P` 的一部分投递，不新增自动历史选择或阅读确认。
- `NATIVE_SESSION_BOOTSTRAP_CONTRACT_VERSION = native_session_bootstrap_v4`、Bootstrap Formatter 4、Session Charter revision 13 不变；新 Adapter 专用 mode/revision 是额外兼容轴。
- Built-in `rovai` CLI 的权限由 Core 逐次验证；Prompt 不代替授权或审批。
- 本提案只解决 Bootstrap 投递选择。Skills、External MCP、权限、Usage、真实认证 Smoke 与逐平台准入仍按 [Parity Matrix](parity-matrix.md) 单独验收。没有完成前不把 Command Code 宣称为 First-Class。

## 版本、迁移与兼容

确认后建立下一版本，并按[版本切换清单](../../versions/README.md#版本切换清单)使其成为唯一 current；在该版本保存 `model-context-change-command-code-prompt-guidance.md`、版本概览与实施计划，更新索引与影响表。同步当前 Context Contract、Runtime Catalog Architecture 和必要的产品说明；若此后主线 Context 基线再次变化，或实现发现上述输入 shape、发送频率、预算或恢复语义必须改变，递增本 revision 并重新取得二次确认。

`prompt_guidance` 不用于既有 Adapter 或历史数据。生产接入只生成新 Command Code Binding/Delivery；旧 staged transport 测试没有持久化的产品状态。既有公开 Manifest 28 及更早的冻结输入只保留审计原字节，不转换为 29 或重新派发。这个提案不授权把未经真实验证的平台标成 `qualified`。

## 验证

1. 在 Context 既有 owner 中检查 Bootstrap v4 的完整字节、`G + P` 顺序、空 Memory section、省略规则、每个 Run 恰好一次、预算和双摘要；公开 `P` 为 29/9/7，必有冻结 `historyHint` 且无 `SHARED_CONVERSATION`，非 batch `P` 为 26/6/5；既有 Adapter 的模型输入字节保持不变。
2. 在隔离 Command Code 1.64.0 fixture 中检查首次与精确 UUID 恢复的实际模型请求：`ROVAI_PROMPT_GUIDANCE` 和 marker 只在 user message 中，不在 system prompt、argv、公开 Activity 或 stderr；启动不传 `--mod`。
3. 检查缺失/损坏 Bootstrap evidence、超限、Session ID 错误和 stdin/进程失败均不会在缺少 `U` 时启动模型；已接受或未知结果不自动重发。
4. 完成真实账号、Tool、权限、MCP、Skill、取消、Usage、压缩和目标平台 Golden Flows 前维持 Research 或明确的受限 Preview，不将 fixture 当作正式资格。

## 二次确认

当前为 `revision: 2 / confirmation_status: pending`。用户最初选择了普通 Prompt 路线；revision 1 又在 v1.68 上下文变更合入前写成，均不算对本 revision 的二次确认。实施此模型输入变更前，需要开发者在看过本文件后明确确认 revision 2。
