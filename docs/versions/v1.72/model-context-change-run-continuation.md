---
document_type: model-context-change
version: v1.72
revision: 2
confirmation_status: confirmed
confirmed_revision: 2
confirmed_by: local_user
confirmed_at: 2026-10-07
confirmation_message_id: 12fb654b-48b4-4173-9459-973be554e761
last_updated: 2026-10-07
---

# 用户主动继续执行：模型输入对照 r2

User 在审阅 r2 HTML、技术大纲及提示词前后对照后，明确授权建立 worktree 实现并推送远程分支。
修订依据为 `ddf3afb3-1082-4a61-854c-98f03a602bd6`；交付消息为
`b0dec2f2-5873-4b14-9804-717e9af39a4e`。本文件记录已确认的输入语义，不替代实现和验证结果。

## 变更前

普通公开 Run 从新领取的消息集合构建 `RUN_INPUT`，并调用现有 builder 构建当前动态上下文。
失败或停止的 Run 没有用户主动继续入口。已接受或结果未知的 Runtime 投递不可重放。

以下为原 Run 的输入示例；未列出的既有身份、协作及 Skill 段保持原模板。

```text
[SELF_ACTIVE_TASKS]
{"tasks":[]}
[/SELF_ACTIVE_TASKS]

[RUN_FACTS]
{"attachmentOutputRoot":"/workspace/attachments/thread-example","historyHint":"As of this run's start, all visible messages in this Thread are already in RUN_INPUT or were written by you."}
[/RUN_FACTS]

[RUN_INPUT]
{"messages":[{"body":"@爱丽丝 检查导出流程，修复保存失败后按钮无法再次操作的问题，保留现有界面。","messageId":"message-1","senderId":"local_user","senderType":"user","sequence":1}]}
[/RUN_INPUT]
```

## 变更后

用户点击继续图标，授权一次新的执行。以所选 Run 的原业务输入集合构建 `RUN_INPUT`，启动新 Run 时
复用现有 builder 重建 Task、成员职责和 RUN_FACTS。来源标识仅保存在内部请求中，不进入模型输入。
不增加 `continuation.sourceAgentRunId` 或替代字段，不附加“继续”句子、CLI 教学、证据、输出文件或摘要。

```text
[SELF_ACTIVE_TASKS]
{"tasks":[]}
[/SELF_ACTIVE_TASKS]

[RUN_FACTS]
{"attachmentOutputRoot":"/workspace/attachments/thread-example","historyHint":"The latest public message before your last recorded run in this Thread had sequence 1. As of this run's start, there are additional visible messages after that sequence beyond RUN_INPUT and messages written by you."}
[/RUN_FACTS]

[RUN_INPUT]
{"messages":[{"body":"@爱丽丝 检查导出流程，修复保存失败后按钮无法再次操作的问题，保留现有界面。","messageId":"message-1","senderId":"local_user","senderType":"user","sequence":1}]}
[/RUN_INPUT]
```

本例只体现已有 historyHint 分支的变化。Task、成员与事实的实际值取决于新执行的当前状态。
RUN_INPUT 的字段仍为当前消息投影：body、messageId、senderId、senderType、sequence，以及按既有规则
出现的附件、引用和 Skill 字段；没有新增可选字段或省略规则。来源可以有多条输入，必须完整、有序地承接。

## 明确不变

- Bootstrap、Charter、身份、Skill 注入、历史可见性、筛选和预算规则保持现状。
- Formatter / ContextManifest 32、Run Facts 9（公开 Thread 投影）、Context Delivery Profile 10 保持；
  本次改变输入授权和选择入口，不改变模型文本格式及其证据编码。
- 新请求由现有命令幂等、事件和 Delivery lane 持久化；新 Run 建立自己的 Manifest 和 Runtime Input Delivery。
  原 Run、原 Delivery、接受记录、Manifest、文件与工作区进度不重置。
- 同一来源允许多个独立请求；相同命令重传不重复执行。各 Run 状态独立，不建立前后继状态链。
- 会话兼容及旧进程清理遵循现有规则。显式新会话确认只授权后续新执行，不等于回滚工作区。

## 迁移与兼容

采用增量数据库迁移保存内部请求来源，并允许一次续做 Delivery 承载原有多条业务输入。
既有输入、投递、事件与模型证据原样保留；不执行 clean break。旧 Core 不得直接写入新 schema。
普通消息的合批不跨越续做请求；续做作为独立批次完整承接来源输入。

## 验证

验证单次请求幂等、多次主动重试、清理和 FIFO 边界、原终态与证据不变、动态上下文重新构建、
新会话确认、恢复失败无隐式空会话回退，以及被撤回输入、成员离队和明确业务失效的拒绝路径。
实际命令与结果记录在本版本的续做实施记录中；模型可见字段不得超出上述 r2。

## 二次确认

User 已在审阅 r2 对照后，于 2026-10-07 明确指示开启 worktree 实现并推送远程分支，确认 revision 2。
本次实现不得扩大提示词范围；若超出上述已确认内容，先更新对照再确认。

## 实施结果

实现保持已确认 r2 的模型字段和 Formatter / Manifest 32、Run Facts 9、Profile 10；
Migration 184 / schema 134 只保存内部新授权与输入约束，保留既有模型证据。
确定性验证证明新 Run 读取当前 Tasks、重新构建动态上下文且只包含原业务消息，不含来源 Run ID 或续做段。
实际验证与真实模型 Gate 缺口见[实施记录](run-continuation-implementation.md#验证记录)。
