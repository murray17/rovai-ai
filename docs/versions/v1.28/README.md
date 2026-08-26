---
document_type: version-overview
version: v1.28
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-08-26
---

# Rovai-ai v1.28：Grok Build + MiniMax M3 本地 Runtime 接入

> 当前状态：`grok-build` Product Runtime、Data Contract 迁移、官方 provider config、ACP Host、Renderer
> catalog 和 macOS arm64/x64、Windows x64 平台资格已按完整 Runtime checklist 分别验收通过。进程级
> `--plugin-dir` 已建立
> `AdditivePerRun / NativeWinsSkip` External MCP。当前 Grok 支持基线统一为 `>= 1.0.0`，Ready 要求正式广告并
> 真实成功调用 ACP `session/resume`，cold continuation 不再保留 `0.2.118` 的 load-only fallback。已确认的模型上下文
> revision 2 保持 Bootstrap bytes
> 不变，把 Grok 首次交付改为原生 `_meta.rules`，并以结构化 completion 驱动 Redelivery v2。实现经
> 独立 worktree 验收后通过 PR 交付 `main`；`>= 1.0.0 / session.resume` clean break 的确定性实现已完成，
> macOS arm64/x64 与 Windows x64 已分别用 `grok 1.0.5` 完成真实 Deep Probe、cold resume 与产品矩阵。
> 新产生的 Codex command output delta 已改为 Host stdout ingress route 分类后直接丢弃，不进入 Core 无界队列；Command terminal aggregate 保持唯一输出权威，
> 历史 Evidence/Blob 不迁移。全部 13 个 Adapter 的 terminal output 路径已逐项核验，无 Adapter 需要新增 spool。

前置版本：[v1.27 Kimi Code + MiniMax M3](../v1.27/README.md)已按冻结时事实转为 historical。

## 版本目标

依据 [Grok Build Runtime Research](../../research/grok-build-runtime-research.md)与
[Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)，把 xAI Grok Build 作为独立
Product Runtime 接入。复用本机 MiniMax API Key，但改用 Grok 官方 custom-model 配置 schema 和原生 Home
内的权限收窄密钥环境源；不复用 Kimi/Claude 的 Runtime identity、变量或原生状态目录。

## 交付范围

- 新增 `AdapterKind = grok-build`、`SkillDeliveryGroupKey = grok` 与 Migration 107；Migration 108 扩展 Grok
  compaction closed sets。当前 Data Contract 升级为 `v1.22 / projection schema 63`，既有 Runtime、成员、
  Skill assignment、detector policy、requirement、observer lease 与 observation 必须无损保留；
- 发现 `grok`，以 `grok --permission-mode <effective> --no-auto-update agent --no-leader [--plugin-dir
  <private-root>] stdio` 启动 ACP v1；BYOK overlay 存在时选择 `xai.api_key`，否则只选择 Runtime 广告的安全
  非交互默认或 `cached_token`，从不由 Probe 启动浏览器/设备登录；
- 正式 AgentRun 继承用户原生 Grok Home 和官方 `$GROK_HOME/config.toml`；BYOK Probe 把官方配置层复制到
  临时 `GROK_HOME`，account-auth Probe 为读取既有 cached token 保留原生 Home。当前机器没有 cached token，
  因此 account-auth 产品路径已实现但未做真实登录验收；
- 模型/provider 直接使用官方 `[models]`、`[model.<id>]`、`[model_providers.<id>]`。mode `0600` 的
  `$GROK_HOME/.env` 只向目标子进程提供 TOML `env_key` / `env_http_headers` 明确引用的变量；官方
  `api_key` 同样兼容，不再存在 Rovai `GROK_MODEL_*` 三字段翻译；
- 模型目录来自真实 ACP Session，显式模型使用已实测的标准 `session/set_model`，不声明不存在的
  `session/set_config_option`；权限支持 Grok 原生 `default`、`acceptEdits`、`auto`、`dontAsk`、
  `bypassPermissions`、`plan`，Product default 为 `bypassPermissions`，Core read-only 强制 `plan`；
- Kimi/Grok 对 MiniMax 作为普通 ACP `agent_message_chunk` 返回的 `<think>` 或其他文本不做专用清洗、
  重分类或抑制；内容原样进入执行台 Evidence、terminal final 与 Missing-Send candidate；
- 完成 Fleet LRU warm Host/同 Session 复用；三个宿主平台共享 `grok >= 1.0.0` 版本门，Deep Probe 与 Ready
  必须观察 `sessionCapabilities.resume` 并对刚创建的 exact ID 成功调用。新 Host 用 exact `session/resume`，
  其 `additionalDirectories=[]`；不声明或选择 Grok `session.load`；
  失败只记录一次 continuity-lost 后新建 Session；其他 Runtime 的通用 load fallback 不变；
- Native Session Bootstrap 的三个 section、顺序和 bytes 不变；新 Grok Session 只在
  `session/new._meta.rules` 原生追加一次，首轮及后继 user payload 均只含 Dynamic Context，不使用覆盖式
  `systemPromptOverride`，same-host/resume 不重复注入；
- `best_effort` detector 只接受无 request ID 的 `_x.ai/session_notification`、exact Session ID、
  `auto_compact_completed` 与非空 event ID。合格完成只推进 durable revision，下一次 Core-controlled input
  使用既有 Redelivery Envelope v2；真实强制压缩两轮产品 smoke 已通过 revision 1 accepted ACK；
- Grok Skill 投影到 `.grok/skills` 并完成原生发现实测；External MCP 使用私有临时 Plugin 的进程级
  `--plugin-dir`，保留原生定义、同名 `NativeWinsSkip`、不同名逐 Run 追加并随 Host 清理；Usage/Cost 保持
  Disabled，直到字段语义独立验证；
- macOS arm64、macOS x64 与 Windows x64 只在各自冻结的 adapter-scoped 证据通过后进入普通 discovery、
  检查、成员配置与执行路径；三个宿主平台不互相外推 evidence digest。
- Windows x64 BYOK Camp 验收发现 Renderer 未消费 Core 已持久化后的通用 `agent_run.terminal` 通知；通用
  Camp invalidation 已补齐为 single-flight + trailing refresh，并以事件 → `camps.open` → `succeeded` 页面投影的
  平台无关链路回归覆盖，macOS/Windows 及所有 Runtime 共用同一终态收敛路径。
- Windows Runtime Search 每次 rescan 重新 hydration HKCU/HKLM PATH，并固定 `.exe → .cmd → .bat` closed set；
  已知 npm/pnpm Codex shim 解析到真实 `codex.exe`，其他 bounded command shim 以独立 identity 经受控 System32
  `cmd.exe`、原子 Job 与 batch argv serializer 启动；resolved shim locator identity 内部持久化并参与 snapshot、
  Installation generation 与 Host fencing，`.ps1` 继续不支持。
- 修复 macOS Runtime Files 持久身份误用 boot-local `st_dev` 的启动回归；marker schema 2 改用稳定卷 UUID，
  schema 1 只在确定性私有实例根内 rekey，并由 SQLite/Authority reconciliation 受控重建旧物理 View receipt。
- 放松已成功发布附件的后置完整性门禁：缺失或 digest/size/tree 不一致只把该附件降级为
  `recovery_required` 并从新 Runtime Context 省略，Camp、健康附件、公共历史与审计继续可用；exact Authority
  恢复后自动重建。
- Camp 执行台把同一 Run 内最大连续的 Tool 派生为默认收起的摘要，运行中只显示最后一条非终态操作，
  不同时追加累计数；展开后
  保留完整 chronology，并把完整 Tool 结果延迟到精确 Tool 首次展开；分组不改变 Core Evidence、Tool identity
  或 non-terminal open projection。running Run 的尾组在 Tool 间隙继续显示最近一条具体指令，直到真实
  process/Run 边界才收口；组图标与摘要文字共享 16px 中心线，避免累计数/下一指令往返、额外 Loading 和
  可见上下错位。
- Codex `command.output.delta` 对未来数据采用 transport-only clean break：Host stdout ingress 在处理 JSON-RPC response
  后识别无 `id` notification，按当前 Thread/Turn route 把精确与 stale/malformed/legacy delta 分类并全部丢弃，
  不构造 `CodexIncoming`、不进入 Core 无界队列，也不写 Evidence/Canonical/Blob 或 Renderer live state；带 `id`
  的同名 request 保留既有 response 路径，下游漏网 guard 早于 batching、Runtime lookup 与数据库读取；
  terminal `aggregatedOutput` 继续作为 Command 输出唯一权威并沿用大正文 Managed Blob 阈值。十个 ACP Adapter、
  Claude Code 与 Antigravity 已在各自 terminal semantic event 中给出完整公开输出，不需要临时 spool。
- Runtime 明确报告 interruption 时，尚未结算的 Activity 记录为 terminal/unsettled，reason code 为
  `runtime_interrupted`；Renderer 显示 stopped/interrupted。只有 Runtime 权威取消终态才写成 cancelled。
- Desktop 正式包在首个窗口加载 5 秒后、每轮完成 6 小时后主动检查稳定版本，但不自动下载、安装或重启。
  Main 以独立 release/prompt 事实、来源合并和精确代次 dismiss 驱动右下角轻量提醒、设置徽标与 About 全状态页；
  显式下载互斥，显式安装采用 updater-first + Planned Shutdown，失败保留 App/Core 与上次有效版本信息。

## 安全与兼容边界

- API Key 不进入仓库、数据库、CLI 参数、日志、diagnostics、qualification artifact 或公开 Evidence；
- Core 不写 `$GROK_HOME/config.toml` / `.env`，正式 AgentRun 不覆盖 `HOME` / `GROK_HOME`，也不向用户目录安装 Hook 或
  Plugin；逐 Run MCP Plugin 只存在于 Core 私有 Runtime 目录并由 RAII/Host cleanup 删除；
- `_x.ai/*` vendor notification 只按已知 Session metadata/lifecycle 路由，不作为公开 assistant 输出；
- 原生 Session ID 仅保留在既有绑定边界，资格证据不持久化完整 Native ID；
- Cursor 与 Kimi 的平台准入、provider 和 continuation 结论不因新增 Grok identity 改变。
- 本次只改变未来新产生的 command output transport；不迁移、删除、重写任何历史 Evidence 或 Blob，也不重建
  canonical history。PR #63 的 Tool identity、chronology、Renderer-only 连续分组与精确 Tool Blob 惰性读取不变。

## 验收

验收状态由 [实施计划](implementation-plan.md)维护。逐项结论见[接入 Checklist 报告](checklist-report.md)。
交接前至少完成：静态检查、Rust/Renderer 定向测试、
Migration 保留验证、真实 Deep Probe、两轮 AgentRun、命令与权限、cancel、Missing-Send、Built-in CLI、Skill、
External MCP 支持性裁决、文档治理与 Impeccable UI detector。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)与[版本索引](../README.md)共同切换 `current_version`。 |
| Decisions | 已更新 | [V1.28-D01](decisions.md#v1-28-d01)冻结 provider/Home/auth 边界，[V1.28-D02](decisions.md#v1-28-d02)冻结公开输出与平台准入，[V1.28-D03](decisions.md#v1-28-d03)冻结 External MCP 的 Plugin 追加边界，[V1.28-D04](decisions.md#v1-28-d04)保存初始 load-only 取舍，[V1.28-D05](decisions.md#v1-28-d05)冻结 native rules 与 structured compaction redelivery，[V1.28-D06](decisions.md#v1-28-d06)冻结 `>= 1.0.0` 与标准 ACP resume clean break，[V1.28-D07](decisions.md#v1-28-d07)冻结 macOS Runtime Files 稳定卷 identity 与旧 marker rekey，[V1.28-D08](decisions.md#v1-28-d08)冻结 startup rebuild failure 的 Camp-local fail-closed 边界，[V1.28-D09](decisions.md#v1-28-d09)冻结空集 controlled rebuild 的 completion 与 root receipt，[V1.28-D10](decisions.md#v1-28-d10)冻结已成功发布附件的当前可读性局部降级与 Camp 继续运行，[V1.28-D11](decisions.md#v1-28-d11)冻结 Windows PATH hydration、`.exe/.cmd/.bat` entrypoint 与 command-shim identity，[V1.28-D12](decisions.md#v1-28-d12)冻结 command output delta 的 transport-only clean break、terminal aggregate 权威与 interrupted 语义，[V1.28-D13](decisions.md#v1-28-d13)冻结主动检查、用户确认副作用、Main-owned release/prompt 与 updater-first 退出。 |
| Contracts | 已更新 | [Runtime Launch and Verification v27](../../contracts/runtime-launch-and-verification-v27.md)收敛 Grok 版本门、Ready 与 continuation；[Camp Published Attachment View v4](../../contracts/camp-published-attachment-view-v4.md)区分不可变发布历史与当前 Runtime availability，并定义附件局部降级、Context 省略和自动恢复；[Run Process Detail Surface v23](../../contracts/run-process-detail-surface-v23.md)继承 Renderer-only 连续 Tool 聚合、摘要归约和第二级结果惰性 disclosure，并让 running 尾组间隙持续显示最近一条具体指令；[Managed Runtime Process v1](../../contracts/managed-runtime-process-v1.md)补充受控 Windows `.cmd/.bat` identity、argv 与 Job 边界；[App Update v1](../../contracts/app-update-v1.md)冻结主动/手动检查、release/prompt 分轴、显式下载/安装、状态/fallback 与受控退出；[Runtime Platform Admission](../../contracts/runtime-platform-admission-v1.md)的逐平台证据边界不变。receipt wire 与 Data Contract 不变。 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)补充 Grok identity、provider 与原生状态边界；[Native Session Bootstrap Redelivery](../../architecture/native-session-bootstrap-redelivery.md)补充 Grok detector；[Camp Published Attachment View](../../architecture/camp-published-attachment-view.md)补充稳定卷 identity、schema-1 rekey、空集受控重建、附件局部可用性与 pre-dispatch repair；[Camp Open Read Path](../../architecture/camp-open-read-path.md)明确可靠 `agent_run.terminal` 后的权威投影刷新；[基础不变量](../../architecture/foundational-invariants.md#evidence-canonical-activity)补充 transient delta、terminal aggregate 与 interruption 边界；[Desktop App Updates](../../architecture/desktop-app-updates.md)与 [Planned Shutdown](../../architecture/planned-shutdown.md)定义 updater、Main、Preload、Renderer 和退出顺序。 |
| UI | 已更新 | 复用现有 Runtime catalog、状态与成员参数组件；member-workspace brief 明确 generic agent text 可原样进入执行台与 final；Renderer 补齐通用 AgentRun 终态 invalidation、single-flight/trailing refresh 与完整页面链路回归，避免 Camp 保留运行中旧快照或因连续终态通知并发读取；Camp 会话工作区增加连续 Tool 摘要和完整结果按精确 Tool 惰性挂载，当前操作与 running 尾组间隙都只显示具体指令、不重复累计数，尾组保持活动摘要直至真实边界，终态摘要不追加结果文字，组内有成功即使用绿色状态、仅全部失败使用红色，组图标与摘要文字共用 16px 中心线，并排除新 command output delta 的 live-state 累积；设置工作区增加右下角轻量更新提醒、独立状态徽标、About 全状态矩阵、安全更新日志和 last-section-preserving 深链。 |
| Runtime Activity | 已更新 | [Registry](../../runtime-activity/registry.md)新增 Grok ACP run-level 映射，并记录全部 13 个 Adapter 的 terminal output authority 与无需 spool 的核验结论。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)与 macOS arm64/x64、Windows x64 三份 adapter-scoped 证据记录各自实测边界。 |
| Documentation routing | 已更新 | Architecture、Contracts、Current Decisions、App Shell、packaging 与 UI acceptance 索引均可到达 App Update v1 当前权威。 |
| Root README | 确认无需更新 | 本次兼容 Runtime 与桌面更新交互都不改变项目定位或常青产品承诺。 |
