---
document_type: model-context-change
version: v1.72
revision: 2
confirmation_status: confirmed
confirmed_revision: 2
confirmed_by: User
confirmed_at: 2026-11-19
last_updated: 2026-11-19
---

# 普通重投、批次消息顺序与编辑标记 r2

r1 已在 `a6358ce46` 实现普通重投和排序。r2 在此基础上，让接收队员能识别同一条消息的新内容。
以下对照沿用 r1 的 A、B、D 示例，覆盖两项改动。

## 变更前

同一队员领取按投递入队顺序取前缀。A、B 运行期间收到 D，编辑 A 为 A′ 后，D 已先入队。
三个输入均能装入时，实际 `RUN_INPUT` 如下。只装得下两条时取 D、A′。点击继续产生独立批次，
其完整来源输入作为一个单位尝试领取。`body` 已经是 A′ 的当前内容，模型输入中没有编辑标记。

```text
[RUN_INPUT]
{"messages":[{"body":"D","messageId":"d","mentions":[],"senderId":"user","senderType":"user","sequence":3},{"body":"A′","messageId":"a","mentions":[],"senderId":"user","senderType":"user","sequence":1},{"body":"B","messageId":"b","mentions":[],"senderId":"user","senderType":"user","sequence":2}]}
[/RUN_INPUT]
```

在 r1，消息顺序已变为 A′、B、D，三个消息对象的字段与上述示例相同。

## 变更后

每个来源输入作为一份普通投递进入原队员的队列。同一消息与队员已有等待项时复用。
按消息 sequence、再按 queue_sequence 递增取预算能容纳的最长前缀，和普通投递一起领取。

```text
[RUN_INPUT]
{"messages":[{"body":"A′","edited":true,"messageId":"a","mentions":[],"senderId":"user","senderType":"user","sequence":1},{"body":"B","messageId":"b","mentions":[],"senderId":"user","senderType":"user","sequence":2},{"body":"D","messageId":"d","mentions":[],"senderId":"user","senderType":"user","sequence":3}]}
[/RUN_INPUT]
```

上例锚点为 D。只能容纳两条时，输入为上例的前两个对象，锚点为 B，D 仍等待。
普通历史边界按实际入选消息计算。队首预览、冻结的 ordinal 与模型输入顺序一致。
队员之间仍由现有调度器分配机会。

### 编辑标记与提示

公共 batch 的普通初始输入只在该条消息本次领取的 `content_revision > 1` 时输出 `"edited":true`。
修订号为 1 时省略该字段。只改附件或结构化提及也算编辑。重试和同批重排本身不增加修订号。
即使接收方第一次见到 A′，也按同一规则标记。`body` 沿用现有正文投影，包括既有的默认收件人提及。
该消息对象只增加 `edited`，旧正文、修订号和编辑时间都省略。

`RUN_FACTS.historyHint` 保留按历史边界和额外可见消息选出的原句。当本次选入的
`RUN_INPUT.messages` 至少有一条带 `edited: true` 时，在原句后加一个空格并追加以下原文一次。

```text
A message marked edited replaces any earlier version with the same messageId; follow its current content.
```

例如，历史边界为 0 且没有额外可见消息时，r1 的完整提示是
`All visible messages in this Thread are in RUN_INPUT or were written by you.`。上例的 r2 提示是

```text
All visible messages in this Thread are in RUN_INPUT or were written by you. A message marked edited replaces any earlier version with the same messageId; follow its current content.
```

选批时，每个候选前缀用自己的消息计算标记、提示和完整字节数。落选的已编辑消息不会给当前批次增加提示。
选定后，标记随消息正文冻结，提示随同一份 claim 快照冻结。后续编辑与历史读取沿用各自原有边界。

## 明确不变

本次模型可见变化限于公共普通初始输入的消息对象及其配套的 `RUN_FACTS.historyHint`。
Steer 使用本次插话自身的输入和原提示，包括它送入曾处理过已编辑消息的 Run 时。
历史工具、Single Chat、其余 section、预算算法、Bootstrap、原生 Session 和消息操作界面沿用既有合同。
历史 Run 保留各自冻结的输入顺序和快照。用户重试使用新的普通执行及其 Manifest。

## 迁移与兼容

r1 的迁移 231 将旧等待请求的有效清单展开为普通投递。旧客户端可传 `useNewSession`，重投使用普通会话选择。

r2 在本分支拟用公共 Formatter/Manifest **45/45**，公共 Run Facts schema **14**，Delivery Profile **15**。
当前公共组合为 43/43、Facts 11。非 batch 已使用 44/44、Facts 13，本轮沿用该组合。
新公共初始输入与 Steer 继续共用公共格式版本，Steer 输出既有消息字段和既有提示。
沿用现有版本机制扩展 SQLite 对新组合的写入准入，旧版本的 claim、Manifest、输入字节及摘要继续按原记录恢复。
编辑标记来自已有内容修订号，消息存储无需新增字段。

## 验证

在固定基线 1a9fdda250454f9c4a7d0bd12eeabd9f42953c41 对照重复重投、部分领取再点、
改投、删除、A′/B/D 充分与截断预算、跨队员以及历史输入。检查实际选入的 ordinal、锚点、
等待数量和队首。r2 在同一流程核对真正交给 Runtime 的输入。

- A 编辑后重投，只有 A′ 带 `edited: true`，提示出现一次，旧 Manifest 的正文、提示和摘要仍与领取时一致。仅改附件也命中。
- 未编辑的批次及其普通重试沿用原消息字段和原提示。若第一条已编辑消息落在字节预算外，当前前缀也使用原提示。
- 同一批中的两条消息都编辑过时，两条各自有标记，提示仍只有一句。向该 Run 发送后续插话时，插话沿用原提示。

排序与标记合跑一次[通用 12 Case Gate](../../development/evaluation.md#上下文改动-gate)。基线使用上述 r1 之前的固定提交，
候选使用含 r2 实现的新构建。选用同一套件的 12 个 Case、既有通过标准及每 Case 预算，同一 campaign 最多两次尝试。
运行前固定实际模型、Judge 和总时限。定向断言验证字段及冻结字节，配对 Gate 验证整体任务表现。

## 二次确认

r1 的排序与重投由 User 在消息 `e5f20e34-6ca3-4359-8a98-59b19ebf624d` 确认。
r2 的编辑标记及条件提示来自消息 `ed9eb7c3-b45e-46b2-b7a2-8c93018900f9`。
User 审阅 r2 后，在消息 `b8561ae8-8921-44d6-a018-f9b4a249340f` 确认实施及合入 main。

## 实现

公共 Formatter/Manifest **45/45**、Facts schema **14**、Profile **15**。
Migration 232 / schema 182 扩展版本约束并保留旧 claim、Manifest 与 Runtime 接收证据。
版本配对和提示分别由 [ContextManifest v45](../../contracts/context-manifest-evidence-v45.md)
和 [Run Facts v11](../../contracts/run-facts-v11.md) 维护。

### 实际输入对照

基线 `1a9fdda25` 和 r2 `1a2a310c6` 分别用隔离 Core、普通消息提交 API 与同一个可记录 ACP 输入的夹具。
在 A 开始后依次发送 B、D，再编辑 A。基线收到 B、D、A′，锚点为 A′。r2 收到 A′、B、D，锚点为 D，
仅 A′ 带 `edited: true`，提示追加一次。两侧都保留旧 Run 的原 claim 和 payload Blob。
定向回归通过未编辑重试、附件编辑、同批多个编辑消息、预算截断、Steer 和迁移后物化 v43 claim。
实际输入对照使用测试 Runtime。通用 12 Case 的模型语义验收由独立 Gate 记录。
