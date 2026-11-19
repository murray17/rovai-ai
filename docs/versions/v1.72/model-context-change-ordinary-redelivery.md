---
document_type: model-context-change
version: v1.72
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: local_user
confirmed_at: 2026-11-19
confirmation_message_id: e5f20e34-6ca3-4359-8a98-59b19ebf624d
last_updated: 2026-11-19
---

# 普通重投与批次消息顺序 r1

## 变更前

同一队员领取按投递入队顺序取前缀。A、B 运行期间收到 D，编辑 A 为 A′ 后，D 已先入队。
三个输入均能装入时，实际 `RUN_INPUT` 如下。只装得下两条时取 D、A′。点击继续产生独立批次，
其完整来源输入作为一个单位尝试领取。

```text
[RUN_INPUT]
{"messages":[{"body":"D","messageId":"d","mentions":[],"senderId":"user","senderType":"user","sequence":3},{"body":"A′","messageId":"a","mentions":[],"senderId":"user","senderType":"user","sequence":1},{"body":"B","messageId":"b","mentions":[],"senderId":"user","senderType":"user","sequence":2}]}
[/RUN_INPUT]
```

## 变更后

每个来源输入作为一份普通投递进入原队员的队列。同一消息与队员已有等待项时复用。
按消息 sequence、再按 queue_sequence 递增取预算能容纳的最长前缀，和普通投递一起领取。

```text
[RUN_INPUT]
{"messages":[{"body":"A′","messageId":"a","mentions":[],"senderId":"user","senderType":"user","sequence":1},{"body":"B","messageId":"b","mentions":[],"senderId":"user","senderType":"user","sequence":2},{"body":"D","messageId":"d","mentions":[],"senderId":"user","senderType":"user","sequence":3}]}
[/RUN_INPUT]
```

上例锚点为 D。只能容纳两条时，输入为上例的前两个对象，锚点为 B，D 仍等待。
普通历史边界按实际入选消息计算。队首预览、冻结的 ordinal 与模型输入顺序一致。
队员之间仍由现有调度器分配机会。

## 明确不变

RUN_INPUT 消息 shape、可选字段、其余 sections、预算字节算法、证据持久化与上下文编码沿用
现有公共 batch 路径。公共 batch Formatter/Manifest 43、通用 Formatter/Manifest 44、Bootstrap、Run Facts 与 Delivery Profile 沿用
本次基线的版本。历史 Run 保留各自冻结的输入顺序和快照。用户重试使用新的普通执行及其 Manifest。

## 迁移与兼容

将旧等待请求的当前有效清单展开，已领取和终态的输入证据保留。旧客户端可传 useNewSession，
重投采用普通调度的会话选择。迁移编号由当前主线分配。

## 验证

在固定基线 1a9fdda250454f9c4a7d0bd12eeabd9f42953c41 对照重复重投、部分领取再点、
改投、删除、A′/B/D 充分与截断预算、跨队员以及历史输入。检查实际选入的 ordinal、锚点、
等待数量和队首。真实任务评测口径沿用[上下文 Gate](../../development/evaluation.md#上下文改动-gate)
的通用 12 Case、套件预算和两次尝试上限，确定性验证与实际模型结果分别记录。

## 二次确认

Thread 中 User 的方案（消息 c39ef7fe-a66c-47ec-9be2-f60585c6c73f）给出普通重投、批次排序及
A′/B/D 前后输入。经核对具体队首、预算截断、历史和迁移边界（消息
5488cff8-60aa-4620-8da1-ea9ef1f83ff6），User 明确指示拉取 main 并开始实施。本文件归档这次确认的范围。
