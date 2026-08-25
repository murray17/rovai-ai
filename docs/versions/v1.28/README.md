---
document_type: version-overview
version: v1.28
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-08-25
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
- 修复 macOS Runtime Files 持久身份误用 boot-local `st_dev` 的启动回归；marker schema 2 改用稳定卷 UUID，
  schema 1 只在确定性私有实例根内 rekey，并由 SQLite/Authority reconciliation 受控重建旧物理 View receipt。

## 安全与兼容边界

- API Key 不进入仓库、数据库、CLI 参数、日志、diagnostics、qualification artifact 或公开 Evidence；
- Core 不写 `$GROK_HOME/config.toml` / `.env`，正式 AgentRun 不覆盖 `HOME` / `GROK_HOME`，也不向用户目录安装 Hook 或
  Plugin；逐 Run MCP Plugin 只存在于 Core 私有 Runtime 目录并由 RAII/Host cleanup 删除；
- `_x.ai/*` vendor notification 只按已知 Session metadata/lifecycle 路由，不作为公开 assistant 输出；
- 原生 Session ID 仅保留在既有绑定边界，资格证据不持久化完整 Native ID；
- Cursor 与 Kimi 的平台准入、provider 和 continuation 结论不因新增 Grok identity 改变。

## 验收

验收状态由 [实施计划](implementation-plan.md)维护。逐项结论见[接入 Checklist 报告](checklist-report.md)。
交接前至少完成：静态检查、Rust/Renderer 定向测试、
Migration 保留验证、真实 Deep Probe、两轮 AgentRun、命令与权限、cancel、Missing-Send、Built-in CLI、Skill、
External MCP 支持性裁决、文档治理与 Impeccable UI detector。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)与[版本索引](../README.md)共同切换 `current_version`。 |
| Decisions | 已更新 | [V1.28-D01](decisions.md#v1-28-d01)冻结 provider/Home/auth 边界，[V1.28-D02](decisions.md#v1-28-d02)冻结公开输出与平台准入，[V1.28-D03](decisions.md#v1-28-d03)冻结 External MCP 的 Plugin 追加边界，[V1.28-D04](decisions.md#v1-28-d04)保存初始 load-only 取舍，[V1.28-D05](decisions.md#v1-28-d05)冻结 native rules 与 structured compaction redelivery，[V1.28-D06](decisions.md#v1-28-d06)冻结 `>= 1.0.0` 与标准 ACP resume clean break，[V1.28-D07](decisions.md#v1-28-d07)冻结 macOS Runtime Files 稳定卷 identity 与旧 marker rekey，[V1.28-D08](decisions.md#v1-28-d08)冻结 startup rebuild failure 的 Camp-local fail-closed 边界，[V1.28-D09](decisions.md#v1-28-d09)冻结空集 controlled rebuild 的 completion 与 root receipt。 |
| Contracts | 已更新 | [Runtime Launch and Verification v27](../../contracts/runtime-launch-and-verification-v27.md)收敛 Grok 版本门、Ready 与 continuation；[Runtime Platform Admission](../../contracts/runtime-platform-admission-v1.md)的逐平台证据边界不变。Runtime Files identity 与 Camp-local startup 隔离修复都不改变 View contract、receipt wire、错误 closed set 或 Data Contract，因此无需新建 Camp Published Attachment View contract。 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)补充 Grok identity、provider 与原生状态边界；[Native Session Bootstrap Redelivery](../../architecture/native-session-bootstrap-redelivery.md)补充 Grok detector；[Camp Published Attachment View](../../architecture/camp-published-attachment-view.md)补充稳定卷 identity、schema-1 rekey、空集受控重建与 Camp-local fail-closed startup 隔离；[Camp Open Read Path](../../architecture/camp-open-read-path.md)明确可靠 `agent_run.terminal` 后的权威投影刷新。 |
| UI | 已更新 | 复用现有 Runtime catalog、状态与成员参数组件；member-workspace brief 明确 generic agent text 可原样进入执行台与 final；Renderer 补齐通用 AgentRun 终态 invalidation、single-flight/trailing refresh 与完整页面链路回归，避免 Camp 保留运行中旧快照或因连续终态通知并发读取。 |
| Runtime Activity | 已更新 | [Registry](../../runtime-activity/registry.md)新增 Grok ACP run-level 映射。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)与 macOS arm64/x64、Windows x64 三份 adapter-scoped 证据记录各自实测边界。 |
| Documentation routing | 确认无需更新 | 既有 Runtime checklist、Research、Architecture、Contract 与 Version 路由足以到达本版本。 |
| Root README | 确认无需更新 | 本次新增兼容 Runtime，不改变项目定位或常青产品承诺。 |
