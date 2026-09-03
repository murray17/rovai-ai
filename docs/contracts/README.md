---
document_type: contracts-index
authority: protocol-contract-routing
last_updated: 2026-09-03
---

# 长期接口合同

本目录保存跨版本、字段级且可由测试直接验证的接口合同。[Version Decisions](../decisions/README.md)解释为什么选择某个边界，
Architecture 解释组件如何组成，Version 概览记录交付范围；它们都不复制本目录的完整 wire shape。

## 生命周期

- 已接受且带版本号的合同语义冻结，只允许修正错字、链接、元数据和不改变语义的表达。
- 字段、wire shape、错误、幂等或投递语义改变时，创建下一个 `<name>-vN.md`，不得原地改写
  已接受版本；旧版本可继续约束既有持久对象或历史恢复。
- 新增或切换合同版本时必须同步更新下方索引，明确当前入口与 historical 入口。合同的
  `accepted` 只表示该版本语义成立，不表示它是新执行的当前入口，也不表示代码已经实现。

跨版本合同拥有的 JSON Schema 位于 [`schemas/`](schemas/) 并由独立 catalog 固定 raw-byte digest；不得为了新合同
修改已冻结的历史 Version schema catalog。

## v1.07 模型上下文确认

[模型上下文 revision 1](../versions/v1.07/model-context-change-a2a-public-only.md) 已二次确认；其五份合同现已
接受并成为下方 current 入口。历史版本继续解释旧 wire，不提供当前产品 reader 或双写兼容。

| 合同 | 权威范围 |
| --- | --- |
| [Cancellation Settlement v2（当前）](cancellation-settlement-v2.md) | 取消 Run 统一为 cancelled；效果证据保留但不产生公共待确认提示，清理与后续调度边界不变 |
| [Cancellation Settlement v1（历史）](cancellation-settlement-v1.md) | 取消事务按发送/效果证据区分 cancelled 与 failed/accepted_input_outcome_unknown 的旧规则 |
| [Camp Member Fast v1（当前）](camp-member-fast-v1.md) | Camp/member/保存绑定代次的三态覆盖、原生订阅资格、执行冻结、观察与紧凑 UI |
| [Runtime Images v3（当前）](runtime-images-v3.md) | v2 来源/保存/读取不变；同 Run 的已发送同摘要图片优先展示，共用内容列与贴合原比例的图片框 |
| [Runtime Images v2（历史）](runtime-images-v2.md) | 本地结构化图片、ACP 增量累积、混合存储与 Camp-scoped 读取；允许显式附件重复展示的规则由 v3 替代 |
| [Camp Open Projection v14（当前）](camp-open-projection-v14.md) | v13 wire/修复不变；精确兼容投影旧取消失败行，不改写底层证据 |
| [Camp Open Projection v13（历史）](camp-open-projection-v13.md) | Snapshot 34/Open 6 不变；service 先定向修复半取消，投影仍不读事件日志 |
| [Camp Open Projection v12（历史）](camp-open-projection-v12.md) | Snapshot 34/Open 6；保留 main 业务投影与渠道来源、Runtime 图片，只读图片 bytes 按需读取 |
| [Camp Open Projection v11（历史）](camp-open-projection-v11.md) | 渠道分支 Snapshot 34/Open 5 的可选 agentRunImages 元数据 |
| [Camp Open Projection v10（历史）](camp-open-projection-v10.md) | main Snapshot 34/Open 6；Open 不读取 event_log，移除 timeline/coverage.timeline，保留 high-water 与业务卡片 |
| [Camp Open Projection v10（渠道分支历史）](camp-open-projection-channel-v10.md) | v9 保留；Camp/Navigation 增加可选 channelSource，原始 title 不变；合并时保留原文以区分同号合同 |
| [Camp Open Projection v9（历史）](camp-open-projection-v9.md) | v8 保留；Snapshot 34/Open 5 增加可选 member.fast，仅查询安全缓存 |
| [Runtime Launch and Verification v31（当前）](runtime-launch-and-verification-v31.md) | v30 的 Pi wire/安全语义不变；三平台改为明确的可运行 experimental preview，仍不宣称 qualified |
| [Runtime Launch and Verification v30（历史）](runtime-launch-and-verification-v30.md) | v29 保留；增加 Pi JSONL Host、专属 Ready/exact resume、managed receipt、动态 Skills/MCP、Action/Usage 与三平台未准入边界 |
| [Runtime Launch and Verification v29（历史）](runtime-launch-and-verification-v29.md) | v28 保留；现有 Check Manager 的 Fast metadata 与单执行原生覆盖 |
| [Runtime Usage Monitoring v4（当前）](runtime-usage-monitoring-v4.md) | v3 保留；可选实际档位、observed 优先与未知撤回估价 |
| [Pending Camp Input v1（当前）](pending-camp-input-v1.md) | 私有下一轮输入、FIFO、编辑 token、暂停、原子发布与无附件边界 |
| [Camp Identity v1（当前）](camp-identity-v1.md) | 唯一 `rvcamp_` UUIDv7/Crockford 主键、strict boundary、SQLite/JSON/path 使用与 Native Session identity 分离 |
| [Desktop Runtime Availability v2（当前）](desktop-runtime-availability-v2.md) | 严格 lease/ticket 后原位逐版本事务、receipt 续跑、旧 manifest 恢复、独立瞬时重试与统一会话启动反馈；generation/capability 不变 |
| [Desktop Runtime Availability v1（历史）](desktop-runtime-availability-v1.md) | Bootstrap/Full Core、SQLite 准入、copy/switch 与结构化 failure；旧 manifest 恢复仍保留，普通升级执行策略由 v2 替代 |
| [First-run Onboarding v3（当前）](first-run-onboarding-v3.md) | v2 schema/flow 不变；首次安装改用 Full Core authority origin，损坏偏好只在内存降级且保留原文件 |
| [First-run Onboarding v2（历史）](first-run-onboarding-v2.md) | v1 admission/provisioning 不变；schema 2 增加无可用 Runtime 时无产品副作用的 `runtime_deferred` 终态；其 pre-Core 文件存在性 admission 已由 v3 替代 |
| [First-run Onboarding v1（历史）](first-run-onboarding-v1.md) | Desktop 首次安装判定、三页 mandatory 状态、幂等 provisioning、`初次集结` 与第四页 Draft-only 入口；不允许无 Runtime 完成 |
| [Camp Membership v2（当前）](camp-membership-v2.md) | 原定向 lifetime 范围内同事务结算；reconciliation 只保留已完成审计 |
| [Camp Membership v1（历史）](camp-membership-v1.md) | 动态添加/移除、至少一位成员、generation/version、atomic cutover、durable reconciliation、exact lifetime fence 与受信外部来源 |
| [Channel Storage v3（当前）](channel-storage-v3.md) | 凭据与存储边界不变；整轮中止使用 nullable retry suppression，迟到 sent 保留证据 |
| [Channel Storage v2（历史）](channel-storage-v2.md) | v1 存储与秘密边界不变；飞书三态检查、独立 Bot 启动及钉钉 completed 同应用凭据恢复 |
| [Channel Camp Naming v1（当前）](channel-camp-naming-v1.md) | 五种渠道复用普通自动命名、原始 title 与只读 channelSource 分离、闭合绑定来源保留和 Renderer 前缀 |
| [Channel Host Maintenance v5（当前）](channel-host-maintenance-v5.md) | v4 outstanding/watchdog 不变；飞书只响应执行卡相关 live Run，启动恢复不先扫描历史群；钉钉行为不变 |
| [Channel Host Maintenance v4（历史）](channel-host-maintenance-v4.md) | v3 事务/FIFO 不变；provider-scoped outstanding 信号、事件快路径、终态/重试 one-shot 与按需十分钟恢复 watchdog |
| [Channel Host Maintenance v3（历史）](channel-host-maintenance-v3.md) | v2 维护与 FIFO 不变；目标 Camp 半取消修复采用 cancelled 终态投影；永久短周期 Main pump 由 v4 替代 |
| [Channel Host Maintenance v2（历史）](channel-host-maintenance-v2.md) | 无 poll receipt 与 FIFO 不变；目标 Camp 半取消修复和抑制项不可重试 |
| [Channel Host Maintenance v1（历史）](channel-host-maintenance-v1.md) | 无永久 poll 回执的强类型维护请求、原子 FIFO/Outbox 维护、lease 恢复与真实业务命令幂等保留 |
| [Channel/Main Schema Join v2（当前）](channel-main-schema-join-v2.md) | 精确来源与既有 receipt 含义不变；原库事务重映射 main 117/118/119→126/127/130，逐步恢复，128/129 历史合同保留，131 封口 |
| [Channel/Main Schema Join v1（历史）](channel-main-schema-join-v1.md) | 主线 Pending/Fast 与渠道精确来源准入、126/127 receipt 与 128 封闭；副本执行位置由 v2 替代 |
| [Channel Storage v1（历史）](channel-storage-v1.md) | 飞书/钉钉 credential 与 Developer Session 的 `rovai.sqlite` 明文存储、Main-only API、批量启动、账号/发布原子提交、CAS refresh 与旧 `.bin` clean break |
| [Feishu Channel v15（当前）](feishu-channel-v15.md) | v14 渠道与欢迎卡不变；打开执行台使用蓝色主按钮，动作列在窄端纵向拉伸、宽端等宽同行 |
| [Feishu Channel v14（历史）](feishu-channel-v14.md) | v13 入站与执行入口不变；新 Bot 首次发布完成后向 exact Owner 发送非阻断、稳定 UUID 的私聊欢迎卡；动作布局由 v15 替代 |
| [Feishu Channel v13（历史）](feishu-channel-v13.md) | v12 设置、入站与执行入口不变；最近输出的安全 command 原生折叠，结果限两行，长 command 按显示列保留首尾；发布通知由 v14 替代 |
| [Feishu Channel v12（历史）](feishu-channel-v12.md) | v11 入站规范化与此前执行卡/公开投影不变；缺少设置文件时默认开启，仅在存在当前已发布渠道 Bot 时监听；最近输出呈现由 v13 替代 |
| [Feishu Channel v11（历史）](feishu-channel-v11.md) | v10 执行卡/LAN 只读面不变；当前正文只信 SDK 规范化结果，外部引用使用单 locale schema，并排除 Topic root structural parent 的伪引用；执行台默认与监听门禁由 v12 替代 |
| [Feishu Channel v10（历史）](feishu-channel-v10.md) | v9 执行卡、固定 URL、授权和 callback 不变；Web 公开投影复用生产分组语义，每个 Run、连续操作组与 Command 使用独立 disclosure；入站规范化与 Topic quote gate 由 v11 替代 |
| [Feishu Channel v9（历史）](feishu-channel-v9.md) | v8 绑定/永久投递不变；飞书执行卡收敛为状态与三个入口，固定 `open_url` 直达全局 LAN HTTP 只读执行台，内存 Token 限定历史 scope，Owner callback 仅保留最近输出与 exact-run 停止 |
| [Feishu Channel v8（历史）](feishu-channel-v8.md) | v7 执行卡不变；群/话题首次卡支持项目或 Quick Chat，共用 Owner/roster/FIFO 原子绑定；Migration 132 保留旧数据并允许无项目 resolved；执行卡已由 v9 替代 |
| [Feishu Channel v7（历史）](feishu-channel-v7.md) | v6 封存/分页/永久正文不变；实时卡当前正文/command/进度加10-command/20-block滚动折叠，16KB/30-element上限；共享安全 publicResult |
| [Feishu Channel v6（历史）](feishu-channel-v6.md) | 分页仅同步 response card；永久正文改为无标题卡片及实际接收对象行；执行中平铺由 v7 替代 |
| [Feishu Channel v5（历史）](feishu-channel-v5.md) | v4 封存/授权不变；终态双层原生折叠、翻页外层展开、15-command/50-element/24KB 分页与 4KiB 安全结果；分页 PATCH 后空 ACK 由 v6 替代 |
| [Feishu Channel v4（历史）](feishu-channel-v4.md) | 终态文字/command 混排、原生单条折叠、安全结果 20 行、15-command/50-element 分页、不可变 sealed 内容与无状态翻页；Migration 125 清理旧 view state；终态容器和预算由 v5 替代 |
| [Feishu Channel v3（历史）](feishu-channel-v3.md) | 飞书终态外层原生折叠、正文直接可见、仅过程分页与翻页保持展开；终态呈现由 v4 替代 |
| [Feishu Channel v2（历史）](feishu-channel-v2.md) | Owner-only 入站、Quick Chat/PendingCampBinding、统一 admission、每 AgentRun 临时执行控制台、永久 Markdown 与 Managed Attachment 原生投递；终态平铺由 v3 替代，存储条款由 Channel Storage v2 替代 |
| [Feishu Channel v1（历史）](feishu-channel-v1.md) | Developer Identity/Session、持久 Bot publication intent、owner-only ProjectBinding、ExternalPrincipal、multi-App aggregate、serial ChannelTurnRequest、roster 与 durable ChannelDelivery；不含 template/activation-first 恢复边界 |
| [DingTalk Channel v12（当前）](dingtalk-channel-v12.md) | v11 渠道能力不变；解除 Renderer “敬请期待”门禁，钉钉与飞书进入同一可管理 Provider 路径，未验收能力仍独立关闭 |
| [DingTalk Channel v11（历史）](dingtalk-channel-v11.md) | v10 卡片与撤回不变；多 App callback durable 合并为一个有序根请求，截止后可从 SQLite 封口；永久 Markdown 增加父消息摘要，Snapshot 增加安全阶段计数；Renderer 入口由 v12 开放 |
| [DingTalk Channel v10（历史）](dingtalk-channel-v10.md) | v9 群准入与通用 callback 不变；AI Card 分离 outTrack 更新身份与 carrier 撤回身份，执行卡和排队卡使用 Robot OpenAPI 真实撤回；入站聚合由 v11 替代 |
| [DingTalk Channel v9（历史）](dingtalk-channel-v9.md) | v8 私聊、执行入口与欢迎卡不变；普通群以 exact credential-bound Stream App、匹配的 `robotCode` 与 `isInAtList` 证明 receiving Bot，不比较 opaque Bot/mention ID；卡片撤回由 v10 替代 |
| [DingTalk Channel v8（历史）](dingtalk-channel-v8.md) | v7 私聊与执行入口不变；曾要求以 `chatbotUserId + atUsers` 证明 receiving Bot，该 ID 相等假设由 v9 纠正；新 Bot 首次欢迎卡继续继承 |
| [DingTalk Channel v7（历史）](dingtalk-channel-v7.md) | v6 三入口与渠道边界不变；最近输出 command 与飞书共用 `$` 和首尾截断，但继续排除 result；新 Bot 描述统一为 `Rovai AI Teammate`；群目标与发布通知由 v8 替代 |
| [DingTalk Channel v6（历史）](dingtalk-channel-v6.md) | v5 登录/发布/准入不变；渠道入口开放，普通群项目或 Quick Chat，三入口状态卡，共用固定 LAN 只读 URL；command 呈现与 Bot 描述由 v7 替代 |
| [DingTalk Channel v5（历史）](dingtalk-channel-v5.md) | v4 身份/存储/发布不变；Rovai 内置官方 QR、Main sandbox 原生交互页、exact-attempt 刷新与静默取消；执行卡与公开入口由 v6 替代 |
| [DingTalk Channel v4（历史）](dingtalk-channel-v4.md) | Main Web Session/SSO、schema-2 Cookie SQLite、封闭控制台创建/头像/Bot/权限/冻结版本发布、Owner-only 可见范围与中断防重建；独立窗口登录由 v5 内置扫码替代 |
| [DingTalk Channel v3（历史）](dingtalk-channel-v3.md) | v2 发布/Stream/Owner/项目/投递不变；删除设备授权，仅浏览器 OAuth；其 Client/Profile 登录语义由 v4 Web Session 替代 |
| [DingTalk Channel v2（历史）](dingtalk-channel-v2.md) | Main 直接 OAuth/Developer API、每队员 immutable 应用机器人、显式审批、Owner-only 私聊/普通群、统一 admission、群 roster、AI 卡片/Markdown、恢复和保守 feature gate；存储条款由 Channel Storage v2 替代 |
| [DingTalk Channel v1（历史）](dingtalk-channel-v1.md) | Rovai OAuth/DWS Gateway、staged Profile 切换、每队员 immutable 应用机器人、Owner-only 私聊/普通群、统一 admission、AI 卡片/Markdown 与保守 feature gate |
| [Camp Open Projection v8（历史）](camp-open-projection-v8.md) | v7 read/membership state 不变；Snapshot 34/Open 5 增加每 AgentRun/epoch 文件变化 summary |
| [Camp Open Projection v7（历史）](camp-open-projection-v7.md) | v6 read/attachment state 不变；Snapshot 33/Open 4 增加 membership generation 与活动 reconciliation |
| [Camp Open Projection v6（历史）](camp-open-projection-v6.md) | v5 read/evidence 不变；Message Attachment 增加 Runtime projection state，Renderer 诚实展示 pending/recovery/failed |
| [Camp Open Projection v5（历史）](camp-open-projection-v5.md) | v4 activation-aware enter 与 wire 不变；Camp open 完整返回所有 non-terminal Run Evidence，Renderer live event 不做最后 N 项裁剪 |
| [Camp Open Projection v4（历史）](camp-open-projection-v4.md) | v3 wire/window/模型事实不变；`camps.enter` 对 Pending 直接读投影、对 Active 保持 reconcile-before-read；non-terminal Evidence 仍为最近 80 条 |
| [Camp Open Projection v3（历史）](camp-open-projection-v3.md) | v2 methods/window/取消事实不变；AgentRun 默认策略的首个实际模型观测、Camp Open schema 3 与 Read Model schema 32；`camps.enter` 尚未区分 Pending |
| [Camp Open Projection v2（历史）](camp-open-projection-v2.md) | v1 methods/window 不变；AgentRun 独立取消请求事实、Camp Open schema 2 与 Read Model schema 31；不含 Runtime 模型观测 |
| [Camp Open Projection v1（历史）](camp-open-projection-v1.md) | Desktop `camps.enter/open/exists`、有界首屏投影、coverage/high-water、earlier message page 与 data-minimized trace；不含 AgentRun 取消请求字段 |
| [Camp Conversation Find v1（当前）](camp-conversation-find-v1.md) | Desktop 当前 Camp 公开 user/agent 正文的 exact count、单命中 traversal、Unicode scalar offset 与有界 around-window 定位 |
| [File Preview v4（当前）](file-preview-v4.md) | v3 打开与分类不变；消息 inline-code 只在同来源可解析为现存普通文件时生成链接，共享资源类型定义统一候选已知类型和会话/Tab 图标 |
| [File Preview v3（历史）](file-preview-v3.md) | 具体文件点击直接创建临时只读能力；Main 签发项目相对路径或仅文件名的安全呈现语义，工作区外文件不升级目录授权，HTML/Markdown 资源绑定文档目录 |
| [File Preview v2（历史）](file-preview-v2.md) | v1 预览读取/授权不变；撤回选区附加，预览不写入 Composer 或模型输入 |
| [File Preview v1（历史）](file-preview-v1.md) | 封闭文件来源、窗口句柄、读取、Root Grant、更新、HTML 资源与系统动作；选区子项未交付并由 v2 撤回 |
| [Camp Permanent Deletion v3（当前）](camp-permanent-deletion-v3.md) | 原删除权限/journal 不变；先定向业务终态，再有界 Runtime 清理和物理删除 |
| [Camp Permanent Deletion v2（历史）](camp-permanent-deletion-v2.md) | v1 删除合同不变；增加 Camp Published Attachment View journal cleanup，并规定先 fence Runtime、再取得 View write gate |
| [Camp Permanent Deletion v1（历史）](camp-permanent-deletion-v1.md) | `camps.delete` force 字段、兼容 blocker、单事务物理删除、Runtime cleanup 与 Renderer 确认边界；不含 Published View cleanup |
| [Runtime File Change Observation v2（当前）](runtime-file-change-observation-v2.md) | v1 Evidence/投影/呈现不变；精确排除当前 `ROVAI_RUN_TMP` 临时交付区，mixed evidence 保留普通文件且不迁移历史数据 |
| [Runtime File Change Observation v1（历史）](runtime-file-change-observation-v1.md) | Runtime 终态文件操作与 Command Diff；每 AgentRun/epoch 文件变化归约、Managed Blob、恢复、读取授权与 inline presentation；不含 managed output exclusion |
| [Benchmark Protocol v3（当前）](benchmark-protocol-v3.md) | 版本化 Run 信封、Product/Environment fingerprint、五层 Evidence、Adapter/derived projection、逐轴比较资格与 disclosure |
| [Semantic Judge Views v1（当前）](semantic-judge-views-v1.md) | Process/Blinded Outcome 双视图、模型可见 evidence allowlist、本地 Evidence ID、双 Replica、逐项 reconciliation 与 Hard Outcome non-interference |
| [Tool Interaction Measurement v2（当前）](tool-interaction-measurement-v2.md) | v1 的 opportunity/Judge 边界加 runtime catalog/projection 兼容门禁、Memory v3/readback、History Search、Task adapter 与 reply/task Process Evidence |
| [Tool Interaction Measurement v1（历史）](tool-interaction-measurement-v1.md) | Opportunity-based Camp/Memory/A2A trace、确定性 oracle/coverage 与独立 Tool-Use Judge 初版边界 |
| [Paired Collaboration Experiment v1（当前）](paired-collaboration-experiment-v1.md) | Team/Solo pre-registration、fresh arms、typed resources 与 outcome-conditioned paired comparison |
| [ACP Client Terminal v2（当前）](acp-client-terminal-v2.md) | v1 capability/wire/lifecycle 不变；显式绝对 cwd 只校验存在目录，不做 execution-root containment，权限由 Runtime/OS 拥有 |
| [ACP Client Terminal v1（历史）](acp-client-terminal-v1.md) | Runtime-specific `disabled/local_bridged` policy、标准 ACP Terminal wire、本地 ManagedProcess 派生、旧 workspace-contained cwd、Run fencing、有界输出与 cancellation/release cleanup |
| [Runtime Launch and Verification v28（历史）](runtime-launch-and-verification-v28.md) | v27 边界不变；ACP Client FS 成为无 execution-root containment、无一次性 token 的 Runtime-owned 文件执行代理；自动/绕过模式的合格 permission request 只作协议兼容 allow |
| [Runtime Launch and Verification v27（历史）](runtime-launch-and-verification-v27.md) | v26 边界不变；Grok Build 三端最低版本统一为 `>= 1.0.0`，Ready 要求标准 ACP resume，cold continuation 从 load-only HistoryRestore 切到 `session/resume`，creation-only rules 不在恢复时重注入 |
| [Runtime Launch and Verification v26（历史）](runtime-launch-and-verification-v26.md) | v25 launch/权限/Cursor 边界不变；增加 TRAE 专属 `rawInput.Command`、ACP error/activity/failure 与时间域规则，并补充 Grok Build 的官方配置、load-only continuation、原生 rules、compaction、Plugin MCP 和 generic agent-text 边界 |
| [Runtime Launch and Verification v25（历史）](runtime-launch-and-verification-v25.md) | v24 的 Kimi `yolo` 与十二种 Runtime 最高权限默认不变；Cursor 在 Settings 与普通成员 Runtime selector 中保持隐藏，历史配置只读保留；不含 v26 的 TRAE command、ACP error/activity、failure 与时间域修正 |
| [Runtime Launch and Verification v24（历史）](runtime-launch-and-verification-v24.md) | v23 的 Kimi Home、continuation、External MCP 与 Cursor Settings 边界不变；十二种 Runtime 新队员统一使用已验证的原生最高权限默认，Kimi 为 `yolo` |
| [Runtime Launch and Verification v23（历史）](runtime-launch-and-verification-v23.md) | Kimi 正式 AgentRun 继承用户原生 Home，Probe 继续临时隔离；其 Kimi 新队员 `default` 权限已由 v24 修正为 `yolo` |
| [Runtime Launch and Verification v22（历史）](runtime-launch-and-verification-v22.md) | v21 的多 scope home 收敛为唯一 Rovai 私有 home并启用 warm Host 与 External MCP；其私有 Home 语义已由 v23 替代 |
| [Runtime Launch and Verification v21（历史）](runtime-launch-and-verification-v21.md) | v20 Kimi provider 边界不变；其 scoped Session home 与 External MCP Disabled 语义已由 v22 替代 |
| [Runtime Launch and Verification v20（历史）](runtime-launch-and-verification-v20.md) | v19 launch/Ready/Cursor 边界不变；加入 Kimi identity、MiniMax 私有 provider 配置、推理隔离与保守平台准入；其每 Host 新 home/new-only 语义已由 v21 替代 |
| [Runtime Launch and Verification v19（历史）](runtime-launch-and-verification-v19.md) | v18 launch/Ready/LKG 边界不变；加入 Cursor identity、vendor ACP、保守能力与逐平台未准入合同 |
| [Runtime Launch and Verification v18（历史）](runtime-launch-and-verification-v18.md) | v17 wire/LKG 边界不变；Adapter Deep Probe 统一覆盖 version、一次重新绑定与三秒 Execution cooldown 自动恢复 |
| [Runtime Launch and Verification v17（历史）](runtime-launch-and-verification-v17.md) | v16 启动/命令边界不变；完整 Probe identity 前后复核、一次重新绑定、三态 deferred 与 stale LKG/当前 Ready evidence 分离；Execution deferred 仍需显式动作解锁 |
| [Runtime Launch and Verification v16（历史）](runtime-launch-and-verification-v16.md) | v15 启动与 retry 边界不变；Claude Bash 与 ACP 仅公开 Shell command，并让 started/terminal Evidence 自包含；ACP 非零 exit code 诚实映射失败 |
| [Runtime Launch and Verification v15（历史）](runtime-launch-and-verification-v15.md) | v14 lifecycle 与 payload 不变；Claude Code stream-json 的 session-bound `system/api_retry` 成为权威 live source，stderr grammar 保持兼容 fallback |
| [Runtime Launch and Verification v14（历史）](runtime-launch-and-verification-v14.md) | v13 启动与 Run tmp 边界不变；Claude Code 可把严格白名单的运行中 API retry 状态即时投影为安全诊断，不公开 raw stderr |
| [Runtime Launch and Verification v13（历史）](runtime-launch-and-verification-v13.md) | v12 View/Ready 边界不变；所有正式 Runtime 显式获得当前 lease 已重置的 exact writable Run tmp root |
| [Runtime Launch and Verification v12（历史）](runtime-launch-and-verification-v12.md) | v11 exact-root/receipt 不变；View contract 3 要求 resolved publication；TRAE 使用统一 Machine Ready，并允许 Idle Session metadata |
| [Runtime Launch and Verification v11（历史）](runtime-launch-and-verification-v11.md) | v10 exact-root/generation fence 不变；View contract 2 分离冻结语义 receipt 与当前物理 Runtime authorization |
| [Runtime Launch and Verification v10（历史）](runtime-launch-and-verification-v10.md) | v9 边界不变；每次 launch 绑定当前 Camp 精确 Published Attachment root、View receipt、visibility mode 与 generation；仍把 Manifest 恢复绑定到物理 identity |
| [Runtime Launch and Verification v9（历史）](runtime-launch-and-verification-v9.md) | v8 边界不变；增加 60 秒/24 小时模型目录 SWR、Picker-open、主动检查终态与真实 Session 显式模型校验；不含 Published View 授权 |
| [Runtime Launch and Verification v8（历史）](runtime-launch-and-verification-v8.md) | v7 启动/恢复边界不变；增加 Claude Code/Antigravity 安全公开 failure、AgentRun/Probe 持久化、Availability 与内部诊断分离 |
| [Runtime Launch and Verification v7（历史）](runtime-launch-and-verification-v7.md) | v6 加恢复 response exact-ID 校验；不同 ID 使 Host protocol-violated 并进入 continuity-lost fallback，禁止换绑返回 ID；不含公开 Runtime failure |
| [Runtime Platform Admission v2（当前）](runtime-platform-admission-v2.md) | v1 不变；增加可 discovery/选择/执行但不伪造 qualification evidence 的 `preview` 状态 |
| [Runtime Platform Admission v1（历史）](runtime-platform-admission-v1.md) | `AdapterKind × HostPlatformKey` 三态准入、closed reason/evidence、现有配置保留与 execution blocker |
| [Managed Runtime Process v1（当前）](managed-runtime-process-v1.md) | 统一进程启动 interface、Windows 创建时 Job/handle list、native EXE/受控 `.cmd/.bat` identity、macOS User Automation protected-tree deny 与 descendant cleanup |
| [Runtime Launch and Verification v6（历史）](runtime-launch-and-verification-v6.md) | v5 加 TRAE exact-ID Provider Resume Probe、受控 ACP HistoryRestore、replay quarantine、兼容性 fence 与 continuity-lost fallback；其接受不同 response ID 的语义已由 v7 替代 |
| [Runtime Launch and Verification v5（历史）](runtime-launch-and-verification-v5.md) | v4 加 TRAE 有界启动轻检、用户授权快速 ACP Session Probe 与 Ready commit fence |
| [Runtime Launch and Verification v4（历史）](runtime-launch-and-verification-v4.md) | v3 加 TRAE/Kiro 最高权限队员默认、Kiro trust-all Host 映射与 permission schema digest preserve fence |
| [Runtime Launch and Verification v3（历史）](runtime-launch-and-verification-v3.md) | v2 加 light discovery、显式/首次执行深检、manager-owned attempt、两路并发、generation/fingerprint fence 与统一受限 Probe process owner |
| [Runtime Launch and Verification v2（历史）](runtime-launch-and-verification-v2.md) | v1 的 purpose/static verification 加 ACP Reuse/Resume/New、LoadHistory replay quarantine、Prompt fence、response-only ACK 与 TRAE warm Host |
| [Runtime Launch and Verification v1（历史）](runtime-launch-and-verification-v1.md) | Runtime launch purpose、TRAE 静态 Installation、`installed_unverified`、nullable version 与旧 `session/new|load` 执行路径 |
| [Runtime Usage Monitoring v3（历史）](runtime-usage-monitoring-v3.md) | v2 五表与 Snapshot 不变；补齐 OpenCode 版本感知 Cache Write/零值语义和 Codex 版本化 API 公价估算 |
| [Runtime Usage Monitoring v2（历史）](runtime-usage-monitoring-v2.md) | 五表 clean break、内存 Usage 合并、稀疏 Token/Cache/Cost、Coverage、单 Snapshot 与有界刷新 |
| [Runtime Monitoring v1（历史）](runtime-monitoring-v1.md) | Clean-break collection/enrollment、稀疏 Usage Observation、Native Session fact、三类查询、Coverage、Tool Duration 与 Cost layer |
| [Diagnostics Center v1（当前）](diagnostics-center-v1.md) | `diagnostics.check` typed read model、三态分类、显式单项修复映射、Recovery 与集中脱敏的 `rovai-diagnostics-v5` |
| [User Automation v1（当前）](user-automation-v1.md) | 普通用户 `rovai app` 的独立本机 IPC、Runtime OS 隔离、原子 Camp/Run 自动化、真实 shell exit、双 cursor Diagnostic Trial、安全投影与私有 bundle |
| [Accepted Input Recovery v5（当前）](accepted-input-recovery-v5.md) | v4 发送边界不变；普通恢复失败与业务取消终态分离 |
| [Accepted Input Recovery v4（历史）](accepted-input-recovery-v4.md) | 新增 `dispatch_started_at`；发送/取消事务排序，迟到回执只补证据 |
| [Accepted Input Recovery v3（历史）](accepted-input-recovery-v3.md) | v2 outcome-unknown 边界不变；Manifest 21 使用语义 View receipt，并增加 Migration 100 clean break |
| [Accepted Input Recovery v2（历史）](accepted-input-recovery-v2.md) | v1 正常恢复边界不变；增加 Migration 99 对旧 Formatter 20 非终态输入的 evidence-aware clean break |
| [Accepted Input Recovery v1（历史）](accepted-input-recovery-v1.md) | accepted Runtime input 的启动分类、`recovery_blocked`、Scheduler fence、用户命令与 Stop/预算 outcome-unknown 收敛；不含 Migration 99 |
| [Collaboration State v2（当前）](collaboration-state-v2.md) | peer-only routing identity、稳定 CampMember 选择、Lead ID/Boolean、完整 projection digest、独立 inclusion、accepted ACK 与 v0.50 clean break |
| [Camp History Retrieval v4（当前）](camp-history-v4.md) | v3 读取/授权/身份语义不变；CLI 在 Schema 前把省略 mode 安全补全为 timeline/before/20，消息锚点模式仍显式 |
| [Camp History Retrieval v3（历史）](camp-history-v3.md) | v2 Agent projection/授权/读取语义不变；所有显式 target 与输出只接受唯一 canonical Camp ID |
| [Camp History Retrieval v2（历史）](camp-history-v2.md) | v1 查询、授权、publication fence 与附件边界不变；Agent body/snippet/offset 使用 `agent_v1` Principal 投影，并为 `@Principal` 提供结构化候选路径 |
| [Camp History Retrieval v1（历史）](camp-history-v1.md) | `camp.search/read/history.search` 的 single-Camp target、Manifest/live authorization、Public A2A publication fence 与旧 Human-body Agent 投影 |
| [Memory Capture v3（当前）](memory-capture-v3.md) | v2 边界加 complete exact-Scope View、copyable Revision target、active body aggregate quota、64 KiB production projection limit 与 Memory-domain clean break |
| [Memory Capture v2 (historical)](memory-capture-v2.md) | v1 捕获/Review/Forget 边界加 flat Agent-relative Scope identity、revise target assertion、durable domain rejection 与 Supersession 原子顺序 |
| [Memory Capture v1 (historical)](memory-capture-v1.md) | 初版 best-effort 在线捕获、actor-bounded add/revise、隔离 Hearth Review Item、双 CAS、候选清除与 Forget safeguard；不含 Scope-identified revise |
| [Built-in Tool Transport v21（当前）](builtin-tool-transport-v21.md) | v20 IPC/Envelope 不变；当前 lease 根目录与 CLI 外部附件快照 |
| [Built-in Tool Transport v20（历史）](builtin-tool-transport-v20.md) | v19 transport/Send v12 不变；Charter 按需复用 help 并精简 Principal/catalog 指导，`sessionCharterRevision: 2` 轮换旧 Native Session Binding |
| [Built-in Tool Transport v19（历史）](builtin-tool-transport-v19.md) | v18 IPC/Output 不变；Send v12 支持纯附件，Run tmp 在每次 lease 前重置并由 Runtime 精确准入 |
| [Built-in Tool Transport v18（历史）](builtin-tool-transport-v18.md) | v17 transport 不变；Send v11 增加受限 `--file` ingress 与锁外 Authority freeze，Agent Output 不变 |
| [Built-in Tool Transport v17（历史）](builtin-tool-transport-v17.md) | v16 transport/Core 语义不变；加入 `camp.read` CLI 默认补全、定向错误、History v4 与 v17 capability，Charter/Formatter/Manifest 不变 |
| [Built-in Tool Transport v16（历史）](builtin-tool-transport-v16.md) | v15 transport/operation 语义不变；catalog、result、capability 与 Binding 统一使用 canonical Camp ID、History v3 和 Formatter20/Manifest18 |
| [Built-in Tool Transport v15（历史）](builtin-tool-transport-v15.md) | 完整继承 v14 LocalIpcEndpoint/IPC v2，并加入 PublicOnly、canonical Principal attention、Send output v2 与 v15 catalog/capability clean break |
| [Built-in Tool Transport v14（历史）](builtin-tool-transport-v14.md) | v13 十五项 operation 语义不变；LocalIpcEndpoint、IPC v2、Unix Socket/受保护 Windows Named Pipe 与 v14 capability clean break |
| [Built-in Tool Agent Output Projection v1（当前）](builtin-tool-agent-output-projection-v1.md) | Core 完成后 Agent projection/schema drift 的安全 `output_contract_mismatch`、非重试 recovery 与 private local diagnostic |
| [Built-in Tool Transport v13（历史）](builtin-tool-transport-v13.md) | 十五项固定命令、`team.gather -> rovai gather`、异步 completion、Unix IPC 与 v13 catalog/capability |
| [Built-in Tool Transport v12 (historical)](builtin-tool-transport-v12.md) | 十四项固定命令、direct-user `member.create`、creationKey 幂等、可选受控头像导入与 v12 catalog/capability |
| [Built-in Tool Transport v11 (historical)](builtin-tool-transport-v11.md) | 十三项固定命令、complete Memory View、copyable Read/revise target、durable Memory rejection 与 v11 catalog/capability |
| [Built-in Tool Transport v10 (historical)](builtin-tool-transport-v10.md) | 十二项固定命令、flat Scope-identified Memory Search/Read/revise 与 v10 catalog/capability |
| [Built-in Tool Transport v9 (historical)](builtin-tool-transport-v9.md) | 统一 `memory.write` 与 effective/review_pending 初版；Search/Read/revise 不含完整 Scope identity |
| [Built-in Tool Transport v8 (historical)](builtin-tool-transport-v8.md) | v0.70 十三项命令、独立 `memory.propose_hearth` 与 Camp Message Send v5；不作为 v0.73 CLI context/catalog 入口 |
| [Built-in Tool Transport v7 (historical)](builtin-tool-transport-v7.md) | v0.67 的 Camp Message Send v4、exact Camp read addressing 与初版渐进式 CLI 教学；不作为 v0.73 CLI context/catalog 入口 |
| [Built-in Tool Transport v7 Errata](builtin-tool-transport-v7-errata.md) | 历史 v7 locator-present recovery 勘误；其 self-write exact-read 语义已由 v8/v9 继承 |
| [Durable Task v3（当前）](durable-task-v3.md) | User/Lead 责任定义、Assignee execution-state update、Camp-wide read、explicit owner、unassigned holding 与 advisory actions |
| [Camp Message Send v19（当前）](camp-message-send-v19.md) | Agent-visible target 教学只推荐 `--to`，Charter revision 5；v18 inline compatibility parser 与发送效果不变 |
| [Camp Message Send v18（历史）](camp-message-send-v18.md) | Agent body help 收敛到 payload；行首连续有效队员 alias 兼容解析，invalid alias tail 保持普通 Text |
| [Camp Message Send v17（历史）](camp-message-send-v17.md) | v16 发送语义与 CLI help 不变；Principal 寻址教学去歧义，Charter revision 4 |
| [Camp Message Send v16（历史）](camp-message-send-v16.md) | v15 发送语义不变；收件人文件用途教学与新飞书 Session 的冻结交付提示，Charter revision 3 |
| [Camp Message Send v15（历史）](camp-message-send-v15.md) | Agent/User Automation 保持既有合同；Desktop Composer 增加私有 next-turn admission |
| [Camp Message Send v14（历史）](camp-message-send-v14.md) | v13 原子提交/结果不变；CLI 接受 Runtime 可读外部文件/目录并在 IPC 前快照 |
| [Camp Message Send v13（历史）](camp-message-send-v13.md) | v12 input/结果不变；Agent files 一次 ingest 为 Managed v2，Delivery 不再进入 publication gate 或等待活跃 Run |
| [Camp Message Send v12（历史）](camp-message-send-v12.md) | v11 publication/结果不变；body 可选默认空串，正文或至少一个文件即可构成 Send payload |
| [Camp Message Send v11（历史）](camp-message-send-v11.md) | v10 寻址/结果不变；增加 AgentRun-local `files`、真实 accepted IDs 与统一异步附件 publication |
| [Camp Message Send v10（历史）](camp-message-send-v10.md) | v9 语义加显式 Automatic/PublicOnly 寻址意图、parser 前硬门、clean-break event v2 与 closed Send result |
| [Camp Message Send v9（历史）](camp-message-send-v9.md) | v8 精确 Gather capture 加独立每 Item/generation 回传限额与普通 A2A ledger 豁免 |
| [Camp Message Send v8（历史）](camp-message-send-v8.md) | 精确 Gather return capture、混合 recipient 原子性与旧 accepted-A2A 分账 |
| [Camp Message Send v7 (historical)](camp-message-send-v7.md) | v6 canonical freeze 不变；显示名 alias 只在 logical line 的首个非空白 token 寻址，普通 mid-line prose 不唤醒 |
| [Camp Message Send v6 (historical)](camp-message-send-v6.md) | v5 closed input 与投递链不变；新增当前 Camp 有效成员显示名 alias，但允许任意 parseable body position |
| [Camp Message Send v5 (historical)](camp-message-send-v5.md) | v4 Core 效果与 wire 不变；收窄 `mentionUser` / `--to-user` 的消息局部使用边界，但正文不解析显示名 alias |
| [Camp Message Send v4 (historical)](camp-message-send-v4.md) | v3 显式 Agent 寻址/caller return 加初版 `--to-user`、Structured Current User Mention 与原子通知 |
| [Camp Message Send v4 Errata](camp-message-send-v4-errata.md) | 历史 v4 Current User Attention 生命周期与 locator-present exact verification 勘误；其修正已由 v5 继承 |
| [Notification Episode v5（当前）](notification-episode-v5.md) | v4 生命周期不变；camp 增加只读 channelSource，schema 6 与原始 title 不变 |
| [Notification Episode v4（历史）](notification-episode-v4.md) | v3 精确 signal 生命周期加会话可见来源的有界批量确认与即时角标刷新 |
| [Notification Episode v3 (historical)](notification-episode-v3.md) | v2 精确 signal 加 Journal acknowledgement/Clear/remove invalidation、顺序式队列归约与 reset 清空；不含普通会话可见来源确认 |
| [Notification Episode v2 (historical)](notification-episode-v2.md) | v1 三层模型加 Active Attention、exact HeadsUpSignal、事务式 Renderer cursor、pending-first Approval 与 acknowledge-only action；不含 signal 入队后的精确失效合同 |
| [Notification Episode v1 (historical)](notification-episode-v1.md) | 初版 immutable Occurrence、separate Disposition、materialized Episode、minimal Change Journal、bounded write、typed action、heads-up 与 retention |
| [Current User Attention v4（当前）](current-user-attention-v4.md) | v3 逐来源确认加普通进入会话后的精确可见即已读，不要求通知动作或 DOM 焦点 |
| [Current User Attention v3 (historical)](current-user-attention-v3.md) | v2 精确确认加同 CampTurn 一卡、逐 Mention acknowledgement、最早未确认 action 与导航版本绑定；不含普通会话可见即已读 |
| [Current User Attention v2 (historical)](current-user-attention-v2.md) | v1 当前用户注意力加 Message Mention 独立已读、锚点导航、焦点确认与 Markdown 保真；不含 Episode 聚合 |
| [Current User Attention v1 (historical)](current-user-attention-v1.md) | 当前用户身份、结构化内容与原子通知基线；不含独立已读、锚点窗口与 Markdown 保真勘误 |
| [Missing-Send Recovery Publication v2（当前）](missing-send-recovery-publication-v2.md) | v1 candidate/replay 不变；普通输出与 Missing-Send 均受 frozen membership lifetime publication fence 约束 |
| [Missing-Send Recovery Publication v1（历史）](missing-send-recovery-publication-v1.md) | 成功 AgentRun 的 typed final candidate、同 Run accepted-send 抑制、recipient-free 原子恢复消息与 terminal replay/竞态语义 |
| [Pending Camp Activation v1（当前）](pending-camp-activation-v1.md) | 一键 Pending 创建、Snapshot/Navigation activation state、首消息原子激活、mutation guard 与窄 discard/启动清理 |
| [Camp Attachment v7（当前）](camp-attachment-v7.md) | v6 Managed v2 不变；CLI 私有外部源快照、共享安全复制与 lease 清理 |
| [Camp Attachment v6（历史）](camp-attachment-v6.md) | 新写 Managed v2 单副本、durable ingest、同 Camp ref 复用、无 Run 等待、DB-only Context path 与 legacy v1 只读兼容 |
| [Camp Attachment v5（历史）](camp-attachment-v5.md) | v4 ingress/Runtime 不变；Published Authority 的 Desktop open target、Core 风险判定与 Renderer 无路径边界 |
| [Camp Attachment v4（历史）](camp-attachment-v4.md) | v3 publication 不变；Run tmp 逐 lease 隔离，并以共享 per-Camp gate 串行 Authority 权限切换与清理 |
| [Camp Attachment v3（历史）](camp-attachment-v3.md) | v2 shape/limits/Authority 不变；统一 Composer/Agent ingress 与 pending/available/recovery/failed Runtime projection |
| [Camp Attachment v2（历史）](camp-attachment-v2.md) | v1 ingress/限制/digest 不变；Draft 保持 Core-private，Published Attachment 成为 Camp-shared 并只通过 Runtime View 暴露 |
| [Camp Published Attachment View v4（当前 legacy v1 兼容）](camp-published-attachment-view-v4.md) | 只约束历史 Authority/View publication、recovery 与 gate；所有新附件由 Camp Attachment v7 写入 Managed v2 |
| [Camp Published Attachment View v3（历史）](camp-published-attachment-view-v3.md) | v2 receipt wire 不变；semantic/resolved/catalog 三轴、FIFO worker、failed tombstone 与统一 available Desired set |
| [Camp Published Attachment View v2（历史）](camp-published-attachment-view-v2.md) | v1 root/journal/generation fence 不变；增加稳定 semantic catalog/receipt、可重建物理轴与无全局 DB 锁 copy phase |
| [Camp Published Attachment View v1（历史）](camp-published-attachment-view-v1.md) | 实例/Camp 隔离 root、publication journal、ready catalog、generation、物理 Manifest receipt、quota、rebuild 与安全清理 |
| [Camp Attachment v1（历史）](camp-attachment-v1.md) | 普通文件/目录联合、Core-owned 只读快照、限制、Draft 原子消费、Snapshot 29 与旧 Runtime Authority path |
| [Camp Composer Draft v6（当前）](camp-composer-draft-v6.md) | exact Draft 经 Core 决定直接发送或私有 FIFO 入队；Pending 编辑独立于普通 Draft |
| [Camp Composer Draft v5（历史）](camp-composer-draft-v5.md) | v4 Draft/revision 语义不变；Send 时 ingest Managed v2，最终事务原子提交 Message/ref/Delivery 且不等待 Run |
| [Camp Composer Draft v4（历史）](camp-composer-draft-v4.md) | v3 sendability 不变；语义事务先提交并由持久 writer intent 阻断 Run，View 异步物化 |
| [Camp Composer Draft v3（历史）](camp-composer-draft-v3.md) | v2 reply/continuation 边界不变；ready 附件可以独立构成用户发送 payload，空正文忠实持久化并保留原子消费 |
| [Camp Composer Draft v2（历史）](camp-composer-draft-v2.md) | v1 reply 边界加 durable recipient continuation、source suppression、发送物化、显式修复与无 Default Lead fallback；仍继承正文非空发送要求 |
| [Camp Composer Draft v1 (historical)](camp-composer-draft-v1.md) | Structured Content、附件引用、持久 reply intent、exact revision mutation、显式接收者修复与 Draft-only user send；不含 continuation |
| [Planned Shutdown v5（当前）](planned-shutdown-v5.md) | v4 wire/report 不变；退出取消 Run 统一为 cancelled，内部未知效果计数保留 |
| [Planned Shutdown v4（历史）](planned-shutdown-v4.md) | wire 仍为 protocol 3；先业务结算再 Runtime 清理，未知终态与原 report 保留 |
| [Planned Shutdown v3（历史）](planned-shutdown-v3.md) | 退出、重启或更新统一取消全部非终态 AgentRun；稳定快照后立即关闭 terminal/route 准入，保留未知效果并使用 v3 report |
| [Planned Shutdown v2（历史）](planned-shutdown-v2.md) | v1 generation-local reliable terminal 加 durable shutdown cycle、product fence、启动补偿、终态 unknown-effect 保留与 v2 report |
| [App Update v1（当前）](app-update-v1.md) | Desktop 主动检查、独立 release/prompt 事实、显式下载与安装、精确提醒 dismiss、状态投影和 updater-first 受控退出 |
| [Windows Private Storage v2（当前）](windows-private-storage-v2.md) | v1 私有存储不变；增加 `<data_dir>\runtime-files`、受保护 View containers 与精确 Camp root 暴露边界 |
| [Windows Private Storage v1（历史）](windows-private-storage-v1.md) | `%LOCALAPPDATA%` 布局、local NTFS admission、创建时 protected DACL、handle identity 与 long-path blocker；不含 Runtime Files Root |
| [Windows Skill Projection v1（当前）](windows-skill-projection-v1.md) | copy backend 多阶段 journal、crash-window 幂等恢复、Execution Root Projection Gate 与 project-owned preserve |
| [Planned Shutdown v1 (historical)](planned-shutdown-v1.md) | Main-only v1 wire、launch/terminal admission、generation-local route binding 与只接受可靠 Runtime terminal 的旧关闭语义 |
| [Built-in Tool Transport v6 (historical)](builtin-tool-transport-v6.md) | v0.62 Camp Message Send v3 transport；不作为 v0.65 parser/help/compatibility 入口 |
| [Built-in Tool Transport v5 (historical)](builtin-tool-transport-v5.md) | v0.54 Task v3 transport；不作为 v0.62 Runtime/CLI compatibility 入口 |
| [Built-in Tool Transport v4 (historical)](builtin-tool-transport-v4.md) | v0.47 Task v2 transport；不作为 v0.62 Runtime/CLI compatibility 入口 |
| [Durable Task v2 (historical)](durable-task-v2.md) | ordinary-Agent create/claim 与受限读取的旧 Task 合同；不作为当前 authority |
| [Built-in Tool Transport v3 (historical)](builtin-tool-transport-v3.md) | v0.46 十二项命令与 Agent Result Projection v1；不作为 v0.47 Runtime/CLI compatibility 入口 |
| [Built-in Tool Transport v2 (historical)](builtin-tool-transport-v2.md) | v0.45 Agent CLI、catalog、IPC、Envelope、receipt、幂等、lease 与旧私有 operation clean break |
| [Camp Message Send v1 (historical)](camp-message-send-v1.md) | v0.45 `camp.message.send` / `rovai send`、Addressing Token、recipient resolution、fanout、lineage 与错误 |
| [Camp Message Send v2 (historical)](camp-message-send-v2.md) | v0.46 隐式 Camp 与 Agent 输入 reply default target；不作为 v0.62 send 入口 |
| [Camp Message Send v3 (historical)](camp-message-send-v3.md) | v0.62 caller return 与 Core-managed reply reference；不含 v0.65 Current User Attention |
| [Gather v5（当前）](gather-v5.md) | v4 lifecycle 不变；schema/help 只推荐 canonical `--to`，保留 distinct repeat 与 `uniqueItems` 校验 |
| [Gather v4（历史）](gather-v4.md) | v3 input/projection 不变；冻结 initiator membership lifetime，成员移除级联取消并只由正式 terminal settlement 推进 |
| [Gather v3（历史）](gather-v3.md) | v2 lifecycle/limits 不变；Completion Input 使用 `agent_v1` request/captured 投影、projected digest 与 schema v3 |
| [Gather v2（历史）](gather-v2.md) | v1 lifecycle 加当前代最后 captured result、独立回传限额、完整 request 与 completion input v2 |
| [Gather v1（历史）](gather-v1.md) | GatherRecord/Item、Default Lead 接受、持久 capture/Barrier、completion snapshot/FIFO 与旧 capture budget/input v1 |
| [Message Delivery v8（当前）](message-delivery-v8.md) | v7 取消语义不变；Managed v2 Message 直接普通 dispatch，`projection_blocked` 只收口 legacy v1 operation |
| [Message Delivery v7（历史）](message-delivery-v7.md) | v6 membership lifetime 不变；允许 `cancelled + terminal + attempt=0`，统一显式/批量取消转换并保证迟到回调与重启不复活 |
| [Message Delivery v6（历史）](message-delivery-v6.md) | v5 lifecycle/gate 不变；admission 冻结 recipient membership version，离开后再添加不能复活 dispatch/retry |
| [Message Delivery v5（历史）](message-delivery-v5.md) | v4 联合/FIFO 不变；增加无 attempt 的 `projection_blocked` gate、成功释放与失败 settlement |
| [Message Delivery v4（历史）](message-delivery-v4.md) | v3 判别联合加 generation-strict last capture projection 与独立 captured-return allowance |
| [Message Delivery v3（历史）](message-delivery-v3.md) | public/captured/completion 判别联合、Delivery-level completion role 与初版 Gather settlement |
| [Message Delivery v2 (historical)](message-delivery-v2.md) | `forward | return` 冻结边、target lineage、caller continuation，以及 v1 queue/attempt/recovery/settlement |
| [Message Delivery v1 (historical)](message-delivery-v1.md) | 无 caller-return 分类的 recipient queue、dispatch attempt、waitCondition、retry/cancel 与 settlement |
| [Current Input Skill Links v1（当前）](current-input-skill-links-v1.md) | Structured Skill Mention、per-Run send snapshot、start-time resolver 与 optional sibling `CURRENT_INPUT.skills[{name,path}]` |
| [ContextManifest Evidence v22（当前）](context-manifest-evidence-v22.md) | v21 selection/evidence 不变；Formatter/Manifest 22 增加 ExternalPrincipal direct source 与 ExternalQuote deterministic projection |
| [ContextManifest Evidence v21（历史）](context-manifest-evidence-v21.md) | Formatter 21 bytes 不变；View receipt v2 只冻结稳定附件语义；不含 ExternalPrincipal/ExternalQuote |
| [ContextManifest Evidence v20（历史）](context-manifest-evidence-v20.md) | Formatter 21、mandatory Run Facts v2、Published View paths/physical receipt、schema 54 与 Migration 99 clean break |
| [ContextManifest Evidence v19（历史）](context-manifest-evidence-v19.md) | Formatter v20 与 v18 wire 不变；冻结 Profile v4 的自身 recent 作者过滤、eligible omission、schema 53 与 Migration 98 clean break；不含 View receipt |
| [ContextManifest Evidence v18（历史）](context-manifest-evidence-v18.md) | Formatter v20；v17 section/evidence 不变，Shared Conversation、Manifest 与 History Camp reference 只使用 canonical Camp ID；不含自身 recent 作者过滤 |
| [ContextManifest Evidence v17（历史）](context-manifest-evidence-v17.md) | Formatter v19、`agent_v1` message audience、closed forward/return A2A guidance evidence、Gather v3 与 exact frozen recovery |
| [ContextManifest Evidence v16（历史）](context-manifest-evidence-v16.md) | Formatter v18、Skill selection/availability/Exposure/resolution、exact payload 与 Migration 91 clean-break recovery |
| [ContextManifest Evidence v15（历史）](context-manifest-evidence-v15.md) | Formatter v17、compact history/offset、Run Facts exact bytes/evidence 与旧 v15 recovery 边界 |
| [Run Facts v2（当前）](run-facts-v2.md) | v1 optional facts 不变；增加每个 AgentRun mandatory `campResources` Published Attachment root |
| [Run Facts v1（历史）](run-facts-v1.md) | Task reference、Session continuity、external effect、Gather generation fallback 与 delegation budget 的 optional 结构化模型事实 |
| [ContextManifest Evidence v14（历史）](context-manifest-evidence-v14.md) | Formatter v16、Gather result notice、完整 request/current generation evidence 与旧 v14/v15 exact recovery |
| [ContextManifest Evidence v13（历史）](context-manifest-evidence-v13.md) | Formatter v15、`gather_completion` 与 completion input v1 frozen evidence |
| [ContextManifest Evidence v12 (historical)](context-manifest-evidence-v12.md) | v11 self-active semantics 加 Formatter v14 的 `mentionsCurrentUser`、Structured Content/projected body evidence 与 frozen recovery |
| [Context Delivery Profile v4（当前）](context-delivery-profile-v4.md) | v3 数值与 Task/reference 语义不变；当前 Agent 自身消息在 recent top-15 和 whole-history omission 前失去候选资格 |
| [Context Delivery Profile v3（历史）](context-delivery-profile-v3.md) | v2 public context 加 self-active Task selection/order/max 8 与 public-history-first budget priority；自身消息仍属于 recent candidate |
| [ContextManifest Evidence v11 (historical)](context-manifest-evidence-v11.md) | Formatter v13 与 self-active empty/omission 语义；不含 Current User Mention metadata |
| [ContextManifest Evidence v10 (historical)](context-manifest-evidence-v10.md) | self-active Task evidence 的旧空集合语义；不作为 Formatter v13 恢复入口 |
| [ContextManifest Evidence v9 (historical)](context-manifest-evidence-v9.md) | bounded public omission evidence；不作为 Formatter v13 恢复入口 |
| [Context Delivery Profile v2 (historical)](context-delivery-profile-v2.md) | 公共引用链与历史 budget 的旧当前合同；不选择 self-active Task |
| [Context Delivery Profile v1 (historical)](context-delivery-profile-v1.md) | AgentRun 公共消息窗口、Unicode scalar 正文截断、历史字符预算与遗漏提示 |
| [Run Process Detail Surface v30（当前）](run-process-detail-surface-v30.md) | v29 布局、Tool 行与 Compaction 不变；活动 Tool 组摘要优先展示已有公开证据中的具体当前指令 |
| [Run Process Detail Surface v29（历史）](run-process-detail-surface-v29.md) | v28 布局与取消不变；增加 active AgentRun 的本地非 Tool Compaction 展示旁路 |
| [Run Process Detail Surface v28（历史）](run-process-detail-surface-v28.md) | v27 布局不变；取消显示已取消并清除旧外部效果提示 |
| [Run Process Detail Surface v27（历史）](run-process-detail-surface-v27.md) | v26 布局不变；停止等待仅限 IPC，立即显示 Core 实际终态 |
| [Run Process Detail Surface v26（历史）](run-process-detail-surface-v26.md) | 完整继承 v25；Web 搜索使用 `搜索 <query>` 与连续公开结果，保留非 Shell 结果面与缩进 |
| [Run Process Detail Surface v25（历史）](run-process-detail-surface-v25.md) | 完整继承 v24；Shell disclosure 使用 `$ command` 与连续 output、独立结果面 token，并与 Terminal 图标左边界同轴 |
| [Run Process Detail Surface v24（历史）](run-process-detail-surface-v24.md) | v23 分组与 live-tail 不变；`activity-v2` 五域、Renderer 中文标题、七类图标、Rovai Catalog identity、公开 typed query 与无历史回填切换 |
| [Run Process Detail Surface v23（历史）](run-process-detail-surface-v23.md) | v22 live-tail 与收口边界不变；Tool 间隙持续显示“执行中 · <最近一条指令>”，不再切换为累计数 |
| [Run Process Detail Surface v22（历史）](run-process-detail-surface-v22.md) | v21 摘要与状态边界不变；running Run 的尾组延迟到真实 process/Run 边界再收口，Tool 间隙保持运行摘要与稳定高度，组图标和文字共享 16px 中心线 |
| [Run Process Detail Surface v21（历史）](run-process-detail-surface-v21.md) | v20 分组与惰性结果边界不变；活动摘要只显示已执行总数，终态摘要不追加结果文字，组内有成功即为绿色、仅全部失败为红色 |
| [Run Process Detail Surface v20（历史）](run-process-detail-surface-v20.md) | v19 命令、结果与执行台边界不变；同一 Run 内最大连续 Tool 默认聚合，活动摘要显示最后一条非终态操作，完整结果保持第二级按需 disclosure |
| [Run Process Detail Surface v19（历史）](run-process-detail-surface-v19.md) | v18 retry 与执行台边界不变；所有拥有公开 command 的 Shell Activity 使用完整脱敏标题，并在详情分开显示命令与输出 |
| [Run Process Detail Surface v18（历史）](run-process-detail-surface-v18.md) | v17 命令与详情边界不变；运行中的 Claude Code API retry 以安全 attention notice、最新次数与等待状态明显呈现 |
| [Run Process Detail Surface v17（历史）](run-process-detail-surface-v17.md) | v16 Inspector 顺序不变；Codex structured read/list/search 保留中文语义，其余 Shell 行展示完整脱敏命令并在详情分开显示命令与输出 |
| [Run Process Detail Surface v16（历史）](run-process-detail-surface-v16.md) | v15 进入恢复与执行台语义不变；普通 Inspector 改为“队员 / 任务”，右侧改为“执行 / 队员 / 任务” |
| [Run Process Detail Surface v15（历史）](run-process-detail-surface-v15.md) | v14 全局位置偏好与稳定 Drawer 不变；进入带 running Run 的 Camp 时自动打开精确执行，右侧基础 Tab 仍为“任务 / 队员” |
| [Run Process Detail Surface v14（历史）](run-process-detail-surface-v14.md) | v13 稳定 Drawer 与完整 Tool 结果不变；执行台位置改为 Main-owned 本机安装级全局偏好，定义旧偏好默认、提交失败、启动与 Inspector 显隐组合；不含运行中 Camp 进入恢复与首 Tab 顺序 |
| [Run Process Detail Surface v13（历史）](run-process-detail-surface-v13.md) | v12 执行过程与直接停止不变；稳定 DOM 移动、四轨 Tool 行、九类 SVG、精简队员入口与展开后完整结果内部滚动；位置仍是 mounted-workspace 瞬时状态 |
| [Run Process Detail Surface v12（历史）](run-process-detail-surface-v12.md) | v11 执行过程与模型合同不变；AgentRun “停止”单击直接提交，移除确认 Dialog 并保留权威请求状态与恢复 |
| [Run Process Detail Surface v11（历史）](run-process-detail-surface-v11.md) | v10 执行过程合同不变；十 Runtime 的 default-only 首个实际模型观测、write-once 投影与 Run meta 原位展示 |
| [Run Process Detail Surface v10（历史）](run-process-detail-surface-v10.md) | v9 执行过程合同不变；共享 Drawer 的 User-only AgentRun 局部停止、立即写 fence、权威请求状态与 required/optional 后果；不含实际模型观测 |
| [Run Process Detail Surface v9（历史）](run-process-detail-surface-v9.md) | v8 执行过程合同不变；按 origin 显示 Claude Code/Antigravity 安全 failure，覆盖无 Evidence Run 与 Runtime 设置页；不含 Run-local Stop |
| [Run Process Detail Surface v8（历史）](run-process-detail-surface-v8.md) | v7 状态与位置合同不变；完整 Tool chronology、Built-in 公共结果 disclosure、长结果原位复制且无 standalone raw Evidence；不含 Runtime failure 呈现 |
| [Run Process Detail Surface v7（历史）](run-process-detail-surface-v7.md) | v6 执行台位置合同不变；取消 Run 中仍为 running 或明确 cancelled 的活动使用无动画“已停止”展示，不含完整 chronology 与 Built-in 结果收口 |
| [Run Process Detail Surface v6（历史）](run-process-detail-surface-v6.md) | v5 诚实终态投影加默认底部、可移入 Inspector 的唯一执行 console 与容器适配；不含取消 Run 的活动停止投影 |
| [Run Process Detail Surface v5 (historical)](run-process-detail-surface-v5.md) | v4 accepted-input surface 加 planned-shutdown terminal source/reason 与 cancelled unsettled-effect 诚实投影；不含位置切换 |
| [Run Process Detail Surface v4 (historical)](run-process-detail-surface-v4.md) | v3 连续执行过程加 accepted-input“结果待确认”blocker；不含 planned-shutdown terminal source |
| [Run Process Detail Surface v3 (historical)](run-process-detail-surface-v3.md) | Agent 级连续执行过程、任务/队员 Inspector、Approval Dock 与 CampTurn Stop；不含当前 recovery blocker surface |
| [Run Process Detail Surface v2 (historical)](run-process-detail-surface-v2.md) | Agent 级连续执行过程与三 Tab Inspector；不作为当前 Renderer 入口 |
| [Run Process Detail Surface v1 (historical)](run-process-detail-surface-v1.md) | Scheme C 的逐 AgentRun Run Pulse/Drawer 与四 Tab Inspector；不作为当前 Renderer 入口 |
