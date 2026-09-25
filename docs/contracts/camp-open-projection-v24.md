---
document_type: protocol-contract
contract: camp-open-projection-v24
authority: camp-open-run-input-summary
status: accepted
version: 24
source_version: v1.69
last_updated: 2026-09-24
---

# Camp Open Projection v24

继承 [v23](camp-open-projection-v23.md) 的 Open schema 8、有界 Run 集合、空 Execution Evidence、独立 change watermark 和零写入读取边界。为公开 Camp 的 `AgentRunView` 增加 `inputSummary: string | null`，完整 Snapshot 与 Open 使用同一读取实现；不增加持久化列或修改模型上下文。

## Run 标题来源

Core 按每个返回 Run 的首个 `agent_run_input`（ordinal 顺序）选取消息；没有输入记录时依次使用 anchor、历史 `trigger_camp_message_id`、历史 CampTurn 的 Camp message trigger。消息必须属于当前 Camp 且未 tombstone。标题来源的选择不依赖聊天消息分页、消息缓存或返回的 Turn 窗口。

只按选中的消息 ID 批量读取，并复用消息正文渲染和附件 metadata 顺序。正文空白归一为单个空格；纯附件消息使用首个附件名，多附件附加“等 N 个附件”。摘要最多 240 个 Unicode scalar，超出时以末尾 `…` 表示省略。原文仍由原消息阅读入口提供。

已撤回消息只显示 `Message withdrawn`；缺失、tombstone、跨 Camp、无正文且无附件的来源返回 null。不得因为首条输入不可用而使用后续输入替换该 Run 的标题身份。读取不检查附件文件、不访问 publication event、不写回标题，也不扩大 Open 的 20 条消息与 96 个 Run 窗口。

Renderer 优先使用 `inputSummary`。显式 null 使用原有 purpose/“执行记录”回退，不从旧缓存恢复不可用原文；缺失字段的旧投影兼容原有消息查找路径。Desktop、Web 与 Mobile 共用该行为。

## 验收

- 首条输入位于首屏消息页之外时，当前与历史 Run 保留触发摘要；加载旧消息或重开 Camp 不改变标题来源。
- 多输入 batch、历史直接 Run、纯附件、长 Unicode 文本及不可用来源有明确结果。
- SQL boundary owner 在禁止 event_log 读取时通过，打开成本不随无关 Camp 的 Event/Evidence 数量增长。
