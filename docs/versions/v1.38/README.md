---
document_type: version-overview
version: v1.38
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-09-02
---

# Rovai-ai v1.38：钉钉渠道暂停开放与重新开放清单

前置：[v1.37](../v1.37/README.md)。后续：[v1.39](../v1.39/README.md)。本版本先收窄产品入口，不继续扩张钉钉实现；已有钉钉代码、凭据、账号、Bot
绑定和真实验收记录保持原样，重新开放前要完成的工作集中记录在本版本，避免继续散落在对话或历史版本中。

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
- 下列“重新开放清单”只登记范围与优先级；除渠道页 gate 外，本版本当前不实施这些钉钉能力。

## 重新开放清单

### 必须先完成

1. **同一群消息直接 @ 多个 Rovai Bot：** 多个 credential-bound Stream callback 必须合并成一个 durable inbound aggregate、
   一个根 `ChannelTurnRequest` 和按目标顺序创建的多个 `AgentRun`；不得继续 `observation_mismatch` fail closed，也不得拆成多次
   项目选择、排队或根消息。
2. **执行卡生命周期与飞书一致：** 收到请求后立即出现“执行中”状态卡和“显示最近输出 / 打开执行台 / 停止执行”三个入口，
   不能让平台 loading 覆盖整个执行期；真正排队时出现排队卡，admission 后撤回；终态卡可见，下一条根请求入场时真实撤回。
3. **群项目选择闭环：** 同组织内部群第一次有效 mention 后，Owner 选择项目或 Quick Chat 必须可靠消费原卡并继续同一条请求；
   刷新、双击、过期与 Non-owner 都保持现有 Core 授权和幂等边界。
4. **真实租户验收：** 至少覆盖桌面端与手机端、私聊、单 Bot 内部群、多 Bot 内部群、连续两条消息排队、停止、最近输出、
   Web 执行台、终态与下一轮撤回；合成 fixture、单独 OpenAPI 成功或 Main/Core 本地测试不能代替 packaged App 验收。

### 后续一致性改进

- **附件：** 当前钉钉入站只形成附件摘要，出站文件关闭；飞书可以收取和投递真实图片/文件。重新开放时需决定补齐真实附件，
  或把该差异明确保留为产品限制并在 UI 中诚实呈现。
- **永久正文：** 当前钉钉使用 Markdown 回复，未复现飞书的原生 A2A `@`、直接父消息摘要和超长正文分卡；需要评估可用卡片/API
  能力并形成真实客户端验收。
- **最近输出：** 钉钉目前只能整体展开最近输出，不能逐 Command 折叠。按既有产品选择继续不展示 command result；若平台后续
  提供稳定原生 disclosure，再单独评估，不用自制伪折叠。
- **可观察性：** 为真实群 callback 聚合、卡片 create/update/recall 和项目 callback 增加可诊断但不泄露正文、credential 或
  Owner 身份的安全状态，避免再次依赖 UI 现象推断链路阶段。

### 明确接受的平台差异

- 钉钉没有飞书话题群等价能力，Rovai 不实现 Topic/Thread。
- 只支持同组织内部群中通过“添加机器人”安装的应用 Bot；普通成员形态、普通群和外部群不走受支持的 Robot Stream 准入。
- 项目选择继续使用钉钉内置通用 AI Markdown 模板的有界按钮，不要求普通用户创建模板，也不强行模拟飞书下拉框。
- 钉钉最近输出不显示 command result；两端仍共用安全 command、`$` 前缀和超长首尾截断。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.37 冻结为 historical；本概览、实施计划与版本索引建立唯一 current v1.38 |
| Decisions | 确认无需更新 | 暂停公开入口是可逆的 Renderer gate；飞书事件过滤与启动时序是复用既有状态的局部维护加固，均未引入新的持久权威或高成本取舍 |
| Contracts | 已更新 | [Channel Host Maintenance v5](../../contracts/channel-host-maintenance-v5.md)收紧飞书事件快路径和启动 roster 扫描；[DingTalk Channel v10](../../contracts/dingtalk-channel-v10.md)继续描述保留实现 |
| Architecture | 已更新 | [飞书渠道架构](../../architecture/feishu-channel.md)同步维护热路径；Main/Core、Stream、SQLite、Outbox 权威边界不变，钉钉实现不改 |
| UI | 已更新 | [渠道设置](../../ui/components/channel-settings.md)拥有飞书开放、钉钉禁用预告和 legacy Snapshot 回退语义 |
| Runtime Activity | 确认无需更新 | 不改变 AgentRun activity 归类或 Canonical Activity 映射 |
| Runtime compatibility | 确认无需更新 | 不改变任何 Runtime 的平台准入、模型或工具兼容性 |
| Documentation routing | 已更新 | 版本索引保持 v1.38；[文档导航](../../README.md)、合同索引和当前决定导航切换到 Channel Host Maintenance v5 |
| Root README | 确认无需更新 | 根 README 未承诺钉钉公开可用，产品定位与安装方式不变 |
