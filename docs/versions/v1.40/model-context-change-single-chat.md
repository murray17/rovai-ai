---
document_type: model-context-change
version: v1.40
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: murray.xue
confirmed_at: 2026-09-03
last_updated: 2026-09-03
---

# Single Chat 专用 Session 与 Dynamic Context

## 变更前

Rovai 只有普通 `camp_member` Conversation 的 Agent-facing Context。Native Session Bootstrap 固定使用普通
Session Charter，其中要求 Camp-visible 结果通过 `rovai send` 发布；每轮 Dynamic Context 可以包含
`SELF_ACTIVE_TASKS`、普通 Member Skills、assigned MCP 与 A2A Guidance。公共增量为避免同一 Native Session
重复消费，会排除当前目标 Agent 自己在公屏发布的结果。

该 Context 不能安全复用于 Single Chat：Prompt 中的公开发布要求与私有 terminal route 冲突，而新的独立 Native
Session 若继续排除目标 Agent 自己的公屏消息，会遗漏它在这段私聊之外已经公开给 Camp 的事实。

## 变更后

`invocation_kind=single_chat` 使用独立、冻结资源的 Session Charter 和每轮 Guidance。Bootstrap 仍沿用同一 formatter
结构，但 Charter 替换为 Single Chat 版本：

```text
[SESSION_CHARTER]
[MEMBER_IDENTITY]
[MEMORY_ENTRYPOINT]
```

每轮 Dynamic Context 使用：

```text
[COLLABORATION_STATE]   optional
[SHARED_CONVERSATION]  optional
[RUN_FACTS]            required
[SINGLE_CHAT_GUIDANCE] required
[CURRENT_INPUT]        required and last
```

Single Chat 不投影 `[SELF_ACTIVE_TASKS]`、`[A2A_GUIDANCE]`、普通 Member Skills 或 Member-assigned MCP。专用
Charter 明确本轮 final 由产品私有路由交付，不要求或允许为交付答案调用 `rovai send`；Guidance 说明单聊与公屏
边界、可用只读能力和副作用诚实性，但不承担授权。

`SHARED_CONVERSATION` 按该 Single Chat Conversation 自己的 `(last accepted public boundary, current boundary]`
选择增量，并显式包含目标 Agent 自己的公屏消息。仍沿用现有有界消息数量、字符预算、截断、omission evidence、
tombstone/authorization 检查；公共消息不会异步推入或主动唤醒。只有本轮 Runtime Input Delivery accepted ACK 推进
该私有水位，普通成员 Conversation 水位不变。

当前资源由代码内 raw bytes 与 digest 固定：

```text
charter-rovai-single-chat.md
sha256 e789f2b83652e6ae58baedbe564a79cc834403a69de405588987e5aeb9cf05bc

single-chat-guidance-v1.json
sha256 01d31461199a3ffa90c1b85f4fe51e5ff5d3f0a150318e495748ac6cb2dfdc6b
```

## 明确不变

- ContextManifest、RuntimeInputDelivery、ACK、Native Binding、Bootstrap formatter 与现有 evidence 存储结构不复制。
- 普通 Camp member、A2A、Gather completion 与 Channel Run 的 Context section、self-output filter、Task、Skill 和 MCP
  投影保持原样。
- `single_chat_v1` Built-in allowlist 与私有 terminal route 由 Core 代码和数据库字段强制；Charter/Guidance 不是
  Capability、ACL 或输出 fence。
- v1 不重放私有 transcript、不生成恢复摘要、不恢复已取消 Native Turn，也不把 Renderer transcript 当 Runtime input。
- Workspace、Shell、Provider 内部行为和外部副作用不因 Context 文案自动成为私密或可回滚。

## 二次确认

产品 Owner 先确认普通 CLI Charter 的 `rovai send` 要求不能只靠 Prompt 修正，并要求在现有 Run、Built-in Router 与
terminal route 上结构隔离；随后明确 v1 只使用封闭 `single_chat_v1`，不新增通用 Capability Framework、私有历史重放、
恢复策略或 Runtime delegation gate。最终要求按上述最小合同补齐正式领域与输出路由并开始实现，本 revision 据此确认。

## 验证

- Context owner 固定专用 resource bytes/digest、section 顺序、`CURRENT_INPUT` 最后和排除项。
- 公共历史 owner 证明目标 Agent 自身公屏消息进入 Single Chat 增量，普通 Session 仍排除自身输出。
- ACK owner 证明只在 accepted 后推进精确 Single Chat Conversation 水位，prepared/unknown/cancelled 不推进。
- Built-in 和 terminal owner 独立证明 Prompt 外的 policy 与私有输出 fence。
