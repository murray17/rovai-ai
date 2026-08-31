---
document_type: model-context-change
version: v1.37
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: murray.xue
confirmed_at: 2026-08-31
last_updated: 2026-08-31
---

# 文件交付教学与飞书 Camp Bootstrap

## 确认范围

revision 1 已由开发者在阅读完整变更说明后，以“确认”单独同意实施；不把此前图片方案的实施授权代替
Bootstrap 的二次确认。
沿用用户原方案的完整教学文本，只将渠道判断范围收窄为飞书。图片展示、路径读取、混合存储和 ACP
累积是独立的本地观察能力，不向模型增加图片字段，也不等待本教学变更生效。

## 变更前

所有 Camp 的 Built-in CLI Charter 都来自未修改的
[`charter-rovai-cli.md`](../../../crates/rovai-core/resources/charter-rovai-cli.md)，没有渠道文件交付提示。
它在 Session Charter 中位于既有 Authority boundaries 后、Adapter 专用指导前。

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

## 变更后

普通 Camp 和钉钉 Camp 的静态 Charter 文本保持原样。创建新 Native Session Bootstrap 时，只有当前 Camp
存在 `provider=feishu` 且 `status=active` 的 conversation binding，才在 Built-in CLI Charter 的最后一条后
追加一个换行与下列完整 bullet；不增加空 section，不改变 Adapter 专用指导及其分隔符：

```md
- This Camp is connected to an external channel. Local file paths and Runtime image previews are not delivered there; when the recipient needs the file itself, include `--file <path>` in the corresponding `rovai send` message.
```

Quick Chat 和 Project 使用同一个 Camp 级判断。后续 Run、关闭 binding 或从本地继续聊天均不修改同一
Native Session 已冻结的 Charter；下一次正常创建新 Binding 时才重新判断。

完整 CLI 教学替换如下：

```rust
pub const CAMP_MESSAGE_SEND_SUMMARY: &str = "Publish one public Camp message. Use --public-only when the message must not address any Agent; it bypasses all inline Agent addressing, leaves Agent-like @text literal, and creates no Agent Delivery. Without --public-only, --to and the existing restricted inline Agent addressing may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the Principal. Use --to-principal only for a new unresolved Principal decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed.";

pub const CAMP_MESSAGE_SEND_FILE_HELP: &str = "Attach a local file or directory readable by the active Runtime to this message; repeat to preserve attachment order. Use this only for recipient-facing files the recipient needs. Do not attach temporary, intermediate, cache, log, or diagnostic files.";

pub const CAMP_MESSAGE_SEND_HELP_EXAMPLES: [&str; 3] = [
    "rovai send --public-only --body 'Final conclusion: the failure is a client-version regression.'",
    "rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'",
    "rovai send --public-only --to-principal --body 'Please choose whether to roll back the client or continue the token investigation.'",
];
```

## 明确不变

- 静态 Charter 资源文件、Authority boundaries、Member Identity、Memory Entrypoint 和 Adapter 专用指导不变。
- Dynamic Context、CURRENT_INPUT、History/Task/Gather 选择及预算、Manifest 和 Profile 不变。
- `files` 输入字段、纯附件发送、快照、幂等、Agent addressing、Owner attention 和回执语义不变。
- Runtime 图片不是 Camp Attachment，不进入模型 Context，不产生 CampMessage 或渠道投递。
- 不增加每 Turn 提示、动态 tool schema、授权交互，也不因 binding 状态变化主动旋转 Native Session。

## 版本、迁移与恢复

Session Charter revision 从 2 升至 3，沿用已有 Binding compatibility digest；升级后的下一次执行通过既有
兼容路径创建新 Binding，不新建一种 Session 重启机制。新 Bootstrap evidence 冻结实际文本和摘要；已有
Binding、Bootstrap evidence 与历史输入保留，不原地改写。Native Session Bootstrap contract v3、Bootstrap
Formatter 3、AgentRun Formatter 22、ContextManifest 22 和 Delivery Profile 4 保持不变，因为结构未改变。

教学的 catalog digest 使用实际新文本自然更新；Built-in transport、CLI/capability 版本与 schema 不变。
这部分没有数据库迁移，图片自己的新增表迁移不用于失效任何模型输入。

## 二次确认

2026-08-31，开发者 murray.xue 在收到本 revision 的完整前后对照及单独实施确认请求后回复“确认”。
该回复确认 revision 1；本文前后合同未作语义调整。代码实施从本确认记录之后开始。

## 验证

扩展已有教学与 Charter owner：普通/钉钉/关闭 binding 不追加，飞书 Quick Chat/Project 新 Session 恰好追加
一次，同一 Session 冻结不随 binding 开闭变化。保持纯正文和纯附件发送测试，验证旧 evidence 可读取；不靠
字符串猜测渠道，不更改已确认的路由/预算。图片链路另验真实解码、混合存储、终态累积和无渠道副作用。

## 实际实施

已按上述完整文本实施：Session Charter revision 3；Bootstrap v3 / Formatter 3、AgentRun Formatter 22、
ContextManifest 22、Delivery Profile 4 与 Built-in v21 均保持原值。没有新增模型字段或数据库迁移。
查询位于 Bootstrap evidence 新建分支，复用分支只读取原 Blob；移除未被调用的实时 Charter 构建入口，
避免另设一条绕过 evidence 冻结的生成路径。静态 `charter-rovai-cli.md` 未修改。

[Camp Message Send v16](../../contracts/camp-message-send-v16.md) 接替旧教学合同；这里只增加文档合同版本，
不改变 wire/schema。实际执行的回归与剩余图片验收边界见[实施计划](implementation-plan.md)。

确认文本与实现逐字一致；完整 Rust 默认回归 685 项、Context slow tests 43 项、包含 slow tests 的
Clippy、类型检查及普通/固定 main base 文档门禁均通过。没有 push、打包或重启日常 App。
