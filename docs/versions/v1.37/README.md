---
document_type: version-overview
version: v1.37
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-09-01
---

# Rovai-ai v1.37：Runtime 图片、文件预览、取消与渠道只读执行台

前置：[v1.36](../v1.36/README.md)。渠道已有代码先保存为 f0e1ce2f、b7316a57、6f9f8bd2；原钉钉 NO-GO
在本版本后续由用户明确重开为单 Bot 真实验收，Topic/Thread 与附件仍保持关闭。

## 范围与状态

- 实施本机 Runtime 结构化图片，稳定路径零拷贝、inline bytes 优先、Run 临时图片复用 Blob；
  图片链自身不做目录范围或符号链接限制，不借图片观察增加授权、File Preview 或通用复制机制。
- [File Preview v3](../../contracts/file-preview-v3.md) 已实施：可信点击最终定位到具体普通文件后直接创建临时只读
  Preview handle，工作区外文件不再弹目录选择器；HTML/Markdown 本地资源绑定文档目录并随 Tab 释放，Root Grant
  仅保留给显式目录操作。理由见 [V1.37-D04](decisions.md#v1-37-d04)。
- ACP 增量/终态、Claude Tool Result、Codex MCP/原生 imageGeneration 已接入；本机实测后补齐
  Antigravity generatedMedia、TRAE builtin 图片、Copilot binaryResultsForLlm。六种 Runtime 的图片结果链
  已通过隔离 Core；Cursor 旧版无 ACP，其他 Runtime 的上游/能力限制见[真实验收](runtime-image-acceptance.md)。
- 共享图片 Gallery/Lightbox、消息附件顺序、Run supplement 排序、公开消息前等待与终态兜底、
  真实 Chromium 解码已实施。
- 图片展示修正：同 Run 的已发送同摘要 Blob 图片只展示消息附件；Tool/发送图片共用内容列，
  图片框按原比例贴合，不随正文缩小或补黑边；不显示文件名/来源标题或系统打开/Finder 菜单，
  只保留看大图与关闭。不删除数据，不改变稳定路径零拷贝。
- 会话切换复用当前 Renderer 内已成功解码的 Blob payload；附件命中后不重读，Runtime 命中后先显示再后台
  刷新当前内容。Tile 独立拥有 Object URL，128 MiB 淘汰只影响缓存 payload，不改变 Core 协议或稳定路径语义。
- 飞书复用已有显式附件 Outbox，不自动上传 Runtime 图片；钉钉出站附件仍 disabled。
- Migration 133 只新增图片元数据表和索引，Data Contract `v1.43 / schema 84`；旧业务行保持不变。
- [model-context-change revision 1](model-context-change.md) 已由开发者二次确认并实施：精简文件帮助，
  仅新飞书 Session 增加冻结的文件交付提示；Charter revision 3 复用既有兼容路径，其余版本轴不变。
- [Principal 寻址教学 revision 1](model-context-change-principal-addressing.md) 已由开发者二次确认并实施：
  Authority boundary 不再把正文 `@Principal` 描述为寻址入口，仅保留 `--to-principal`；Charter revision 4
  复用既有 Binding compatibility 路径，发送、投影及历史 Evidence 不变。
- [多队员 mention cluster revision 3](model-context-change-multi-mention-cluster.md) 已由开发者确认并实施：
  Agent `body` help 只保留 payload 说明，目标 authoring 只推荐 canonical `--to`；Core-only 行首兼容 parser
  连续解析有效队员，未知/歧义 alias 结束 cluster 并保留 Text，不新增严格拒绝。当前合同为
  [Camp Message Send v19](../../contracts/camp-message-send-v19.md)。
- [Agent 寻址帮助 revision 1](model-context-change-inline-addressing-teaching.md) 已由开发者二次确认并实施：
  Bootstrap、Send/Gather schema 与 CLI help 只推荐 canonical `--to`，不再主动教学 inline fallback；Charter
  revision 5 与 catalog digest 通过既有 Binding compatibility 路径轮换，parser、宽松 invalid tail、投递及
  `@惠 @Principal` 行为不变。当前 Gather 合同为 [Gather v5](../../contracts/gather-v5.md)。
- 取消可用性：以[已确认 revision 2](model-context-change-cancellation.md)实施事务内 cancelled 终态、定向成员 cutover、渠道 FIFO
  收口、发送前边界与三秒 Runtime 清理；Migration 134 为 Data Contract `v1.44 / schema 85`。
  当前取消合同见 [Cancellation Settlement v2](../../contracts/cancellation-settlement-v2.md)，理由见
  [V1.37-D02](decisions.md#v1-37-d02)。验收进度记录在实施计划，未完成的真实外部验收不由本机测试替代。
- 飞书执行卡已收敛为纯状态与三个入口；“打开执行台”在卡片创建时冻结 LAN HTTP `open_url`，以 Main 内存
  Token 限定同 Camp/队员、focus Run 及其之前历史，不做点击鉴权、Owner 私聊、地址刷新或旧卡修复。
  全局端口设置位于渠道页最底部并默认折叠；桌面/手机 Web 时间线已复用生产执行台的 AgentRun、操作组与
  Command 嵌套 disclosure，外部触发者固定显示“你”。缺少设置文件的首次使用默认开启并选择端口 8765，
  但只有当前存在已发布渠道 Bot 才监听；有效持久选择优先，异常配置失败关闭。当前合同见
  [Feishu Channel v12](../../contracts/feishu-channel-v12.md)，理由见 [V1.37-D05](decisions.md#v1-37-d05)与
  [V1.37-D08](decisions.md#v1-37-d08)。
- 钉钉渠道页入口已恢复，普通群项目卡增加 Quick Chat；执行中卡改为“显示最近输出 / 打开执行台 / 停止执行”，
  终态移除停止。它与飞书共用一个全局 LAN 执行台和同一公开投影，打开入口是卡片创建时冻结的直接 URL，
  最近输出与 exact-run 停止仍由 DingTalk App-scoped Owner `userId` 在 Core 鉴权。Topic/Thread、直接多 Bot 和附件 gate
  不扩大。当前合同见 [DingTalk Channel v6](../../contracts/dingtalk-channel-v6.md)，理由见
  [V1.37-D09](decisions.md#v1-37-d09)。
- [飞书入站规范化 revision 1](model-context-change-feishu-ingress-normalization.md) 已由开发者二次确认并实施：
  当前正文只冻结 SDK 单 locale 规范化结果，显式引用复用同一 normalizer；Topic
  `parent_id == canonical root_id` 只表达结构父链，不再伪造 ExternalQuote。历史消息与 Context Evidence
  不回填，当前合同为 [Feishu Channel v12](../../contracts/feishu-channel-v12.md)，理由见
  [V1.37-D06](decisions.md#v1-37-d06)。
- 飞书/钉钉 Channel Host 已删除永久 750ms/800ms interval：Core tick 按 provider 返回现有领域表的
  `hasOutstandingWork`，Main 以渠道/AgentRun/Runtime/settlement 事件走合并快路径，仅在仍有工作时保留十分钟
  one-shot watchdog；终态 quiet window 与 retry `availableAt` 使用独立 one-shot，清空后完全休眠。当前合同见
  [Channel Host Maintenance v4](../../contracts/channel-host-maintenance-v4.md)，理由见
  [V1.37-D07](decisions.md#v1-37-d07)。
- 当前仍 in_progress：Antigravity 边界已关闭，但 Cursor 非标准通知、所有 Runtime 原生生图及渠道实发
  并未全部验收；本机已观察到的工具/协议/上游限制保留，不提升任何 Runtime 平台资格。

具体完成事实、测试 owner 与待办见[实施计划](implementation-plan.md)。既有图片 main 合并、完整回归及
Applications 安装见[本机交付记录](main-merge-and-daily-app.md)；本轮变更继续遵循仓库 PR 与非终止日常安装门禁。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本概览、实施计划、版本索引；v1.36 冻结为 historical，未验收事实保留 |
| Decisions | 已更新 | [V1.37-D01](decisions.md#v1-37-d01)、[V1.37-D02](decisions.md#v1-37-d02)、[V1.37-D03](decisions.md#v1-37-d03)、[V1.37-D04](decisions.md#v1-37-d04)、[V1.37-D05](decisions.md#v1-37-d05)、[V1.37-D06](decisions.md#v1-37-d06)、[V1.37-D07](decisions.md#v1-37-d07)、[V1.37-D08](decisions.md#v1-37-d08)、[V1.37-D09](decisions.md#v1-37-d09)与 [CURRENT](../../decisions/CURRENT.md) |
| Contracts | 已更新 | [Runtime Images v3](../../contracts/runtime-images-v3.md)、[Camp Open Projection v14](../../contracts/camp-open-projection-v14.md)、[Cancellation Settlement v2](../../contracts/cancellation-settlement-v2.md)、[Camp Message Send v19](../../contracts/camp-message-send-v19.md)、[Gather v5](../../contracts/gather-v5.md)、[File Preview v3](../../contracts/file-preview-v3.md)、[Feishu Channel v12](../../contracts/feishu-channel-v12.md)、[DingTalk Channel v6](../../contracts/dingtalk-channel-v6.md)及[Channel Host Maintenance v4](../../contracts/channel-host-maintenance-v4.md) |
| Architecture | 已更新 | [Runtime 图片](../../architecture/runtime-images.md)、[File Preview](../../architecture/file-preview.md)、[飞书渠道](../../architecture/feishu-channel.md)、[钉钉渠道](../../architecture/dingtalk-channel.md)、[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md#bootstrap-与-dynamic-context)及架构导航 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md#runtime-图片与消息图片)、[文件预览](../../ui/components/file-preview.md)与[渠道设置](../../ui/components/channel-settings.md)；保留既有双主题 |
| Runtime Activity | 确认无需更新 | 内部图片观察不进入 Canonical Activity，不修改 classifier/映射或已有公开 Evidence |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md#2026-08-31-runtime-图片观察边界)区分协议 fixture 与真实 Runtime smoke |
| Documentation routing | 已更新 | [文档导航](../../README.md)、合同与架构索引 |
| Root README | 确认无需更新 | 不改变产品定位、安装方式或平台支持承诺；当前实施状态留在本版本 |
