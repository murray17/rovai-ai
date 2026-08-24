---
document_type: version-overview
version: v1.27
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-08-24
---

# Rovai-ai v1.27：Kimi Code + MiniMax M3 本地 Runtime 接入

> 当前状态：Kimi Code `0.32.0` 已作为第十二种 Product Runtime identity 接入，并在 macOS arm64 上使用
> MiniMax 国内 Token Plan、`MiniMax-M3` 与 OpenAI-compatible endpoint 完成基础 ACP、真实 Approval、
> command-output、Missing-Send、cancel 与进程清理验收。修正 Built-in CLI fixture 的过期退出码断言后，
> 完整资格矩阵通过十五项 operation 并产生 56 条 full-run evidence；macOS arm64 已晋升为 `qualified`。
> Windows x64 随后由独立 Windows 资格证据准入；维护者在 2026-08-24 确认 x86_64 macOS 平台验收完成并
> 明确批准开放。Kimi 当前在 macOS arm64、macOS x64 与 Windows x64 三个 shipped 平台均为 `qualified`。
>
> 同版本另修复首次训练在零可用 Runtime 时的永久阻断：Desktop onboarding schema 升级为 v2，新增
> `runtime_deferred` 无产品副作用终态和对应第三页空结果 UI；正常 Runtime provisioning 与“初次集结”路径
> 保持不变。
>
> 同版本还修复 TRAE CLI CN Bash command 展示：`traecli 0.120.52` 实测使用
> `rawInput.Command`，Core 现在只在 `trae-cn-cli` Adapter 边界公开该非空字符串，并继续排除相邻
> `Description`；其他 ACP Adapter 的大写同形字段保持 fail closed。
>
> Windows x64 证据复核采用逐 Adapter 门禁：Claude Code `2.1.86` 在 Windows 10 x64 以 MiniMax M3 1M 完成
> 当前树 cancellation 目标确认，并复用同版本已冻结的 Built-in、Approval、final boundary、进程树回收与
> packaged planned-shutdown 证据，成为首个 Windows `qualified` Runtime。随后按操作员要求为设置页范围内每种
> Runtime 建立独立两轮 Camp 目标确认；十一种设置页 Runtime 均为 `qualified`，只有范围外 Cursor 保持
> `not_qualified`。同一 packaged 验收还修复 Windows titlebar overlay
> 宽度在 200% zoom 下撑大根 grid 的问题，1040×700 Day/Night 与 200% zoom 均无文档级横向溢出。
>
> 前置版本：[v1.26 Cursor Agent Catalog 接入](../v1.26/README.md)已按冻结时事实转为 historical。

## 版本目标

依据 [Kimi Code Runtime Research](../../research/kimi-code-runtime-research.md)与
[Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)，让 Kimi Code 使用
Rovai 私有、最小权限的 provider 配置运行 MiniMax M3，而不改写用户原有 `~/.kimi` 配置，也不把密钥写入
数据库、仓库、日志或公开 Runtime Evidence。

## 交付范围

- 新增 `AdapterKind = kimi-code-cli`、`SkillDeliveryGroupKey = kimi` 与 Migration 105；Migration 106 扩展
  Compaction policy、Observer 与 Requirement closed kinds，当前 Data Contract 为
  `v1.20 / projection schema 61`；
- 发现 `kimi`，以 `kimi acp` 启动 ACP v1；正式 AgentRun 继承用户原生 Kimi Home，正常完成的兼容 Run 复用
  warm Host/Session，Host 被停止或淘汰后由后继 Host 在同一原生 Home 中精确恢复；显式 Deep Probe 仍使用
  一次性临时 Home；
- 从 `~/.config/rovai/kimi-code.env`（或 `ROVAI_KIMI_CONFIG`）读取严格 allowlist 的六个
  `KIMI_MODEL_*` 字段；Unix 上拒绝 group/other 可访问文件；
- 支持 `default`、`plan`、`auto`、`yolo` 权限模式；新队员 Product default 为原生最高权限 `yolo`，已有
  保存值不自动扩权，Core read-only 强制 `plan`；最高 Runtime 权限不绕过 Rovai 自有安全边界；
- 不强制关闭 Kimi/MiniMax thinking；`KIMI_MODEL_CAPABILITIES=thinking` 只作为能力声明。
  `<think>...</think>` 推理块不进入公开消息，完整闭合块被剥离，未闭合块 fail closed；
- Kimi Skill 投影到 `.kimi-code/skills`；External MCP 通过标准 ACP Session `mcpServers` 以
  `AdditivePerRun / RovaiWins` 启用，stdio、Streamable HTTP 与真实模型 Tool call 已通过；warm Host/Session
  reuse 已启用；Run-local MCP projection/evidence digest 不参与 Host compatibility，完整 Server 定义仍参与。
  Usage/Cost 保持 Disabled。Compaction 通过 Kimi-only Prompt lifecycle correlation 与 idle/detached exact
  completion frame 以 `best_effort` 启用，不安装 Hook 或修改用户配置。capability snapshot 保留真实
  `session.resume/load`，
  Host 停止或淘汰后由新 Host 优先精确 resume，load 只作 replay-quarantined fallback；
- Kimi 在 macOS arm64、macOS x64 与 Windows x64 声明 Built-in transport 并进入普通 discovery、检查、
  成员配置和执行路径；macOS x64 的晋升来自维护者完成平台验收后的明确发布确认，不把 arm64 结论静默外推。
- Windows x64 的设置页十一种 Runtime 使用独立 digest-bound 证据进入普通 discovery、检查、成员配置和
  执行路径；该结论不外推到范围外 Cursor。
- 首次训练扫描结束或失败后没有可直接继续的 Runtime 时，显示统一空结果页；用户可重新扫描，或在尚未
  provisioning 时结束训练并进入普通 App。该终态不创建成员配置、Camp、Run 或 onboarding restore target，
  以后从正常 Settings/成员工作区配置 Runtime。

## 明确边界

- ACP Client `fs/write_text_file` 没有匹配的一次性授权时由 Core 拒绝；写文件验收使用会产生结构化
  permission request 的 Shell 路径；
- `.kimi-code/skills` 的真实发现、唯一 marker 调用和 canonical `--to-principal` 教学通过；Kimi 已进入
  `smoke:skills all`；`--to-user` 仅是隐藏兼容 alias，不是当前 canonical 教学；
- allow 与 deny 均已通过真实 Approval roundtrip；deny 的目标 Tool 为 `not_executed` 且没有文件副作用；
- stdout、stderr、mixed、empty、nonzero 与 large output 六类终态 Tool Evidence 已通过；empty 场景中模型未给
  final 时 AgentRun 正确 fail closed，Tool terminal 仍可审计；
- 早期 Built-in CLI `0/15` 来自 fixture 把 legacy stdin 非法输入退出码错误地期待为 `1`；Kimi 实际执行了
  Shell，并在第一项 canonical operation 前被断言终止。修正为当前 CLI 合同的退出码 `2` 后，十五项
  operation、三种输入、Gather、conflict、lease fence、exact successor read 与 logical/native continuation
  全部通过，Kimi 声明 built-in transport capability 并进入默认矩阵；
- 原始 ACP Probe 中，同 Host 多 Session 无串话；新进程复用同一 `KIMI_CODE_HOME` 的 exact resume/load 保持
  Session ID 和上下文，而新隔离 Home 对旧 ID 返回 `Unknown sessionId`。产品正式 AgentRun 不覆盖
  `HOME` / `KIMI_CODE_HOME`，继承用户原生状态根：正常完成后兼容 Run 复用同一 warm Host/Session；显式停止后
  后继新 Host 精确 resume；load 仅作为带 quarantine 的 fallback。v22 旧私有 Home 不自动迁移或删除；
- 产品级 External MCP smoke 经 Core、Assignment、AgentRun Projection、ContextManifest 与真实模型 Tool call
  同时验证 stdio、Streamable HTTP 和 `RovaiWins` 同名整项优先；未写 Runtime 用户级配置；
- 真实用户原生 Home smoke 定位并修复 Kimi Run-local MCP projection digest 误入 Host compatibility：同一完整
  Server 集合的连续 Run 现在复用同一 Host/Session，Server 定义变化仍通过完整结构改变 compatibility digest；
- Kimi 异步 command/config advertisement 只作为私有 metadata 安全路由。当前产品不消费该 catalog，因此
  不再把“缺少权威 async catalog snapshot”列为遗留问题；
- Kimi `0.32.0` 与官方 `main` 把内部 compact lifecycle 降格为同形 `agent_message_chunk`。Active Prompt 使用
  Kimi-only exact state correlation：started 建立 pending，blocked 保持 pending，completed 产生 observation 并
  清除，cancelled 只清除；这些 frame 不进入 final 或 Missing-Send。PromptCompleted/Ready/detached warm Host
  保留 exact 四行 completion detector；宽泛关键词和 token-drop 不参与。确定性 Host 回归已覆盖
  started→blocked→completed、单次 observation 与公开文本隔离；真实自动/手动完整 Core smoke 尚未执行；
- macOS x64 在维护者确认独立平台验收完成后于 2026-08-24 晋升；Windows x64 使用独立 Windows 资格证据。
  两者都不依赖把 arm64 结果静默外推。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.26 冻结为 historical；本概览、计划、决定和版本索引建立唯一 current v1.27。 |
| Decisions | 已更新 | [V1.27-D04](decisions.md#v1-27-d04)保留 warm Host reuse、External MCP 与 async catalog 边界；[V1.27-D05](decisions.md#v1-27-d05)记录初始 idle ACP completion frame；[V1.27-D06](decisions.md#v1-27-d06)把正式 AgentRun 切回用户原生 Home并保留 Probe 临时隔离；[V1.27-D07](decisions.md#v1-27-d07)补齐 Active Prompt lifecycle correlation；[V1.27-D08](decisions.md#v1-27-d08)允许零可用 Runtime 无副作用结束首次训练；[V1.27-D09](decisions.md#v1-27-d09)记录 Kimi macOS x64 的独立准入晋升。 |
| Contracts | 已更新 | [Runtime Launch and Verification v26](../../contracts/runtime-launch-and-verification-v26.md)继承 v25 的用户原生 Home、Probe 隔离、warm/cold continuation、Kimi External MCP、十二种 Runtime 原生最高权限默认与 Cursor 隐藏边界，并增加 TRAE 专属 `rawInput.Command` 公开白名单；[First-run Onboarding v2](../../contracts/first-run-onboarding-v2.md)增加 schema 2 与 `runtime_deferred`。 |
| User Automation | 已更新 | [User Automation v1](../../contracts/user-automation-v1.md)补齐 `runtime check/models` 与成员 create/runtime set/clear 的封闭 App CLI；所有写入复用既有 Core Domain Command、显式版本 fence 与幂等 command ID，不开放 generic invoke。 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)扩展为十二种 identity，并记录 Kimi 三个 shipped 平台的当前准入；[基础架构不变量](../../architecture/foundational-invariants.md#evidence-canonical-activity)记录 TRAE 专属 command 字段边界；[Native Session Bootstrap Redelivery](../../architecture/native-session-bootstrap-redelivery.md)记录 Kimi completion frame detector；[First-run Onboarding](../../architecture/first-run-onboarding.md)增加 configured/deferred 分支。 |
| UI | 已更新 | Settings 与成员工作区继续展示已接入 Kimi并隐藏 Cursor；Kimi macOS x64 进入普通机器可用性与配置流；首次训练 Runtime 页增加零可用结果面、重新扫描和无副作用“进入 Rovai”。 |
| Runtime Activity | 已更新 | [Mapping Registry](../../runtime-activity/registry.md)加入 Kimi ACP `run_level` baseline 与真实 Shell Evidence，并记录 TRAE `Command + Description` 实测 wire、专属公开白名单与稀疏 terminal 继承。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)记录 `0.32.0`、MiniMax M3、用户原生 Home、Probe 隔离、warm/cold continuation、External MCP、Built-in 15/15、Kimi Compaction detector 与 macOS x64 晋升；另冻结 Windows x64 独立资格 revision。 |
| Documentation routing | 已更新 | 文档导航、合同索引和当前决定导航路由到 Runtime Launch v26、本版本与 Kimi Research。 |
| Root README | 已更新 | 常青能力更新为十二种 Product Runtime identity。 |

## References

- [实施与验收计划](implementation-plan.md)
- [版本决定](decisions.md)
- [Runtime Launch and Verification v26](../../contracts/runtime-launch-and-verification-v26.md)
- [First-run Onboarding v2](../../contracts/first-run-onboarding-v2.md)
- [Kimi Code Runtime Research](../../research/kimi-code-runtime-research.md)
- [Runtime Platform Admission v1](../../contracts/runtime-platform-admission-v1.md)
