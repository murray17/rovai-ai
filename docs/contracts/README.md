---
document_type: contracts-index
authority: protocol-contract-routing
last_updated: 2026-08-21
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
| [Camp Identity v1（当前）](camp-identity-v1.md) | 唯一 `rvcamp_` UUIDv7/Crockford 主键、strict boundary、SQLite/JSON/path 使用与 Native Session identity 分离 |
| [First-run Onboarding v1（当前）](first-run-onboarding-v1.md) | Desktop 首次安装判定、三页持久状态、幂等 provisioning、`初次集结` 与第四页 Draft-only 入口 |
| [Camp Open Projection v6（当前）](camp-open-projection-v6.md) | v5 read/evidence 不变；Message Attachment 增加 Runtime projection state，Renderer 诚实展示 pending/recovery/failed |
| [Camp Open Projection v5（历史）](camp-open-projection-v5.md) | v4 activation-aware enter 与 wire 不变；Camp open 完整返回所有 non-terminal Run Evidence，Renderer live event 不做最后 N 项裁剪 |
| [Camp Open Projection v4（历史）](camp-open-projection-v4.md) | v3 wire/window/模型事实不变；`camps.enter` 对 Pending 直接读投影、对 Active 保持 reconcile-before-read；non-terminal Evidence 仍为最近 80 条 |
| [Camp Open Projection v3（历史）](camp-open-projection-v3.md) | v2 methods/window/取消事实不变；AgentRun 默认策略的首个实际模型观测、Camp Open schema 3 与 Read Model schema 32；`camps.enter` 尚未区分 Pending |
| [Camp Open Projection v2（历史）](camp-open-projection-v2.md) | v1 methods/window 不变；AgentRun 独立取消请求事实、Camp Open schema 2 与 Read Model schema 31；不含 Runtime 模型观测 |
| [Camp Open Projection v1（历史）](camp-open-projection-v1.md) | Desktop `camps.enter/open/exists`、有界首屏投影、coverage/high-water、earlier message page 与 data-minimized trace；不含 AgentRun 取消请求字段 |
| [Camp Conversation Find v1（当前）](camp-conversation-find-v1.md) | Desktop 当前 Camp 公开 user/agent 正文的 exact count、单命中 traversal、Unicode scalar offset 与有界 around-window 定位 |
| [Camp Permanent Deletion v2（当前）](camp-permanent-deletion-v2.md) | v1 删除合同不变；增加 Camp Published Attachment View journal cleanup，并规定先 fence Runtime、再取得 View write gate |
| [Camp Permanent Deletion v1（历史）](camp-permanent-deletion-v1.md) | `camps.delete` force 字段、兼容 blocker、单事务物理删除、Runtime cleanup 与 Renderer 确认边界；不含 Published View cleanup |
| [Benchmark Protocol v3（当前）](benchmark-protocol-v3.md) | 版本化 Run 信封、Product/Environment fingerprint、五层 Evidence、Adapter/derived projection、逐轴比较资格与 disclosure |
| [Semantic Judge Views v1（当前）](semantic-judge-views-v1.md) | Process/Blinded Outcome 双视图、模型可见 evidence allowlist、本地 Evidence ID、双 Replica、逐项 reconciliation 与 Hard Outcome non-interference |
| [Tool Interaction Measurement v2（当前）](tool-interaction-measurement-v2.md) | v1 的 opportunity/Judge 边界加 runtime catalog/projection 兼容门禁、Memory v3/readback、History Search、Task adapter 与 reply/task Process Evidence |
| [Tool Interaction Measurement v1（历史）](tool-interaction-measurement-v1.md) | Opportunity-based Camp/Memory/A2A trace、确定性 oracle/coverage 与独立 Tool-Use Judge 初版边界 |
| [Paired Collaboration Experiment v1（当前）](paired-collaboration-experiment-v1.md) | Team/Solo pre-registration、fresh arms、typed resources 与 outcome-conditioned paired comparison |
| [Runtime Launch and Verification v17（当前）](runtime-launch-and-verification-v17.md) | v16 启动/命令边界不变；完整 Probe identity 前后复核、一次重新绑定、三态 deferred 与 stale LKG/当前 Ready evidence 分离 |
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
| [Runtime Platform Admission v1（当前）](runtime-platform-admission-v1.md) | `AdapterKind × HostPlatformKey` 产品级准入、closed reason/evidence、现有配置保留与 execution blocker |
| [Managed Runtime Process v1（当前）](managed-runtime-process-v1.md) | 统一进程启动 interface、Windows 创建时 Job/handle list、macOS User Automation protected-tree deny、native EXE/validated Node shim 与 descendant cleanup |
| [Runtime Launch and Verification v6（历史）](runtime-launch-and-verification-v6.md) | v5 加 TRAE exact-ID Provider Resume Probe、受控 ACP HistoryRestore、replay quarantine、兼容性 fence 与 continuity-lost fallback；其接受不同 response ID 的语义已由 v7 替代 |
| [Runtime Launch and Verification v5（历史）](runtime-launch-and-verification-v5.md) | v4 加 TRAE 有界启动轻检、用户授权快速 ACP Session Probe 与 Ready commit fence |
| [Runtime Launch and Verification v4（历史）](runtime-launch-and-verification-v4.md) | v3 加 TRAE/Kiro 最高权限队员默认、Kiro trust-all Host 映射与 permission schema digest preserve fence |
| [Runtime Launch and Verification v3（历史）](runtime-launch-and-verification-v3.md) | v2 加 light discovery、显式/首次执行深检、manager-owned attempt、两路并发、generation/fingerprint fence 与统一受限 Probe process owner |
| [Runtime Launch and Verification v2（历史）](runtime-launch-and-verification-v2.md) | v1 的 purpose/static verification 加 ACP Reuse/Resume/New、LoadHistory replay quarantine、Prompt fence、response-only ACK 与 TRAE warm Host |
| [Runtime Launch and Verification v1（历史）](runtime-launch-and-verification-v1.md) | Runtime launch purpose、TRAE 静态 Installation、`installed_unverified`、nullable version 与旧 `session/new|load` 执行路径 |
| [Runtime Usage Monitoring v3（当前）](runtime-usage-monitoring-v3.md) | v2 五表与 Snapshot 不变；补齐 OpenCode 版本感知 Cache Write/零值语义和 Codex 版本化 API 公价估算 |
| [Runtime Usage Monitoring v2（历史）](runtime-usage-monitoring-v2.md) | 五表 clean break、内存 Usage 合并、稀疏 Token/Cache/Cost、Coverage、单 Snapshot 与有界刷新 |
| [Runtime Monitoring v1（历史）](runtime-monitoring-v1.md) | Clean-break collection/enrollment、稀疏 Usage Observation、Native Session fact、三类查询、Coverage、Tool Duration 与 Cost layer |
| [Diagnostics Center v1（当前）](diagnostics-center-v1.md) | `diagnostics.check` typed read model、三态分类、显式单项修复映射、Recovery 与集中脱敏的 `rovai-diagnostics-v5` |
| [User Automation v1（当前）](user-automation-v1.md) | 普通用户 `rovai app` 的独立本机 IPC、Runtime OS 隔离、原子 Camp/Run 自动化、真实 shell exit、双 cursor Diagnostic Trial、安全投影与私有 bundle |
| [Accepted Input Recovery v3（当前）](accepted-input-recovery-v3.md) | v2 outcome-unknown 边界不变；Manifest 21 使用语义 View receipt，并增加 Migration 100 clean break |
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
| [Built-in Tool Transport v19（当前）](builtin-tool-transport-v19.md) | v18 IPC/Output 不变；Send v12 支持纯附件，Run tmp 在每次 lease 前重置并由 Runtime 精确准入 |
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
| [Camp Message Send v12（当前）](camp-message-send-v12.md) | v11 publication/结果不变；body 可选默认空串，正文或至少一个文件即可构成 Send payload |
| [Camp Message Send v11（历史）](camp-message-send-v11.md) | v10 寻址/结果不变；增加 AgentRun-local `files`、真实 accepted IDs 与统一异步附件 publication |
| [Camp Message Send v10（历史）](camp-message-send-v10.md) | v9 语义加显式 Automatic/PublicOnly 寻址意图、parser 前硬门、clean-break event v2 与 closed Send result |
| [Camp Message Send v9（历史）](camp-message-send-v9.md) | v8 精确 Gather capture 加独立每 Item/generation 回传限额与普通 A2A ledger 豁免 |
| [Camp Message Send v8（历史）](camp-message-send-v8.md) | 精确 Gather return capture、混合 recipient 原子性与旧 accepted-A2A 分账 |
| [Camp Message Send v7 (historical)](camp-message-send-v7.md) | v6 canonical freeze 不变；显示名 alias 只在 logical line 的首个非空白 token 寻址，普通 mid-line prose 不唤醒 |
| [Camp Message Send v6 (historical)](camp-message-send-v6.md) | v5 closed input 与投递链不变；新增当前 Camp 有效成员显示名 alias，但允许任意 parseable body position |
| [Camp Message Send v5 (historical)](camp-message-send-v5.md) | v4 Core 效果与 wire 不变；收窄 `mentionUser` / `--to-user` 的消息局部使用边界，但正文不解析显示名 alias |
| [Camp Message Send v4 (historical)](camp-message-send-v4.md) | v3 显式 Agent 寻址/caller return 加初版 `--to-user`、Structured Current User Mention 与原子通知 |
| [Camp Message Send v4 Errata](camp-message-send-v4-errata.md) | 历史 v4 Current User Attention 生命周期与 locator-present exact verification 勘误；其修正已由 v5 继承 |
| [Notification Episode v4（当前）](notification-episode-v4.md) | v3 精确 signal 生命周期加会话可见来源的有界批量确认与即时角标刷新 |
| [Notification Episode v3 (historical)](notification-episode-v3.md) | v2 精确 signal 加 Journal acknowledgement/Clear/remove invalidation、顺序式队列归约与 reset 清空；不含普通会话可见来源确认 |
| [Notification Episode v2 (historical)](notification-episode-v2.md) | v1 三层模型加 Active Attention、exact HeadsUpSignal、事务式 Renderer cursor、pending-first Approval 与 acknowledge-only action；不含 signal 入队后的精确失效合同 |
| [Notification Episode v1 (historical)](notification-episode-v1.md) | 初版 immutable Occurrence、separate Disposition、materialized Episode、minimal Change Journal、bounded write、typed action、heads-up 与 retention |
| [Current User Attention v4（当前）](current-user-attention-v4.md) | v3 逐来源确认加普通进入会话后的精确可见即已读，不要求通知动作或 DOM 焦点 |
| [Current User Attention v3 (historical)](current-user-attention-v3.md) | v2 精确确认加同 CampTurn 一卡、逐 Mention acknowledgement、最早未确认 action 与导航版本绑定；不含普通会话可见即已读 |
| [Current User Attention v2 (historical)](current-user-attention-v2.md) | v1 当前用户注意力加 Message Mention 独立已读、锚点导航、焦点确认与 Markdown 保真；不含 Episode 聚合 |
| [Current User Attention v1 (historical)](current-user-attention-v1.md) | 当前用户身份、结构化内容与原子通知基线；不含独立已读、锚点窗口与 Markdown 保真勘误 |
| [Missing-Send Recovery Publication v1（当前）](missing-send-recovery-publication-v1.md) | 成功 AgentRun 的 typed final candidate、同 Run accepted-send 抑制、recipient-free 原子恢复消息与 terminal replay/竞态语义 |
| [Pending Camp Activation v1（当前）](pending-camp-activation-v1.md) | 一键 Pending 创建、Snapshot/Navigation activation state、首消息原子激活、mutation guard 与窄 discard/启动清理 |
| [Camp Attachment v5（当前）](camp-attachment-v5.md) | v4 ingress/Runtime 不变；Published Authority 的 Desktop open target、Core 风险判定与 Renderer 无路径边界 |
| [Camp Attachment v4（历史）](camp-attachment-v4.md) | v3 publication 不变；Run tmp 逐 lease 隔离，并以共享 per-Camp gate 串行 Authority 权限切换与清理 |
| [Camp Attachment v3（历史）](camp-attachment-v3.md) | v2 shape/limits/Authority 不变；统一 Composer/Agent ingress 与 pending/available/recovery/failed Runtime projection |
| [Camp Attachment v2（历史）](camp-attachment-v2.md) | v1 ingress/限制/digest 不变；Draft 保持 Core-private，Published Attachment 成为 Camp-shared 并只通过 Runtime View 暴露 |
| [Camp Published Attachment View v3（当前）](camp-published-attachment-view-v3.md) | v2 receipt wire 不变；semantic/resolved/catalog 三轴、FIFO worker、failed tombstone 与统一 available Desired set |
| [Camp Published Attachment View v2（历史）](camp-published-attachment-view-v2.md) | v1 root/journal/generation fence 不变；增加稳定 semantic catalog/receipt、可重建物理轴与无全局 DB 锁 copy phase |
| [Camp Published Attachment View v1（历史）](camp-published-attachment-view-v1.md) | 实例/Camp 隔离 root、publication journal、ready catalog、generation、物理 Manifest receipt、quota、rebuild 与安全清理 |
| [Camp Attachment v1（历史）](camp-attachment-v1.md) | 普通文件/目录联合、Core-owned 只读快照、限制、Draft 原子消费、Snapshot 29 与旧 Runtime Authority path |
| [Camp Composer Draft v4（当前）](camp-composer-draft-v4.md) | v3 sendability 不变；语义事务先提交并由持久 writer intent 阻断 Run，View 异步物化 |
| [Camp Composer Draft v3（历史）](camp-composer-draft-v3.md) | v2 reply/continuation 边界不变；ready 附件可以独立构成用户发送 payload，空正文忠实持久化并保留原子消费 |
| [Camp Composer Draft v2（历史）](camp-composer-draft-v2.md) | v1 reply 边界加 durable recipient continuation、source suppression、发送物化、显式修复与无 Default Lead fallback；仍继承正文非空发送要求 |
| [Camp Composer Draft v1 (historical)](camp-composer-draft-v1.md) | Structured Content、附件引用、持久 reply intent、exact revision mutation、显式接收者修复与 Draft-only user send；不含 continuation |
| [Planned Shutdown v2（当前）](planned-shutdown-v2.md) | v1 generation-local reliable terminal 加 durable shutdown cycle、product fence、启动补偿、终态 unknown-effect 保留与 v2 report |
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
| [Gather v3（当前）](gather-v3.md) | v2 lifecycle/limits 不变；Completion Input 使用 `agent_v1` request/captured 投影、projected digest 与 schema v3 |
| [Gather v2（历史）](gather-v2.md) | v1 lifecycle 加当前代最后 captured result、独立回传限额、完整 request 与 completion input v2 |
| [Gather v1（历史）](gather-v1.md) | GatherRecord/Item、Default Lead 接受、持久 capture/Barrier、completion snapshot/FIFO 与旧 capture budget/input v1 |
| [Message Delivery v5（当前）](message-delivery-v5.md) | v4 联合/FIFO 不变；增加无 attempt 的 `projection_blocked` gate、成功释放与失败 settlement |
| [Message Delivery v4（历史）](message-delivery-v4.md) | v3 判别联合加 generation-strict last capture projection 与独立 captured-return allowance |
| [Message Delivery v3（历史）](message-delivery-v3.md) | public/captured/completion 判别联合、Delivery-level completion role 与初版 Gather settlement |
| [Message Delivery v2 (historical)](message-delivery-v2.md) | `forward | return` 冻结边、target lineage、caller continuation，以及 v1 queue/attempt/recovery/settlement |
| [Message Delivery v1 (historical)](message-delivery-v1.md) | 无 caller-return 分类的 recipient queue、dispatch attempt、waitCondition、retry/cancel 与 settlement |
| [Current Input Skill Links v1（当前）](current-input-skill-links-v1.md) | Structured Skill Mention、per-Run send snapshot、start-time resolver 与 optional sibling `CURRENT_INPUT.skills[{name,path}]` |
| [ContextManifest Evidence v21（当前）](context-manifest-evidence-v21.md) | Formatter 21 bytes 不变；View receipt v2 只冻结稳定附件语义；Migration 100 clean break 后由 publication guard 推进到 schema 56/Migration 101 |
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
| [Run Process Detail Surface v19（当前）](run-process-detail-surface-v19.md) | v18 retry 与执行台边界不变；所有拥有公开 command 的 Shell Activity 使用完整脱敏标题，并在详情分开显示命令与输出 |
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
