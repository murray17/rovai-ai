---
document_type: implementation-plan
version: v1.50
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-05
---

# v1.50 实施与验收

## 当前交付

- [x] Migration 140 / data contract v1.50 / projection schema 91 扩展 Conversation、CampTurn、AgentRun 与
  ConversationMessage，增加 Single Chat Composer Draft、Pending Input 和 Edit Session；不创建私聊专用附件内容表。
- [x] Core 实现 `singleChat.open/list/get/send/end`、Source Ref Draft 增删、Conversation-local Pending FIFO 与编辑/repair；
  mutation 维持 command idempotency 和 exact Camp/Conversation/Run identity fence。
- [x] Single Chat 用户消息把有序 Source Refs 固定到 `conversation_message.source_attachments_json`；agent final 与其他
  ConversationMessage 默认为空数组，Snapshot/History 只返回清洗后的公共附件元数据。
- [x] 公共 `load_agent_run_source_attachments` 与 `load_source_attachment` 支持 exact Single Chat message/composer/pending/
  pending-edit owner；dispatch 复用 `resolve_source_attachments_for_run` 和 `ROVAI_RUN_TMP/source-attachments`。
- [x] 删除 `SingleChatAttachmentStore`、私有 copy/receipt/projection/retention、`single-chat-attachments` 与
  `single-chat-input-attachments`；Context 只接收公共 resolved paths。
- [x] Single Chat Context 修复 A2A lineage 分支，Bootstrap 不投递 Memory，Skill exposure 排除两个 official bundled
  Skill；Built-in policy、private final、重启取消与 successor 隔离保持既定边界。
- [x] Renderer/Preload/Main bridge 接入 Source Ref Draft 与 Pending 编辑，复用公共拖拽识别、AttachmentCard、Preview、Open、
  Reveal 和 FilePreview；文件选择、拖拽与粘贴临时文件进入同一 Source Ref 流程，运行中 Composer 可继续发送，空 Draft
  仍显示停止动作。
- [x] 更新 Single Chat 原生 UI fixture、类型合同、Architecture/Contract/UI/Context 与当前版本/决定导航。

## 验收矩阵

| Gate | 状态 | 证据 |
| --- | --- | --- |
| Single Chat Core 定向回归 | `passed` | 10 项测试通过；覆盖私有 final/迟到 fence、Source Ref 消费与 Run 解析、exact locator、History 公共元数据、消息 Source Ref 不可变、FIFO 发布、missing repair 和 Skill policy |
| Migration 140 原子性 | `passed` | v1.49/schema 90 准入、receipt failure 回滚、旧私聊附件表缺失与 v1.50 current marker 定向测试通过 |
| TypeScript 与 Renderer 回归 | `passed` | `pnpm typecheck` 通过；Vitest 152 个文件、1529 项测试通过，其中 App 与 SingleChatPanel 定向回归共 166 项 |
| 原生 Single Chat UI | `platform-blocked` | fixture 已接入共享 Electron sandbox admission；当前嵌套 macOS sandbox 被规范化识别并跳过，不把未运行的原生断言记作通过 |
| Rust 总门禁 | `passed` | workspace/all-targets check、CLI 33 项、Core binary 219 项和适用的 Core lib 505 项测试通过；一个未改动的 macOS sandbox-exec 测试因宿主返回 `Operation not permitted` 被定向排除 |
| Desktop / 文档总门禁 | `passed` | Desktop production build、完整 `pnpm test`、`pnpm docs:test`、`pnpm docs:check`、相对 main 的 diff-aware 文档门禁与 diff hygiene 通过 |

## 完成条件

- Single Chat 与 Camp 附件不存在第二套内容存储、解析、预览或打开协议；Source Ref 的 weak durability 与安全重检一致。
- Draft revision 与 Conversation version 独立；发送失败不写 Message/Turn/Run、不清空 Draft，也不推进 Conversation version。
- 排队输入只在当前 Conversation 空闲时按 FIFO 发布；失效附件可见、可修复且不会让后项越过队首。
- Runtime input、final、History、Renderer subscription 与 attachment owner 都按精确 Conversation/Run/epoch 身份隔离。
- 普通 Camp Conversation、Camp public queue、Channel、Memory、Task、Runtime capability 与跨 Conversation ordering 不变。
