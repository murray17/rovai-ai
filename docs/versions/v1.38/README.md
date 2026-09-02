---
document_type: version-overview
version: v1.38
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-09-02
---

# Rovai-ai v1.38：钉钉渠道暂停开放与重新开放清单

前置：[v1.37](../v1.37/README.md)。本版本先收窄产品入口，再按重新开放清单恢复实现；已有钉钉代码、凭据、账号、Bot
绑定和真实验收记录保持原样。Renderer gate 与后端实现进度分开，只有完整真实验收完成后才重新开放管理入口。

## 体验宗旨

**能力允许处保持与飞书同等体验；平台确有限制时，保持同等清晰、可预期、可恢复，而不伪造一致。**

同等体验首先指用户意图、项目选择、排队、执行状态、停止、永久输出、失败反馈和重启恢复时机一致，不要求把飞书组件
逐像素搬到钉钉。平台没有提供或尚未以真实租户证明的原生 `@`、reply、附件和 disclosure 必须明确标为限制，不能提交
不受支持字段、借用 custom webhook schema 或用自制控件冒充平台原生能力。取舍见
[V1.38-D01](decisions.md#v1-38-d01)。

## 范围与状态

- 渠道页当前只开放飞书管理。钉钉使用已打包的官方图标，固定呈现为置灰、不可选择的“敬请期待”入口；它不挂载登录、
  重连、断开、发布、审批人选择或已发布 Bot 管理动作。
- Renderer 不从钉钉 Snapshot 恢复管理内容。即使本机只保存钉钉 Provider，也只显示禁用预告和“当前版本没有可用的渠道”，
  不把钉钉自动选成当前 Provider。
- 本次不删除或迁移钉钉的 Main/Core、SQLite 数据、credential、Developer Session、Stream、Card 或 Outbox 实现；已经发布的
  Bot 仍按既有后台语义运行。该边界只关闭新的用户管理入口，不伪装成后端代码清理。
- 飞书连接、队员发布、项目选择、排队/执行卡、最近输出、局域网执行台及既有数据完全保持开放。
- 发布前收紧飞书后台维护：active Host 只由 Run started/terminal 与当前执行卡 Run 的 live event 唤醒；首次恢复
  Pump 不先扫描全部历史群。Core outstanding、watchdog、Delivery、latest-wins、精确 roster 刷新和 Web 执行台不变。
- 下列“重新开放清单”同时记录实现与验收状态；渠道页 gate 在 packaged 桌面端/手机端完整矩阵通过前保持不变。

## 重新开放清单

### 必须先完成

1. **同一群消息直接 @ 多个 Rovai Bot：** 多个 credential-bound Stream callback 必须合并成一个 durable inbound aggregate、
   一个根 `ChannelTurnRequest` 和按目标顺序创建的多个 `AgentRun`；不得继续 `observation_mismatch` fail closed，也不得拆成多次
   项目选择、排队或根消息。Core/Main 已实现首次持久观察顺序、3 秒正常封口、SQLite deadline 重启恢复与迟到去重；
   仍待 packaged 双端真实 callback 验收。
2. **执行卡生命周期与飞书一致：** 收到请求后立即出现“执行中”状态卡和“显示最近输出 / 打开执行台 / 停止执行”三个入口，
   不能让平台 loading 覆盖整个执行期；真正排队时出现排队卡，admission 后撤回；终态卡可见，下一条根请求入场时真实撤回。
3. **群项目选择闭环：** 同组织内部群第一次有效 mention 后，Owner 选择项目或 Quick Chat 必须可靠消费原卡并继续同一条请求；
   刷新、双击、过期与 Non-owner 都保持现有 Core 授权和幂等边界。现有 Core/Main owner 已覆盖权威卡片恢复与失败路径；
   packaged 手机端矩阵仍未完成。
4. **真实租户验收：** 至少覆盖桌面端与手机端、私聊、单 Bot 内部群、多 Bot 内部群、连续两条消息排队、停止、最近输出、
   Web 执行台、终态与下一轮撤回；合成 fixture、单独 OpenAPI 成功或 Main/Core 本地测试不能代替 packaged App 验收。

### 后续一致性改进

- **附件：** 明确保留为产品限制。钉钉私聊 file/audio/video callback 当前只形成名称/媒体类型摘要，普通群 Bot 平台不接收
  这些类型；没有 Managed Attachment ingress 前不下载 `downloadCode`。出站继续关闭，不借用 custom webhook schema
  冒充 Internal App Robot 能力。
- **永久正文：** 新输出已增加同 Camp 直接父消息的有界 Markdown 摘要，并明确不是 native reply。钉钉现有群接口不接受
  已验证的原生 A2A `@` 字段；超长正文只有在每片具备独立 durable Outbox/顺序/重试身份后才分片，不在 Main 内冒险多发。
- **最近输出：** 钉钉目前只能整体展开最近输出，不能逐 Command 折叠。按既有产品选择继续不展示 command result；若平台后续
  提供稳定原生 disclosure，再单独评估，不用自制伪折叠。
- **可观察性：** DingTalk Snapshot 已增加 inbound collecting/ready/overdue 与 Card create/update/recall/failed 安全计数，
  不包含正文、附件内容、tenant/chat/App/Agent/Owner identity、credential、URL、token 或远端响应；真实项目 callback
  仍复用 nonce/version/Owner 的现有 Core 结果码。

### 明确接受的平台差异

- 钉钉没有飞书话题群等价能力，Rovai 不实现 Topic/Thread。
- 只支持同组织内部群中通过“添加机器人”安装的应用 Bot；普通成员形态、普通群和外部群不走受支持的 Robot Stream 准入。
- 项目选择继续使用钉钉内置通用 AI Markdown 模板的有界按钮，不要求普通用户创建模板，也不强行模拟飞书下拉框。
- 钉钉最近输出不显示 command result；两端仍共用安全 command、`$` 前缀和超长首尾截断。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.37 冻结为 historical；本概览、实施计划与版本索引建立唯一 current v1.38 |
| Decisions | 已更新 | [V1.38-D01](decisions.md#v1-38-d01)固定飞书同等体验宗旨，并选择 credential-bound callback + SQLite deadline 作为多 Bot target proof 与恢复边界 |
| Contracts | 已更新 | [Channel Host Maintenance v5](../../contracts/channel-host-maintenance-v5.md)继续拥有按需调度；[DingTalk Channel v11](../../contracts/dingtalk-channel-v11.md)拥有多 Bot durable 聚合、父消息摘要、安全诊断和平台限制 |
| Architecture | 已更新 | [飞书渠道架构](../../architecture/feishu-channel.md)保持既有热路径；[钉钉渠道架构](../../architecture/dingtalk-channel.md)同步一个 aggregate/一个根请求、截止恢复、永久摘要和诊断投影 |
| UI | 已更新 | [渠道设置](../../ui/components/channel-settings.md)拥有飞书开放、钉钉禁用预告和 legacy Snapshot 回退语义 |
| Runtime Activity | 确认无需更新 | 不改变 AgentRun activity 归类或 Canonical Activity 映射 |
| Runtime compatibility | 确认无需更新 | 不改变任何 Runtime 的平台准入、模型或工具兼容性 |
| Documentation routing | 已更新 | 版本索引保持 v1.38；[文档导航](../../README.md)、合同索引和当前决定导航切换到 Channel Host Maintenance v5 |
| Root README | 确认无需更新 | 根 README 未承诺钉钉公开可用，产品定位与安装方式不变 |
