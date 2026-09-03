---
document_type: version-decisions
version: v1.38
lifecycle: historical
last_updated: 2026-09-03
---

# v1.38 决定

<a id="v1-38-d01"></a>
## V1.38-D01：钉钉以飞书同等体验为目标，多 App callback 作为 durable target proof

### 背景

钉钉同一群消息直接 `@` 多个 Rovai Bot 时，每个企业内部应用只从自己的 credential-bound Stream 收到一份 callback。
平台没有提供跨 App 的 canonical 目标总数或稳定顺序，`chatbotUserId` 与 `atUsers[].dingtalkId` 又已被官方说明和真实回调
证明为不可比较的 opaque identity。继续整条 fail closed 会让合法多 Bot 协作不可用；把各 callback 直接建成多个根请求则
会重复项目选择、Camp 消息与 FIFO。只依赖 Main 3 秒内存又会在 App 重启时丢失已确认目标。

同时，用户要求钉钉尽可能拥有飞书同等体验。平台差异无法完全消除：当前 Internal App Robot 没有经真实 schema 证明的
原生 A2A `@`、群文件 callback 和可恢复附件投递，通用卡片也不具备飞书的逐 Command disclosure。为了“看起来一致”而
提交不受支持字段、借用 custom webhook schema 或自制伪原生控件，会把能力差异变成不可预测的失败。

### 决定

体验宗旨固定为：**能力允许处保持与飞书同等体验；平台确有限制时，保持同等清晰、可预期、可恢复，而不伪造一致。**

每个 credential-bound DingTalk callback 本身就是 receiving App 的目标证明。Core 以同一 provider/tenant/external
message 建立一个 durable aggregate，按首次持久观察顺序合并 App 对应 Agent；首观察 App 唯一拥有 acknowledgement 和
项目卡。Main 正常存活时在 3 秒后提交完整集合；Main 重启错过 timer 时，Core 到截止时间后以 SQLite 中非空且相等的
expected/observed 集合自动封口。无论路径如何，一个 aggregate 最多产生一个根 `ChannelTurnRequest`，再按冻结顺序建立
多个 AgentRun；迟到 callback 不建立第二根。

永久 Markdown 增加有界直接父消息摘要，但明确不是 native reply。Snapshot 只投影聚合与卡片 create/update/recall 的
安全计数。附件、原生 A2A `@` 和超长正文 durable 分片在缺少真实平台/Outbox 证据时继续明确关闭；Renderer 入口仍等
packaged 桌面端与手机端完整矩阵后才重新开放。当前字段、恢复和验证边界由
[DingTalk Channel v11](../../contracts/dingtalk-channel-v11.md)与
[钉钉渠道架构](../../architecture/dingtalk-channel.md)拥有。

### 后果与替代方案

- 正常进程与重启恢复使用同一个 SQLite aggregate，不再把多 Bot 拆成多次项目选择、根消息或 FIFO 请求；3 秒窗口只决定
  何时封口，不承担唯一持久权威。
- 平台未公开用户的原始 `@` 顺序时，Rovai 只能承诺首次持久 callback 顺序；该限制被显式记录，不从 opaque ID 猜顺序。
- 拒绝继续多 App fail closed：真实 callback 已足以证明各 receiving Bot，拒绝会永久缺失核心协作路径。
- 拒绝等待未知目标总数：Provider 没有提供这一 authority，等待会形成无法恢复的永久 pending。
- 拒绝每 callback 一个根请求：它破坏同一用户意图、项目选择、队列和 CampTurn 的原子边界。
- 拒绝 Main-only debounce：重启会丢目标或重复 admission。拒绝伪造原生 `@`/reply/附件：不可验证的“同款外观”不满足
  清晰、可预期、可恢复的体验宗旨。

<a id="v1-38-d02"></a>
## V1.38-D02：开放钉钉管理入口，未验收能力改为独立 Gate

### 背景

v1.38 初始把 Renderer 的“敬请期待”作为整个钉钉管理面的发布门，等待桌面端和手机端完成一张完整真实租户矩阵。
随后 Main/Core 的账号、发布、Stream、项目选择、durable 多 Bot 聚合、执行卡、永久输出、诊断与恢复路径均已保留并通过
自动门禁，packaged 日常 App 也完成了实际群消息、执行中卡片、终态与撤回问题的迭代验证。继续隐藏整个管理面会让已经
可用的连接、账号和 Bot 管理能力一并不可达；另一方面，手机矩阵、附件、原生 A2A `@`、native reply 与逐 Command
disclosure 仍不能被推断为完成。

2026-09-03，产品 Owner 明确要求把钉钉渠道入口改为开放。该指令改变的是产品发布时机，不是对缺失平台证据的补写。

### 决定

Renderer 不再过滤 DingTalk Provider，也不再生成禁用的“敬请期待”Tab。Snapshot 中的飞书和钉钉进入同一可选择 Provider
路径；选择钉钉后显示现有 typed account、连接、队员 Bot、发布与受控管理链接。DingTalk-only Snapshot 回退到钉钉自身，
不再显示无可用渠道。

原来的整面 gate 改为逐能力 gate：话题、Managed 入站附件、出站附件、原生 A2A `@`、native reply、超长正文 durable
分片和逐 Command disclosure 继续保持 unsupported 或 summary-only；尚未完成的手机端与真实租户组合继续作为这些具体
能力的后续验收。入口可见或可点击不替代 Main/Core 的 Owner、credential、App、卡片、Outbox 与 Run 授权。
当前精确边界由 [DingTalk Channel v12](../../contracts/dingtalk-channel-v12.md)、
[钉钉渠道架构](../../architecture/dingtalk-channel.md)和[渠道设置](../../ui/components/channel-settings.md)拥有。

### 后果与替代方案

- 用户可直接连接或重连钉钉、查看已保存账号和 Bot、继续原 App 发布恢复，并进入官方管理链接；飞书路径不分叉。
- 后续验收失败只能关闭或修复对应能力，不能再靠 Renderer 隐藏整个 Provider 掩盖后台事实。
- 拒绝继续等待完整双端矩阵后才开放：它把不同风险等级的子能力绑定成一个全有或全无入口，与 Owner 已确认的发布时机
  不一致。
- 拒绝另建 Beta/实验开关：现有 Snapshot、授权和恢复边界已是生产路径，增加第二套选择状态只会制造持久化与支持分叉。
- 拒绝把开放入口解释为全能力完成：这会伪造手机、附件和平台原生交互证据，违反 D01 的体验宗旨。
