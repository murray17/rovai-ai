---
document_type: version-overview
version: v1.71
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-09-27
---

# Rovai-ai v1.71：Lark 独立渠道

前置：[v1.70](../v1.70/README.md)。本版把 Lark 从飞书 provider 下未接通的品牌选项，改为与飞书、钉钉并列的独立渠道。
飞书与 Lark 可以同时连接各自的开发者账号，同一队员可以同时拥有飞书 Bot 与 Lark Bot，两家的账号、Bot、会话和
失败互不影响。

## 目标与边界

- 新增 provider `lark`：独立 Host 身份、5 张与飞书结构等价的表、8 个领域命令类型、20 个 `channels.lark.*` 请求。
- 不复制飞书实现：Core 以 `ChannelProviderSpec` 参数化飞书领域逻辑，Main 以 Provider Profile 创建第二个渠道服务实例。
- 可信域、登录配置与 SDK 域按 provider 分离；飞书 provider 收窄为只接受飞书品牌，不再接受 `larksuite.com`。
- 三张在 CHECK 中写死 provider 值域的中立表重建，两个目录视图增加 Lark 分支；飞书与钉钉既有数据不改写。
- Renderer 增加 Lark 页签、会话来源前缀与未验收提示；自动化通知可以选择 Lark。
- Lark 话题派发沿用群 roster 新鲜度和成员存在性检查，刷新请求与 Bot 发布状态均按 provider 隔离。
- 不改变模型可见内容。Lark 绑定 Camp 不注入飞书文件交付提示；扩展该提示需要独立的核心模型上下文变更与二次确认。
- 不宣称支持 Lark。登录协议、控制台发布与客户端交互在真实 Lark 租户逐项验收前保持未验证。

字段与请求面见 [Lark Channel v1](../../contracts/lark-channel-v1.md)，飞书收窄见
[Feishu Channel v17](../../contracts/feishu-channel-v17.md)，组件与权威见[Lark 渠道架构](../../architecture/lark-channel.md)，
取舍理由见[版本决定](decisions.md)，实施切片与验收见[实施与验收](implementation-plan.md)。

## 当前状态

Principal 于 2026-09-24 确认方案 B：克隆表族并参数化飞书实现。S1 到 S5 已实施并通过自动化验收，状态为
`in_progress`，只剩 S6 真实租户逐项验收。本版最初以 v1.67 的编号，在基线 `ec290dc6` 上实施；上游随后发布了
v1.67 到 v1.70，并用掉 Migration 171 到 173。本版顺位为 v1.71；合并最新主线时，Migration 174 已用于 public history claim，Lark 迁移因此顺延为
Migration 175，数据合同为 v1.71 / schema 125。实施计划中的 S1 到 S4 记录保留原基线上的证据，每次改号后的门禁结果另行记录。

未决事项：

- 真实 Lark 租户逐项验收：扫码连接和基础对话已由 Principal 手工跑通，逐项证据见[真实租户验收记录](lark-tenant-qualification.md)。
- Lark 绑定 Camp 是否也注入文件交付提示。需要 Principal 看过独立的模型上下文变更说明后二次确认，本版默认不注入。
- 编号：上游作者已在 Issue #523 确认独立 provider 的边界，并约定版本号顺位继承、合并冲突时再处理。#517 先合入并占用
  v1.70 与 Migration 173；合并时继续保留主线 Migration 174，本版使用 v1.71 与 Migration 175。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.70 冻结为 historical；本概览、[实施计划](implementation-plan.md)、[版本决定](decisions.md)与[版本索引](../README.md)建立唯一 current v1.71 |
| Decisions | 已更新 | [V1.71-D01](decisions.md#v1-71-d01)记录独立 provider、克隆表族与参数化实现的取舍，并同步当前决定导航 |
| Contracts | 已更新 | 发布 [Lark Channel v1](../../contracts/lark-channel-v1.md)与 [Feishu Channel v17](../../contracts/feishu-channel-v17.md)，Feishu v16 降为历史 |
| Architecture | 已更新 | 新增 [Lark 渠道架构](../../architecture/lark-channel.md)；[飞书渠道架构](../../architecture/feishu-channel.md)移除 `larksuite.com` 并改指 v17 |
| UI | 已更新 | [渠道设置](../../ui/components/channel-settings.md)增加 Lark 页签、品牌显示与未验收提示；[Camp 命名](../../contracts/channel-camp-naming-v1.md)和[统一侧栏](../../ui/components/app-shell-navigation.md)补齐 Lark 来源 |
| Runtime Activity | 确认无需更新 | Canonical Activity、Adapter mapping 与 Registry 不变；本版只涉及渠道 provider |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime 协议、实测版本、Agent 输入或安装资格 |
| Documentation routing | 已更新 | 文档任务入口、合同索引、架构索引、当前决定导航与版本指针路由到 Lark v1、Feishu v17 与 v1.71 |
| Root README | 确认无需更新 | Lark 未完成真实租户验收，按 Lark Channel v1 第 8 节不得在根 README 宣称支持 |
