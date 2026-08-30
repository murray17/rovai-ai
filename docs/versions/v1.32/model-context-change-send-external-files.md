---
document_type: model-context-change
version: v1.32
revision: 1
confirmation_status: confirmed
confirmed_by: murray17
confirmed_at: 2026-08-30
confirmed_revision: 1
last_updated: 2026-08-30
---

# 外部附件 CLI 教学变更

## 二次确认

用户先提供完整的《Rovai 方案：`rovai send --file` 外部路径静默快照》，包括下列完整提示词替换；
在审阅说明纯正文兼容、canonical/no-follow 顺序、只读树清理、25 MiB 每文件限制和安全错误映射后，
用户明确授权：“那就开启worktree，实现后pr到main merge”。此处记录该已发生的实施确认，
不扩展提示词改动范围。审阅修正属于本地文件处理和错误出口，不改变下列已确认教学文本。

## 变更前

```rust
pub const CAMP_MESSAGE_SEND_SUMMARY: &str = "Publish one public Camp message. Repeat --file to attach ordered immutable Camp attachments; at least one file can be the complete payload when no body is needed, and no separate upload is required. Use --public-only when the message must not address any Agent; it bypasses all inline Agent addressing, leaves Agent-like @text literal, and creates no Agent Delivery. Without --public-only, --to and the existing restricted inline Agent addressing may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the Principal. Use --to-principal only for a new unresolved Principal decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed.";

pub const CAMP_MESSAGE_SEND_FILE_HELP: &str = "Attach a local file to this Camp message as an immutable Camp attachment; repeat as needed.\n\nAt least one file is a complete payload, so --body may be omitted for an attachment-only message. Files appear after any message body in flag order. No separate upload command is required.";

pub const CAMP_MESSAGE_SEND_HELP_EXAMPLES: [&str; 4] = [
    "rovai send --public-only --body 'Final conclusion: the failure is a client-version regression.'",
    "rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'",
    "rovai send --public-only --to-principal --body 'Please choose whether to roll back the client or continue the token investigation.'",
    "rovai send --file \"$ROVAI_RUN_TMP/report.pdf\"",
];
```

`files` schema description：

```text
Optional AgentRun-local file or directory path; repeat --file to preserve attachment order.
```

## 变更后

```rust
pub const CAMP_MESSAGE_SEND_SUMMARY: &str = "Publish one public Camp message. Repeat --file PATH to attach ordered immutable Camp attachments from local files or directories readable by the active Runtime; Rovai privately snapshots external paths, so no manual copy or separate upload is required. At least one attachment can be the complete payload when no body is needed. Use --public-only when the message must not address any Agent; it bypasses all inline Agent addressing, leaves Agent-like @text literal, and creates no Agent Delivery. Without --public-only, --to and the existing restricted inline Agent addressing may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the Principal. Use --to-principal only for a new unresolved Principal decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed.";

pub const CAMP_MESSAGE_SEND_FILE_HELP: &str = "Attach a local file or directory readable by the active Runtime; repeat as needed to preserve attachment order.\n\nPass the artifact's existing path directly. Rovai privately snapshots paths outside the current AgentRun workspace and ROVAI_RUN_TMP before sending, so do not copy a file into either location solely for sending.\n\nWhen choosing where to create a new artifact, prefer the current AgentRun workspace or ROVAI_RUN_TMP to avoid an extra snapshot. This is an optimization, not a requirement.\n\nAt least one attachment can be the complete payload, so --body may be omitted.";

pub const CAMP_MESSAGE_SEND_HELP_EXAMPLES: [&str; 4] = [
    "rovai send --public-only --body 'Final conclusion: the failure is a client-version regression.'",
    "rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'",
    "rovai send --public-only --to-principal --body 'Please choose whether to roll back the client or continue the token investigation.'",
    "rovai send --file \"$HOME/.runtime/artifacts/report.pdf\"",
];
```

`files` schema description：

```text
Optional local file or directory path readable by the active Runtime. Repeat to preserve attachment order. Pass the existing path directly; Rovai privately snapshots paths outside the current AgentRun workspace and ROVAI_RUN_TMP before sending.
```

## 明确不变

SESSION_CHARTER、MEMBER_IDENTITY、Memory Entrypoint、所有 Dynamic Context section、历史选择/预算、
ContextManifest Evidence、Runtime Input Delivery Evidence 与公共消息寻址语义不变。
BODY、PUBLIC_ONLY、TO_PRINCIPAL 和 TO 的独立帮助文本不变。
内部快照目录和两次复制不进入模型教学。文件错误采用既有 Agent error 投影形状，不返回原始路径。

## 版本与兼容

Built-in contract/CLI/capability 从 20 升至 21，catalog digest 自动改变；Camp Attachment v7、
Camp Message Send v14、Built-in Tool Transport v21 拥有新行为。
IPC 2、Envelope 1、receipt 1、Agent Output 2、Bootstrap 与 Formatter/Manifest/Profile 版本不变。
新 invocation 不接受旧 CLI/context/capability；现有 Binding compatibility digest 会阻止旧 Binding
用于新合同。历史 receipts 与数据库对象不迁移，不重写已冻结的模型输入。

## 验证

现有教学、CLI help 和版本 owner 更新；新增 CLI 预处理 seam 覆盖外部文件/目录、混合路径、
纯正文、顺序、路径脱敏、大小边界和预处理失败清理。IPC 重试复用一次构造的请求和同一快照。
现有 Core ingress、Managed v2 事务/replay、Runtime lease 与清理测试继续覆盖权威边界。
实际执行结果记录于 [实施计划](implementation-plan.md)。
