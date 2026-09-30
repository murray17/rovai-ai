---
document_type: version-overview
version: v1.72
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-10-01
---

# Rovai-ai v1.72：Lark 独立渠道

## 待评审提案：Conversation 统一命名

[Camp → Conversation 变更说明 r1](model-context-change-conversation-rename.md)列出 `conversationId`／`campId` 输入兼容、
私有 AgentSession、旧 Native Session resume 和随包 Skill 更新的具体场景；[文本附录](conversation-rename-comparison.md)提供完整提示词、CLI 与 Skill 前后对照。
这是尚未取得实施二次确认的文档提案，不表示该更名已实施，也不改变下述已确认的 Lark 范围。

## 版本概览

前置：[v1.71](../v1.71/README.md)。本版把 Lark 从飞书 provider 下未接通的品牌选项，改为与飞书、钉钉并列的独立渠道。
飞书与 Lark 可以同时连接各自的开发者账号，同一队员可以同时拥有飞书 Bot 与 Lark Bot，两家的账号、Bot、会话和
失败互不影响。

## 目标与边界

- 新增 provider `lark`：独立 Host 身份、5 张与飞书结构等价的表、8 个领域命令类型、21 个 `channels.lark.*` 请求。
- 不复制飞书实现：Core 以 `ChannelProviderSpec` 参数化飞书领域逻辑，Main 以 Provider Profile 创建第二个渠道服务实例。
- 可信域、登录配置与 SDK 域按 provider 分离；飞书 provider 收窄为只接受飞书品牌，不再接受 `larksuite.com`。
- 三张在 CHECK 中写死 provider 值域的中立表重建，两个目录视图增加 Lark 分支；飞书与钉钉既有数据不改写。
- Renderer 增加 Lark 页签、会话来源前缀与未验收提示；自动化通知可以选择 Lark。
- Lark 话题派发沿用群 roster 新鲜度和成员存在性检查，刷新请求与 Bot 发布状态均按 provider 隔离。
- Lark 入站图片与文件复用共享持久下载队列，以独立 Host 完成请求结算，下载完成后作为 Source Ref 进入 Agent 输入；真实租户文件收发仍待验收。
- 不改变 Lark 绑定 Camp 的模型提示。绑定时不注入飞书文件交付提示；扩展该提示需要独立的核心模型上下文变更与二次确认。
- 不宣称支持 Lark。登录协议、控制台发布与客户端交互在真实 Lark 租户逐项验收前保持未验证。

字段与请求面见 [Lark Channel v1](../../contracts/lark-channel-v1.md)，飞书收窄见
[Feishu Channel v17](../../contracts/feishu-channel-v17.md)，组件与权威见[Lark 渠道架构](../../architecture/lark-channel.md)，
取舍理由见[版本决定](decisions.md)，实施切片与验收见[实施与验收](implementation-plan.md)。

## 当前状态

Principal 于 2026-09-24 确认方案 B：克隆表族并参数化飞书实现。S1 到 S5 已实施并通过自动化验收，状态为
`in_progress`；Lark 切片只剩 S6 真实租户逐项验收。本版最初以 v1.67 的编号，在基线 `ec290dc6` 上实施；上游随后发布了
v1.67 到 v1.71，并用掉 Migration 171 到 175。本版顺位为 v1.72；合并最新主线时，Migration 174 用于 public history claim，175 用于通知模型，Lark 迁移因此顺延为
Migration 176，数据合同为 v1.72 / schema 126。实施计划中的 S1 到 S4 记录保留原基线上的证据，每次改号后的门禁结果另行记录。

2026-09-27 在主线 `0f7b101a` 基础上补充 Lark 入站资源下载，扩展原有 Host 请求面和 Source Ref 准入；
既有飞书、钉钉附件流程不变。该补充的自动化验收与真实租户边界见[实施与验收](implementation-plan.md)。

未决事项：

- 真实 Lark 租户逐项验收：扫码连接和基础对话已由 Principal 手工跑通，逐项证据见[真实租户验收记录](lark-tenant-qualification.md)。
- Lark 绑定 Camp 是否也注入文件交付提示。需要 Principal 看过独立的模型上下文变更说明后二次确认，本版默认不注入。
- 编号：上游作者已在 Issue #523 确认独立 provider 的边界，并约定版本号顺位继承、合并冲突时再处理。#517 先合入并占用
  v1.70 与 Migration 173；随后 #549 使用 v1.71 与 Migration 175，本版使用 v1.72 与 Migration 176。

## 并行交付：钉钉出站增量

在当前主线的钉钉渠道上补齐 Agent 显式图片及平台文件消息出站，并改为按 HTTP 状态/传输错误类型判定
Outbox 重试。范围仅限 DingTalk Host 和其 Open API 适配器，Core 的 delivery schema、Camp 消息与 Lark
版本目标不变。当前行为由 [DingTalk Channel v14](../../contracts/dingtalk-channel-v14.md) 拥有；真实钉钉租户
上传与消息呈现尚未验收，网络响应丢失的重复投递风险在合同中单列。

钉钉入站真实租户验证发现平台返回 HTTP 签名图片链接，原 Host 的 HTTPS 限制导致消息无法准入；
本次按 [V1.72-D04](decisions.md#v1-72-d04) 使用原始签名链接，并在附件终态失败时撤回已发送的排队卡。
旧失败请求不会自动重跑，新消息仍需真实租户验收。

Principal 后续要求三种渠道在附件下载期间不另发状态卡；资源未就绪时不创建排队卡，
普通已就绪消息仍可发送排队确认，附件终态失败仍发送提示。
本机钉钉私聊的 `rovai send` 直接投递因缺少 App 范围内的收件用户 ID 返回 HTTP 400；
领取投影现从绑定会话的外部 Principal 补齐该 ID，旧失败投递不自动重放。

## 并行交付：侧栏读取与 Skills 发现

按 Principal 对会话切换卡顿的评审，侧栏改用按行、按组和摘要完整快照读取；Navigation Read v1 的
Migration 177 从 v1.72/schema 126 升到 schema 127，只在 camp 增加摘要字段，不新增业务表。
首次发布的用户消息推进排序，首次发布且未撤回的 Agent 消息推进未读回复；Run 终态本身不产生新回复标记。
同时，原生 Skills 发现由上下文缓存改为目录缓存，容量 128 个目录、TTL 300 秒；同目录在途扫描和一次 Camp
手动刷新均去重，不预热或增加异步订阅。取舍见 [V1.72-D02](decisions.md#v1-72-d02)，实现与验收记录见
[实施计划](implementation-plan.md)。

## 并行交付：公开 Composer 队外 Mention

Active Camp 中的用户可以从 `@` 候选选择资料仍在的队外队员。正文保留每处提及；发送时按身份去重，先逐人加入
Camp，再走现有消息发送命令。任一加入失败则保留草稿并停止发送；已加入成员不会回滚。Pending Camp 首条输入
仍走原激活路径。实现边界见[Public Camp Composer](../../architecture/camp-composer-draft.md#发送)与
[结构化 Mention](../../ui/components/structured-mentions.md#member-typeahead)，取舍见
[V1.72-D05](decisions.md#v1-72-d05)。

## 并行交付：渠道网页执行台还原

飞书、Lark、钉钉共用的局域网只读执行台按已确认交互稿还原桌面执行面的 Run 卡头、状态图形、工具组、命令结果和
Markdown 正文；网页外壳保留 Camp 标题、触发消息、只读标记及默认折叠的执行历史。网页服务继续只返回现有公开
Snapshot 与 SSE，不增加私有 Evidence、文件差异、写操作或新数据权限。具体交互见[渠道设置 UI](../../ui/components/channel-settings.md#局域网执行台设置)，
构建和浏览器验收记录见[实施计划](implementation-plan.md#2026-09-28-渠道网页执行台还原)。真实渠道内嵌浏览器与租户验收仍独立进行。

## 并行交付：当前版本发布日期

“关于与更新”当前版本的发布日期改由随包、与版本号绑定的元数据提供。v0.4.0 的值对照正式 GitHub Release
发布时间写入；Desktop 与 Desktop 托管的 Web 页面均可离线展示。版本提升时，元数据与更新日志必须一起更新，
桌面构建在打包前拒绝旧版本号或无效日期。元数据缺失或与运行版本不符时仍明确显示日期未知，不借用构建时间或
新版候选日期。当前字段合同见 [App Update v6](../../contracts/app-update-v6.md)，验证见[实施计划](implementation-plan.md#2026-09-28-当前版本发布日期)。

v0.4.1 发布后补齐候选版本的日期兼容：macOS 合并清单保留日期字符串，Main 同时归一化更新器可能返回的
日期对象；真实 Provider 解析器覆盖生成端和消费端的回归。见[补充验证](implementation-plan.md#2026-09-29-候选版本发布日期兼容)。

## 并行交付：Claude Code 权限审批

Claude Code 保留 `--print` 结构化输出，增加 stream-json 输入与 stdio 权限处理。原生 request_id
与 tool_use_id 分别绑定审批回复和实际工具结果，复用 Action/Approval Dock。初始化成功才发送任务，
会话 idle 与末轮结果共同控制 stdin 关闭；取消与断线撤销请求。当前合同见
[Runtime Launch and Verification v46](../../contracts/runtime-launch-and-verification-v46.md)，取舍见
[V1.72-D06](decisions.md#v1-72-d06)。

审批选项补充原生建议的显式记忆：一次允许不保存规则，记忆由 Claude 保存选中的范围和 destination，
请求的 suppression 仍有效。Claude 使用 CLI 2.1.280 已核实的原生英文按钮文案，中英文界面一致；
历史两个旧中文 host 标签只作展示兼容。Dock 不额外显示配置文件说明，选项放得下一排时同行排列，不足时换行。
验证记录见[原生选项补充验收](implementation-plan.md#2026-09-30-claude-原生选项与规则记忆)和[审批选项展示收敛](implementation-plan.md#2026-09-30-审批选项展示收敛)。

## 并行交付：Agent 指令英文化

按 Principal 确认的 r5，将会进入 Agent 上下文的 9 项发布 Skill（30 份 Markdown）和三处系统／CLI
短文本改为简洁英文。完整原文、替换内容、确认记录及验证边界见
[模型上下文变更说明](model-context-change-agent-english.md)。实际用户内容和回复语言保持。
旧会话沿用冻结 Bootstrap 继续 resume，新会话首次生成英文索引；内置 Skill 沿用既有固定路径同步。
不提升会话兼容版本、不新增迁移。工具箱共用的说明原文随资源显示英文。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.71 冻结为 historical；本概览、[实施计划](implementation-plan.md)、[版本决定](decisions.md)与[版本索引](../README.md)建立唯一 current v1.72 |
| Decisions | 已更新 | [V1.72-D01](decisions.md#v1-72-d01)记录独立 Lark provider；[V1.72-D02](decisions.md#v1-72-d02)记录侧栏摘要与范围读取；[V1.72-D03](decisions.md#v1-72-d03)记录 Lark 入站附件复用与 Host 隔离；[V1.72-D04](decisions.md#v1-72-d04)记录钉钉签名链接与旧排队卡收口；[V1.72-D05](decisions.md#v1-72-d05)记录发送前邀请；[V1.72-D06](decisions.md#v1-72-d06)记录 Claude 原生双向审批，均同步当前决定导航 |
| Contracts | 已更新 | 发布 [Lark Channel v1](../../contracts/lark-channel-v1.md)与 [Feishu Channel v17](../../contracts/feishu-channel-v17.md)，Feishu v16 降为历史；补充 [Navigation Read v1](../../contracts/navigation-read-v1.md)、[Skills Rebuild v2](../../contracts/skills-rebuild-v2.md)、[App Update v6](../../contracts/app-update-v6.md)、[Runtime Launch v46](../../contracts/runtime-launch-and-verification-v46.md)与钉钉出站 [DingTalk Channel v14](../../contracts/dingtalk-channel-v14.md)；Composer 邀请只组合现有成员加入与发送命令，不改变两者合同 |
| Architecture | 已更新 | 新增 [Lark 渠道架构](../../architecture/lark-channel.md)；[飞书渠道架构](../../architecture/feishu-channel.md)移除 `larksuite.com` 并改指 v17；[侧栏刷新](../../architecture/desktop-navigation-refresh.md)与[Skills 来源](../../architecture/skills.md)说明局部读取及目录缓存；[钉钉渠道架构](../../architecture/dingtalk-channel.md)补齐原生附件出站与重试边界；[Public Camp Composer](../../architecture/camp-composer-draft.md#发送)说明邀请与发布命令边界；[Desktop App Updates](../../architecture/desktop-app-updates.md)补齐随包发布日期来源；[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md#claude-code-权限审批回调)说明 Claude 权限回调边界 |
| UI | 已更新 | [渠道设置](../../ui/components/channel-settings.md)增加 Lark 页签、品牌显示与未验收提示，并明确只读网页执行台的历史区、生产组件及重连呈现；[Camp 命名](../../contracts/channel-camp-naming-v1.md)和[统一侧栏](../../ui/components/app-shell-navigation.md)补齐 Lark 来源及范围刷新；[结构化 Mention](../../ui/components/structured-mentions.md#member-typeahead)和[会话工作区](../../ui/components/conversation-workspace.md#camp-composer)说明待邀请反馈 |
| Runtime Activity | 确认无需更新 | Canonical Activity、Adapter mapping 与 Registry 不变；本版只涉及渠道 provider |
| Runtime compatibility | 已更新 | Claude Code 使用 `--print` 双向 stream-json 与原生 ID 审批；真实 Runtime 与 Desktop 点击证据记录在[兼容性台账](../../runtime-compatibility.md)，平台资格不据此扩大。Agent 指令英文化保持 Binding 兼容轴，生效边界见[变更说明](model-context-change-agent-english.md) |
| Documentation routing | 已更新 | 文档任务入口、合同索引、架构索引、当前决定导航与版本指针路由到 Lark v1、Feishu v17、Navigation Read v1、DingTalk v14 与 v1.72；版本内新增[Agent 指令变更说明](model-context-change-agent-english.md)及完整对照 |
| Root README | 确认无需更新 | Lark 未完成真实租户验收，按 Lark Channel v1 第 8 节不得在根 README 宣称支持 |
