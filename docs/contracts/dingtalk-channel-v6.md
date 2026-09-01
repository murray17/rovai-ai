---
document_type: protocol-contract
contract: dingtalk-channel-v6
authority: dingtalk-channel-account-provisioning-admission-delivery
status: accepted
version: 6
last_updated: 2026-09-01
---

# DingTalk Channel v6 Contract

继承 [DingTalk Channel v5](dingtalk-channel-v5.md) 的内置扫码、Web Session、Bot 发布、Stream、Owner 身份、
普通群准入、roster、SQLite/CAS 和恢复边界。本版替代旧执行卡正文流式/终态分页合同，开放渠道设置入口，
并让普通群项目卡与飞书一样可以选择项目或开始 Quick Chat。不新增 Migration。

## 1. 当前产品范围

- 渠道页同时显示飞书与钉钉；每个 Provider 只呈现自己的连接、Bot、待绑定和异常计数。
- Owner 私聊、Owner 在普通群中对一个 Bot 的 canonical 显式 `@`、单根 FIFO、群 roster、项目绑定、
  Quick Chat、公开 Markdown 输出和 AI 状态卡 enabled。
- 钉钉 Topic/Thread 始终 disabled；出现 topic identity 必须在 Core 准入前拒绝，不用普通群降级。
- 同一消息直接点名多个 Bot、入站附件正文和出站附件仍不在本版范围。单 Bot 收到消息后由 Core A2A
  协作，不通过多个 Stream Bot 重复接收同一外部消息。

## 2. 普通群项目卡

首次有效普通群消息在原群创建 `callbackType=STREAM` 且禁止转发的项目卡。卡片提供最近使用的 bounded
项目按钮、“开始快速对话”和“刷新项目”；没有项目时仍保留后两个按钮。

所有 callback 携带 pending binding、expected version、nonce 和 opaque project ID，Main 不接收 canonical path。
Core 以 DingTalk App-scoped Owner `userId`、exact `outTrackId`、nonce/version 和当前 pending 状态鉴权。
`quick_chat` 只对 DingTalk `group` 有效，使用全局 Quick Chat 目录创建普通 Channel Camp，不写项目绑定；项目选择和
Quick Chat 都原子提升已排队消息并保持同一 FIFO。成功、取消、刷新和重复点击不从卡片 payload 重建领域事实。

## 3. 执行状态卡

每个 `AgentRun` 使用一张 AI 卡片和稳定 `outTrackId`。执行中默认只显示：

```text
队员名 · 执行中

[显示最近输出] [打开执行台] [停止执行]
```

终态标题为“已完成 / 执行失败 / 已取消”，移除“停止执行”。服务不可用、端口冲突或没有可发布 LAN 地址时，
该卡从创建起不显示“打开执行台”，不在服务恢复后修补旧卡。

- “显示最近输出”是 Owner callback。Core 校验 provider/App、Owner `userId`、AgentRun 和 exact `outTrackId` 后，
  Main 展开或收起最后 30 条 Agent 公开正文与安全 command；不显示 command result、逐条结果统计或分页。
- “打开执行台”是模板原生 URL action，点击直接打开卡片首次创建时冻结的 URL；不经过 callback，不识别点击人，
  不发 Owner 私聊，也不在点击时重新计算 IP、端口或 Token。
- “停止执行”是 Owner callback。Main 使用 callback message identity 形成稳定命令 ID，Core 校验 exact Run 后只取消
  该 `AgentRun`；成功后 Main 立即把当前卡更新为“已取消”，Core 终态 Outbox 仍作为最终恢复真源。

执行卡 delivery、callback、终态更新和召回按 `agentRunId` 进入同一个 Main 串行队列。Main 内存状态只保存
`executionViewUrl / recentOutputVisible / latestSource / lastCardDigest`；收起时内容变化不更新卡，展开时窗口变化才更新。
Main 重启后默认收起，不恢复旧 URL；召回和 Host stop 撤销内存 Token。

## 4. LAN 只读执行台

飞书与钉钉共用 Desktop 唯一 `ExecutionViewService`、全局启用项和端口。缺少设置文件时默认为
`{ enabled: true, port: 8765 }`，但不自动落盘；有效的已保存选择始终优先，设置无效、无法解析或无法读取时
失败关闭。端口合法范围为 `1024..65535`，冲突时不漂移。

只有飞书或钉钉当前至少一个 Bot 为 `published` 时才绑定局域网 listener；没有已发布 Bot 时进入
`no_published_bot`，不解析网卡、不创建 server，也不生成卡片 URL。首个 Bot 发布后自动尝试监听；最后一个
Bot 退出已发布状态时关闭 listener、终止流并撤销内存 Token。新卡创建且服务 ready 时，Main 生成高熵
内存 Token 和固定 URL：

```text
http://<current-rfc1918-address>:<configured-port>/execution/<focusRunId>#t=<token>
```

Token scope 固定为 `channelConversationId + targetAppId + campId + agentId + focusRunId + maxRunCreatedAt`：只允许同一
Camp、同一队员、不晚于 focus Run 的连续历史；不能查看未来 Run、其他 Camp 或其他队员。首次 GET snapshot 后使用
Fetch Streaming SSE 更新，终态取得最终快照后停止跟随。

URL fragment 不进入 HTTP request、日志或 referrer。Main 只以 token hash 查找 immutable scope，再向 Core 请求公开投影。
持有 URL、能访问 Rovai 局域网且 Token 尚有效的人可以读取该投影；这不是 Owner 身份认证，也不承诺防御局域网主动
中间人。IP/端口/网络变化不修复旧卡，新 Run 使用新地址；Rovai 重启使所有旧 Token 失效。

## 5. 公开投影与写能力禁止

Web 与卡片只能读取触发消息摘要、Agent 公开正文、安全 command、公开 command result、公开文件变化和 Run 状态。
卡片最近输出进一步排除 command result。两者都禁止终端输入、继续对话、审批、任意文件读取、隐藏推理、完整工具输入、
环境变量和写文件。Web 页面把外部 Owner 固定显示为“你”。

`channels.dingtalk.executionConsole.recentOutput.authorize` 与
`channels.dingtalk.executionConsole.agentRun.cancel` 只允许 `dingtalk-channel-host`；共享 source/Web snapshot 读取按
冻结 provider conversation scope 判定。Main 不绕过 Core 直接取消 Run。

## 6. 验证边界

单元与 Core 回归必须覆盖三按钮/终态两按钮、URL fragment 原样保留、无 elapsed 文案、Quick Chat 无项目路径、
DingTalk Owner recent/cancel、错误 App/消息拒绝、DingTalk Web scope 和 per-card 串行更新。真实发布 Bot 还须分别在桌面端
与手机端验证卡片投递、callback operator `userId`、RFC1918 HTTP URL/fragment 打开、SSE 自动更新、停止后的即时终态、
私聊、普通群项目/Quick Chat 和 FIFO；真实验收结果记录在当前版本实施计划，不由单元测试代替。

## References

- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [渠道设置](../ui/components/channel-settings.md)
- [Feishu Channel v12](feishu-channel-v12.md)
- [Channel Host Maintenance v4](channel-host-maintenance-v4.md)
- [隔离验收](../development/local-workflow.md#钉钉-web-session-验收前置)
