---
document_type: model-context-change-proposal
runtime: command-code
baseline_version: v1.70
target_version: unassigned
revision: 4
confirmation_status: pending
authority: proposal-only
implementation_status: not_started
last_updated: 2026-09-25
---

# Command Code 普通 Prompt 引导：当前基线提案 revision 4

本提案把[已确认的 revision 3](prompt-guidance-proposal.md)移到合并 `main` 后的当前 Context 基线。相对于 revision 3，投递规则仍是共享 `first_payload`，但 `B`、`P` 的**实际字节**已因 v1.70 Skills 和 `historyHint` 改变；旧确认不能授权在新基线上建立 Command Code Product Adapter。本文件先供开发者完整审阅。确认后须把它写入届时唯一 current 版本的独立模型上下文变更说明，完成版本影响表和相应 Decision；研究提案本身不充当准入决定。

## 变更前：当前精确结构与选择

仓库仅有内部 `command_code.rs` headless 传输。它接受 Core 已准备的 `PreparedContext.runtime_payload`，要求 `first_payload` mode，并通过 stdin 交给原生 `--print --output-format json`；没有 Product Adapter、Native Binding、AgentRun dispatch、ContextManifest、App Camp 或公开验收。以前针对 Command Code 的 Mod/system 注入只是隔离研究；没有产品输入或生产持久数据。

新 Native Session 的现行 Bootstrap 是 `native_session_bootstrap_v5` / Formatter 5 / 普通 Camp Charter revision 14。现有 Binding 保留自己的冻结 v4 或 v5 Bootstrap；Charter 兼容摘要仍使用 v4 / Formatter 4 / revision 13 / 非 batch 26，不能因新建 Charter 14 而旋转旧 Binding。当前新建 Bootstrap 的完整相关 section 顺序与出现规则为：

```text
[SESSION_CHARTER]
{frozenSessionCharter.trim()}
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
{six-field member identity pretty JSON}
[/MEMBER_IDENTITY]

[ROVAI_PLATFORM_SKILLS]
{"root":"<managed skill root>","skills":[{"name":"cli-operations","desc":"<complete managed frontmatter desc>"},{"name":"memory-stewardship","desc":"<complete managed frontmatter desc>"}]}
[/ROVAI_PLATFORM_SKILLS]

[MEMORY_ENTRYPOINT]
{frozenMemoryEntrypoint.trim()}
[/MEMORY_ENTRYPOINT]
```

尖括号只说明值，生成字节中不存在。`MEMBER_IDENTITY` 固定六字段 `name`、`teamRole`、`professionalResponsibilities`、`personalityTraits`、`workingPrinciples`、`growthTopic`，无 `schemaVersion`；空字符串或空数组照常序列化。平台 section 是来自受管 Skill 的 JSON 单行，按名称排序，root 只出现一次；其准确 `desc` 由当前 [Skills Rebuild v1](../../contracts/skills-rebuild-v1.md)及受管源确定，不由本提案改写。`MEMORY_ENTRYPOINT` 仅在非空时出现；Single Chat 省略它并使用其专用限权 Charter。Charter 原文及其条件、平台和 Memory 的来源完全沿用现行合同；本提案不改这三个 section 的任何内容或选择。

新公开 Camp batch 的 `P` 为 Formatter/Manifest 31、Profile 10、Run Facts 8，完整相关 section 顺序如下：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[RUN_FACTS]
[WORKSPACE]?
[ROVAI_ADDITIONAL_SKILLS]
[RUN_INPUT]
```

`RUN_FACTS` 必有 `attachmentOutputRoot`、`historyHint`；可选 `mission`、`taskContext`、`sessionContinuity`、`externalEffect`，不含 `schemaVersion`。`historyHint` 严格按 [Run Facts v8](../../contracts/run-facts-v8.md)中四句完整文本，从 claim 事务冻结的 `P` 边界和额外可见消息布尔值选择；它不是已读或完成水位。`ROVAI_ADDITIONAL_SKILLS` 必有，即使集合为空，完整格式为：

```text
[ROVAI_ADDITIONAL_SKILLS]
Current for this run; replaces any earlier Rovai Additional Skills.
{"root":"<managed skill root>","skills":[{"name":"<selected name>","desc":"<complete managed frontmatter desc>"}]}
[/ROVAI_ADDITIONAL_SKILLS]
```

`skills` 取接收队员当前工具箱配置与本 Run 显式选用的工具箱技能并集，按名称去重排序；空集合输出 `"skills":[]`。`RUN_INPUT.messages` 保持完整 FIFO 本轮工作项，包括其实际冻结的 quotes、attachments 和可选技能引用；不自动注入公屏历史，`historyHint` 不能代替按需 `camp.read`。Profile 10 的冻结 JSON 为 `{"profileVersion":10,"maxSelfActiveTasks":8}`，完整文本参与默认 96 KiB UTF-8 payload 上限；可选 Task 按现有规则裁剪，不能截断 Skills、hint 或当前消息。冻结 Manifest 和恢复规则由 [ContextManifest v31](../../contracts/context-manifest-evidence-v31.md)拥有。

新非 batch 的 `P` 为 Formatter/Manifest 27、Profile 7、Run Facts 5，其完整相关顺序为：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[SHARED_CONVERSATION]?
[RUN_FACTS]
[WORKSPACE]?
[ROVAI_ADDITIONAL_SKILLS]
[A2A_GUIDANCE | SINGLE_CHAT_GUIDANCE]?
[CURRENT_INPUT]
```

两种 Guidance 仅在对应模式出现；Single Chat 不投递 `SELF_ACTIVE_TASKS`，其 `RUN_FACTS.conversationMode` 必有。非 batch 不含 `historyHint`；Skills section 同上必有，其他字段、选择、预算及遗漏保持现行 Profile 7 / Manifest 27。以上都是共享 Context owner 的现行输入，不为 Command Code 建立第二套选择器。

## 变更后：Command Code 的完整交付语义

Command Code Product Adapter 选择现有 `CharterDeliveryMode::FirstPayload`。令 `B` 为上述目标 Native Binding 已冻结 Bootstrap 的**完整原字节**，`P` 为该 AgentRun 的完整冻结 Dynamic Context 原字节，`U` 为写入 CLI stdin 的单个普通用户 Prompt：

```text
bootstrapRequired = requiresNewNativeSession || bootstrapEvidenceDigestChanged
bootstrapPayload = if pendingQualifiedCompactionRedelivery then
                     render_bootstrap_redelivery_overlay(B)
                   else if bootstrapRequired then B
                   else none
U = if bootstrapPayload exists then bootstrapPayload + "\n\n" + P else P
```

其中补发包裹使用共享 formatter 的全文：

```text
[ROVAI_BOOTSTRAP_REDELIVERY reason="context_compaction"]
This is Core recovery context for the existing Native Session, not a new task or Session.

{B.trim()}
[/ROVAI_BOOTSTRAP_REDELIVERY]
```

首次新 Session、已证明的 Bootstrap evidence 变更、合格压缩信号后的下一次 eligible 输入分别沿用共享规则；正常 warm 或完整 UUID cold resume 只发新 `P`，不因进程重新启动而重投 `B`。Command Code `--resume` 只使用最终 `result.sessionId` 的完整 canonical UUID，不用 `--continue`、前缀、路径或最近 Session。Core 不生成 Bootstrap Mod，不传受管 `--mod`，不改写用户/项目 `AGENTS.md`。Command Code 自己的原生配置按原规则加载，但不构成 Rovai Bootstrap 证明。

**权限差异：**`U` 是普通用户消息，`B` 虽含 Charter 字样，却没有 System/Developer 指令层级。Core 的身份、授权、CLI 操作、附件和文件权限仍独立执行；产品资料及资格必须明确此差异。原生 1.65.2 的手动 `/compact` 和后续原生恢复已实测，但尚无合格的 Rovai 压缩信号、同进程自动/溢出压缩补发或 Core 重启证据；不能把模型复述旧标记当作 Charter 连续性通过。若该差异与 [Runtime 接入 Checklist](../../development/runtime-integration-checklist.md#34-bootstrap-与-context)不能形成当前 Version Decision 的明确接受，就不能进入正式 First-Class。

## 明确不变、证据与兼容

- 不改 Bootstrap/Charter/Skills/Memory 的内容、来源或出现条件，不改公开 31/10/8 与非 batch 27/7/5 的 section、字段、选择、预算或遗漏规则，不改其他 Runtime 的交付模式或模型输入。
- `rendered_payload` 及摘要只指 `P`；`runtime_payload` 及摘要精确绑定 `U`。复用现有 `first_payload` mode、`bootstrap_in_runtime_payload` presence、Bootstrap evidence、Native Binding generation 与 Runtime Input Delivery 冻结证据，不增加 mode、marker、字段或版本轴。`B`/补发 Envelope 加入后 `U` 超过预算时，在启动 CLI 前拒绝，不截断 `B`。
- 同 Run 恢复只使用已冻结 `U`；失败或未知接受结果不自动重发。旧 Binding 使用自己的原版 Bootstrap，旧公开 30/10/7、29/9/7 与旧非 batch 26/6/5 只按现有完整冻结证据有界恢复；旧公开 28 及更早不派发。此前没有正式 Command Code Binding 或 Manifest，因此本 Adapter 不迁移其生产数据。
- 当前实际新建 Bootstrap v5／Formatter 5／Charter 14 与 Binding 兼容摘要的旧 v4／Formatter 4／Charter 13 分别计算；本提案不改变它们。Context 与 Schema 版本轴不因新增 Adapter 自身升级。是否另开产品版本及 Catalog/平台 Preview、First-Class 决定由版本流程单独记录；本提案不授权将缺失轴标成 qualified。

## 验证与负向测试

1. 检查新 Binding 的 v5 Bootstrap 四段顺序、空 Memory 省略、六字段身份、完整平台 JSON；旧 Binding 原字节不变。检查新公开 31/10/8、非 batch 27/7/5 的当前输入与冻结 digest。其他 Adapter 的 `runtime_payload` 完全不变。
2. 用隔离真实 Command Code 及受控 endpoint分别检查首次请求最新 user message 为 `B + "\n\n" + P`、普通恢复最新 user message 仅为新 `P`，原生历史仍含首次 `B`；不从 system message 或 Mod 冒领 Bootstrap 证明。
3. 检查缺失/损坏 Bootstrap evidence、完整 UUID 不存在、首次组合超 96 KiB、stdin/进程失败均在缺少应有 `U` 时失败关闭；未知结果不自动重投。手动、阈值、溢出加重试及压缩后 Core 冷恢复逐项证明合格补发，未证明的项保持阻断。
4. 真实 AgentRun/Camp 验证 `read_file`、`edit_file`、`shell_command` 的 Action output、stdout/stderr/空输出/非零退出、权限拒绝/取消、Built-in `rovai` CLI、Skills/MCP 隔离、Usage 归属、Missing-Send 和进程清理；App Camp 保留供逐项查看。按目标版本与平台记录每一能力轴的 Runtime evidence 与 Rovai implementation。

## 二次确认

revision 3 的确认只覆盖当时 v1.68 的 v4／29 输入。本 revision 4 目前 **pending**：需在开发者看完本文件后明确同意，才能按[核心模型上下文变更治理](../../development/model-context-change-governance.md)写入当前版本并修改 Product Adapter 的模型输入路径。届时记录确认消息、时间、`confirmed_revision: 4`；若语义再变，递增 revision 并重新确认。
