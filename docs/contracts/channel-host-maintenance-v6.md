---
document_type: protocol-contract
contract: channel-host-maintenance-v6
authority: channel-host-adaptive-maintenance-and-quiescence
status: accepted
version: 6
source_version: v1.72
last_updated: 2026-11-26
---

# Channel Host Maintenance v6

继承 [v5](channel-host-maintenance-v5.md) 的 Host 权限、单事务 tick、FIFO、Outbox lease、终态收口和按需 watchdog。
本版统一飞书、Lark 和钉钉父群名单的查询时机，补充 [Channel Message Bridge v1](channel-message-bridge-v1.md) 的入站与投递流程。
取得查询起点的只读请求分别为 `channels.roster.begin`、`channels.lark.roster.begin`、`channels.dingtalk.roster.begin`，返回 Core 生成的 `startedAt`。各 Host 将该值与本轮已观察的全部已发布 App ID 一起提交给本渠道的 `roster.reconcile`。

## 开工与查询

- 有效群入站先将观察写入 Core，再对该父群读取一份完整名单并 finalize。同一消息在恢复、多 Bot 聚合或提交重试时复用原 aggregate。私聊无需群名单。
- Core 在领取绑定群或话题的 waiting Delivery 前检查机器人是否仍在群内。决定时刻取该投递入队与同一队员会话上一轮结束的较晚者。Host 先通过本 Provider 的 `roster.begin` 取得 Core 时间，再读取平台。查询发起时间必须晚于决定时刻。
- 入站直接创建的原始收件投递可沿用该条入站观察后的名单。曾排在前一请求之后的需晚于前一请求完成，只等附件无需额外读取。按 FIFO 只领取连续符合条件的投递。
- `channel.roster_refresh.requested` 唤醒 Host。Host tick 的 `rosterRefreshes` 指明 Provider、租户、父群。待办保存在队列，断线后重新读取。正在执行的会话不因后续投递查询。名单写入后立即重新检查领取。
- 同一 Provider、租户、父群最多一轮在途。平台读取不完整为未知，按 5 秒、15 秒、60 秒、之后每 5 分钟退避，下一次只处理仍有需求的群。回复、卡片独立发送。远端确认离群使对应等待投递结束，当前 Run 继续。已绑定群的明确进退群事件只更新该机器人，晚到快照不得覆盖较新的事件。未绑定群仅记录事件。
- 打开设置、普通唤醒、启动、重连、机器人增减均不扫描历史群。群名单不使用时间窗口。无业务需求时名单接口调用数为零。

## 接入层

本地拒绝群内 `/new`、非主人和失效卡片。绑定操作在查询前验证卡片，提交时再次验证。合并转发在身份、mention 与去重通过后展开。飞书和 Lark 通过各自的 `inbound.observed` 查询本地接收记录，重启后收到的重复回调也能直接跳过。
群名保留最后一次成功结果，24 小时后在业务需要时更新。设置页读取本地上次验证时间。网页身份限于连接、发布、配置或缺失凭据恢复时核验。
同一凭据同时取访问令牌共享请求。装载不同凭据后重新获取。钉钉只恢复 Stream 时无需测试卡。钉钉名单中缺少约定数组或条目标识视为未知，成功的空数组表示名单为空。
