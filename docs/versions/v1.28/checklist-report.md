---
document_type: acceptance-record
version: v1.28
authority: version-runtime-integration-acceptance
status: qualified
last_updated: 2026-08-25
---

# v1.28 Grok Build Runtime 接入 Checklist 报告

本报告按 [Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)记录结论。最初的
`0.2.118 × macOS arm64` qualification 作为历史实证保留；当前支持合同与待补证范围见下方最新修订，不能把
旧版 load-only 结果改写成 `1.0.0` resume 已实测。

## 2026-08-25 `>= 1.0.0` / ACP resume 修订报告

| Checklist 轴 | 当前结论 | 自动化证据 | 仍需客户端补证 |
| --- | --- | --- | --- |
| 最低版本 | 三个宿主平台共用 `grok >= 1.0.0` | semver release gate；`0.2.118` 和 `1.0.0-beta` 拒绝，`1.0.0`/更高接受；macOS arm64/x64 分别实测原生架构 `1.0.5 (5115b46bc909)`，Windows x64 实测 `1.0.5 (5115b46bc9)` | 无：三个目标平台均有独立版本与 fingerprint 证据 |
| Ready / Deep Probe | 必须观察 `initialize.agentCapabilities.sessionCapabilities.resume` 对象并真实 Resume 同一 ID 成功 | 缺少广告或广告但方法拒绝的 fixture 均不能 Ready；macOS arm64/x64 与 Windows x64 1.0.5 均真实完成生产形状 New、空 roots Resume 与 set-model | 无 |
| cold continuation | compatible same-host → exact `session/resume` → 一次 replacement `session/new` | 三个平台均跨 Core/Host 保持 exact ID 和 marker；恢复后 Tool/Approval/cancel、Built-in CLI/attachment 与坏 ID 单次 fallback 通过 | 无 |
| System Prompt | 不变：`session/new._meta.rules = Rovai Bootstrap`；resume 不重新注入 | creation-only rules fixture；Resume 携带 rules 会 fail closed，`None` 才通过；无 `systemPromptOverride`；三平台 cold resume 保留原 Session context | 无 |
| Native Binding fence | `grok-build:resume-v1`；配置/rules generation 变化建新 Session | installation、protocol、fingerprint、Host config、workspace、model、permission、官方 config 与 rules revision 变化均改变 key；三平台相同 key cold resume | 无 |
| load / HistoryRestore | Grok 正常路径停用；其他 Runtime 不变 | Grok 不再把 `loadSession` 映射为产品 capability；TRAE/Kimi 等通用 load fallback 回归保留 | 无 Grok load smoke；当前合同只验证 resume |

`grok 1.0.5` 已在 macOS arm64、macOS x64 与 Windows x64 完成上表真实 Runtime 验收并分别绑定独立
qualification artifact。原 `0.2.118` macOS arm64 v1 artifact 保留为不可变历史证据。

### Windows x64 独立资格

Windows 10 22H2 / build 19045 x64 客户端以 `xai.api_key` BYOK 和独立 Grok executable fingerprint 完成：

- Ready 前真实 `session/new → exact-ID session/resume([]) → session/set_model`；跨 Core/Host 恢复保持 Native
  Session 与私密 marker，0 replay Action/Approval，坏 ID 只产生一次 continuity-lost 后 replacement-new；
- 普通 AgentRun、PowerShell stdout/stderr/mixed/empty/nonzero/bounded-large、allow/deny、运行中 Tool cancel、
  恢复后写入与运行中 Run cancel 均通过；
- Built-in CLI 15 项、Gather captured return、successor lease、历史 attachment、Missing-Send 三路径、
  `.grok/skills` 原生发现与 `AdditivePerRun / NativeWinsSkip` MCP 真实调用通过；
- 隔离 packaged App 在一个 Grok execution active 时发起 planned shutdown。native stop 返回可靠 cancelled
  Runtime terminal，311ms 内自然退出、无 forced signal、七个后代进程回收，重启后终态保持。
- Registry 绑定证据 digest 后移除 Windows 本地资格 override，正式产品路径再次完成 Ready 与同 Native Session、
  同 warm Host 的两轮 AgentRun。

MiniMax BYOK 在验收中出现过空 Tool name 和一次缺少 `prompt_tokens` 的流式 usage chunk；Grok/Rovai 均
fail closed，未增加 provider 专属修复，原命令有界重跑后必须完整通过才计为资格证据。

### Windows Camp 终态显示跟进

安装后的日常 App 使用 Grok 验收员运行 Camp `rvcamp_01m0vyc3hmeq9s8x32hv7pv7kh`。AgentRun
`158b3951-32ae-427b-8c48-8b181d2fd27f` 在 13.4 秒内以 `succeeded` 持久化并保存
`GROK_WINDOWS_BYOK_CAMP_OK`，但 Renderer 保留了发送后取得的非终态快照。原因是 Desktop/Core 已在可靠终态
持久化后发出通用 `agent_run.terminal`，而 Active Camp 的事件 invalidation 列表未消费该通知；验收员记录始终为
`present`、`removedAt = null` 且 Runtime ready，不是卡住原因。

修复将 `agent_run.terminal` 纳入通用 Active Camp invalidation：通知无 `campId` 时对当前 Camp 做一次权威
`camps.open` refresh，明确指向其他 Camp 时不刷新，`runtime_model_observed` 仍要求精确 Camp ID。该逻辑没有
Windows 或 Grok 分支，因此 macOS 与其他 Runtime 同时覆盖；既有 Windows digest-bound qualification artifact
保持字节不变。

后续审查发现初版事件接线仍会让同一 Camp 的连续终态通知并发调用 `camps.open`，且测试只覆盖 invalidation
predicate。最终实现改为 per-Camp single-flight：在途期间的失效合并为 dirty，并在当前读取后执行至多一次
trailing refresh，避免丢失 read transaction 开始后才落库的终态。Renderer 回归同时覆盖通知接收、精确
`camps.open` 请求、`succeeded` 权威投影返回，以及 Camp 页面从“执行中”收敛到“已完成”；burst 回归证明
多个连续 invalidation 只产生一个在途读取和一个 trailing 读取。completion-boundary 回归进一步证明：旧读取
settle 后、coordinator cleanup 前到达的 invalidation 不会加入即将退出的旧 completion，而会启动后继读取。

## 2026-08-24 原始 `0.2.118` 基本结论（历史证据）

```text
Runtime / AdapterKind:         Grok Build / grok-build
Version / model / account:    0.2.118 (1e1687c1cf6a) / MiniMax-M3 / xai.api_key BYOK
Platform / architecture:      macOS 26.3 (25D125) / arm64
Admission:                    qualified
Integration shape:            ACP v1 Product Runtime
Exact launch:                 grok --permission-mode <effective> --no-auto-update agent
                              --no-leader [--plugin-dir <private-root>] stdio
最接近的现有 Adapter:          TRAE（load-only HistoryRestore）；其他 ACP Runtime（generic agent text）
一句话结论:                    基础 Runtime 与声明的 continuation、MCP、Skill、Built-in CLI、
                              Missing-Send、原生 rules 与压缩后 Bootstrap 补发均通过真实产品链路；
                              不把 load 冒充 resume。
```

## 现有行为对齐

| 轴 | 最终行为 | 与现有 Runtime 的差异 |
| --- | --- | --- |
| 正式 AgentRun Home | 继承用户 `HOME` 与原生 Grok Home；模型/provider 由官方 `$GROK_HOME/config.toml` 解析，mode-0600 `.env` 只提供 TOML 引用的密钥环境变量 | Core 不生成/改写官方 TOML，不复用 Kimi/Claude 的变量或原生状态目录 |
| Probe Home | BYOK Probe 复制官方 config/managed/requirements 层并清理临时 `GROK_HOME`，`.env` 不复制；无 BYOK 时保留原生 Home 读取 cached token | Probe 使用相同官方 parser，密钥只经目标进程环境传递 |
| continuation | compatible warm Host/Session → exact `session/resume` → continuity-lost 后一次 fresh Session | 当前 `>= 1.0.0` 不声明或选择 `session.load`；Resume 固定 `additionalDirectories=[]` |
| Native Session Bootstrap | Formatter 3 的完整 Bootstrap bytes 作为 Grok `session/new._meta.rules` 一次性追加；所有 Prompt 只发送当轮 Dynamic Context | 只改变 Grok 的投递层级；不使用覆盖式 `systemPromptOverride`，same-host/resume 不重复注入 |
| compaction | exact live `auto_compact_completed` → Observer → Requirement → 下一次 eligible input 的 Redelivery v2 | `best_effort` 且 fail closed；不会在当前 Runtime 内部重采样中插入 Prompt |
| Built-in CLI | 当前 Charter/CLI contract；15 个 operation 的真实 Smoke 通过 | 无旧 alias 或旧 fixture 特例 |
| Settings / 平台可见性 | macOS arm64/x64、Windows x64 仅在各自 evidence qualified 后进入 catalog、成员配置与检查 | 三个平台不共享证据 digest |

## 用户关注的五项结论

| 问题 | 结论 | 状态与证据 |
| --- | --- | --- |
| 1. 进程 LRU | 支持 | **Verified / Implemented**。Grok 以 `--no-leader` 进入共享 Runtime Fleet；默认每成员 20、全局 200 个驻留进程，idle TTL 30 分钟、60 秒 sweep。真实两轮 Run 保持同一 Host ID 与 Native Session ID，`warmHostReused=true`。 |
| 2. Session resume | 没有原生 resume；有精确冷恢复 | **Unsupported（native resume）/ Verified + Implemented（HistoryRestore）**。0.2.118 只广告 `loadSession`，`session/resume` 为 Method not found。跨 Core/Host 重启用 exact ID `session/load` 恢复同一 Native Session；17 条 replay event 被隔离，错误 ID 只产生一次 continuity-lost 并新建一个 Session。 |
| 3. System prompt 注入 | 原生追加型 `_meta.rules` | **Verified / Implemented / revision 2 confirmed**。Bootstrap 内容、Formatter 3、Evidence payload 均不变；新 Grok Session 把同一份完整 bytes 只追加到 `session/new._meta.rules`，首轮与后继 Prompt 只含 Dynamic Context。same-host 与 exact-ID load 不重注入，replacement new 为新 Binding 注入一次；明确不使用覆盖式 `systemPromptOverride`。结构化 compaction 只驱动下一次输入的 Redelivery，不承担首次注入。 |
| 4. MCP 兼容追加 | 普通使用体验一致；底层通道不同 | **Verified / Implemented**。`session/new.mcpServers` 与 `_meta.pluginDirs` 在 0.2.118 不生效；私有临时 `--plugin-dir` 已通过 `AdditivePerRun / NativeWinsSkip` 实测：不同名 assignment 可正常追加并真实调用，用户在执行台/Tool 行的使用体验与其他 Runtime 一致。边界差异是 Grok 原生同名定义优先并 skip Rovai assignment，且启动前多一次 `inspect`/Plugin Host compatibility 成本。 |
| 5. BYOK 与 account auth 通用性 | 官方 config BYOK 已通过；cached-token 路径已实现但本机未实测 | **Verified（xai.api_key）/ Unverified（cached_token）**。正式配置使用 Grok 官方 `$GROK_HOME/config.toml`；`api_key` 原生字段与 `env_key` 都兼容，`.env` 只是 Rovai 对官方进程环境机制的权限收窄承载。有 BYOK 时优先已广告的 `xai.api_key`；没有 BYOK 时保留原生 Home，并只选安全非交互默认或 `cached_token`。本机没有 Grok cached token，故不能把 account auth 写成 Verified；交互式 `grok.com`/device auth 永不由 Probe 自动启动。 |

## 已启用能力与硬证据

| 能力 | Runtime evidence | Rovai implementation | 结果 |
| --- | --- | --- | --- |
| initialize、Session、可靠 final、两轮 continuation | Verified | Implemented | 通过 |
| Native Bootstrap / system rules | Verified：`_meta.rules` 追加生效且 exact-ID load 保留 | Implemented：`native_append`、Grok-only revision fence、无首轮副本/override | 通过 |
| Compaction / Bootstrap Redelivery | Verified：真实 direct `auto_compact_completed` 带 exact Session/event ID | Implemented：`best_effort` Observer、event-ID 去重、next-input Redelivery/ACK | 通过 |
| 动态模型目录与显式模型 | Verified：8 个模型，标准 `session/set_model` 成功 | Implemented | 通过 |
| Structured Tool / Command Output | Verified：stdout、stderr、mixed、empty、nonzero、bounded-large | Implemented | 通过 |
| Approval allow/deny 与权限收窄 | Verified：批准写入一次，拒绝无副作用；read-only 使用 `plan` | Implemented | 通过 |
| cancel / cleanup | Verified：cancelled 后无文件副作用，Host 受 Fleet 管理 | Implemented | 通过 |
| Warm continuation / cold HistoryRestore | Verified：同 Host 同 Session；重启后 exact ID load | Implemented | 通过 |
| Built-in transport | Verified：15 个当前 canonical operation | Implemented | 通过 |
| Managed Skill | Verified：`.grok/skills` 原生发现 | Implemented | 通过 |
| External MCP | Verified：process Plugin 追加与真实 Tool call | Implemented | 通过；一次 provider/tool-call 瞬态失败，原命令立即重跑通过 |
| Missing-Send | Verified：zero-send、accepted-send suppression、tool→final | Implemented | 通过 |
| Generic agent text | Verified：ACP 普通 chunk 可含 `<think>` | Implemented：Kimi/Grok 与其他 ACP Runtime 一样原样进入执行台 Evidence、final 与 Missing-Send，不做 MiniMax 清洗 | 通过 |

有意关闭或未实现：Usage/Cost 保持 `Disabled`；异步 catalog 产品消费为 `NotImplemented`；native resume 为
`Unsupported`；account cached-token 端到端资格为 `Unverified`。这些状态不削弱已经明确限定的 Product admission。

## 自动化与真实 Smoke

以下命令在本 worktree 执行；确定性门禁和真实 Runtime 验收均以实际退出码与结构化证据判定：

```text
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
pnpm test:rust:pr
pnpm test:rust:core
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm docs:test

ROVAI_ACP_SMOKE_ADAPTER=grok-build \
ROVAI_ACP_USE_PRODUCT_PERMISSION_DEFAULTS=1 \
ROVAI_ACP_PLAIN_TWO_TURN=1 \
ROVAI_ACP_COMMAND_OUTPUT_ONLY=1 pnpm smoke:acp-runtime

pnpm smoke:grok-cold-resume
ROVAI_BUILTIN_CLI_ADAPTERS=grok-build pnpm smoke:builtin-cli
ROVAI_SKILL_SMOKE_ADAPTERS=grok-build pnpm smoke:skills
ROVAI_MCP_PROJECTION_SMOKE_ADAPTERS=grok-build pnpm smoke:mcp-projection
ROVAI_MISSING_SEND_RECOVERY_ADAPTERS=grok-build \
pnpm smoke:missing-send-recovery

ROVAI_ACP_SMOKE_ADAPTER=grok-build \
ROVAI_ACP_PLAIN_TWO_TURN=1 \
ROVAI_ACP_COMMAND_OUTPUT_ONLY=1 \
ROVAI_GROK_COMPACTION_ACCEPTANCE=1 \
ROVAI_GROK_PERMISSION_MODE=bypassPermissions \
node scripts/smoke-acp-runtime.mjs
```

最终分支的确定性门禁计数：`pnpm test` 通过 76 个 Vitest 文件（532 passed）与 198 个 Node 测试；
`pnpm test:rust:pr` 通过 library 321（另 7 ignored）、CLI 27、slow 238 个测试；
`pnpm test:rust:core` 通过 80 个测试，另有 2 个明确标记的 manual ignored 测试。`cargo fmt --all --check`、
workspace/all-target Clippy `-D warnings`、TypeScript typecheck、Desktop build、CI 模式文档治理与 Grok 平台准入
定向测试均通过。

本机 `~/.grok/config.toml` 已迁到官方 `[models]` / `[model.minimax-m3]` shape，密钥文件位于
`~/.grok/.env` 且权限为 `0600`；Core 不读取或回退到旧 `~/.config/rovai/grok-build.env`。官方 `grok models`
识别默认模型，直连 MiniMax 请求返回目标 marker。真实 Rovai Grok AgentRun 保留 provider `<think>`，
同时保持同 Host/Session；cold HistoryRestore、MCP NativeWinsSkip + 不同名真实调用，以及 Grok 的三场景
Missing-Send 均通过。Skill smoke 的断言只验证私有 nonce 存在且不存在其他 marker，不再把原样 thinking
中的重复 nonce 当作产品失败。

revision 2 的真实 Grok compaction 产品验收也已通过：acceptance-only debug arm 只触发目标 Runtime 的真实
completion；当前 Run 不受 metadata 污染，下一轮保持同 Host/Session，Redelivery revision 1 获得 accepted
ACK，Requirement 的 requested/acknowledged revision 均收敛为 1。Migration 108 把 Grok 加入三个 compaction
closed set，Data Contract 为 v1.22/projection schema 63，并通过既有 Kimi observer 状态保留测试。

Grok Built-in v20 的真实 15-operation Run、历史公开 A2A、recipient Run、Gather completion、successor exact
read 与同 Native Session continuation 通过。一次最小 command-output 回路捕获 Grok/MiniMax-M3 产生空工具名；
原始 Runtime action 已是 `toolCallId="" / toolName=null / Tool not found`，Rovai 未清洗或重写。相同回路与
完整 Built-in 原命令随后通过，因此按 provider 瞬态记录，不增加 MiniMax 专属兼容层。

合并最新 `main` 后同时保留其 Kimi `0.38.0` 标准 ACP Client Terminal `LocalBridged` 实现，并删除
Kimi 专属 `agent_message_chunk` 抑制。当前版本真实 Missing-Send 三场景再次通过：zero-send publication、
accepted-send suppression 与 tool→final（6 条 ACP Tool event）；这证明 Terminal 桥与 Kimi/Grok generic
agent-text 原样投影可以同时成立，不需要 MiniMax 专属清洗或解析。

## Desktop 包与 AgentRun View 验收

`pnpm package:mac` 已产出 v0.0.2 arm64 包 `dist/mac-arm64/Rovai AI.app`。App、内置 `rovai-core` 与
`rovai` CLI 均通过 `codesign --verify --deep --strict`；最终合并包 Core UUID 为
`B20EF850-64A4-35CB-B37D-92EAD6DF7B2C`，CLI UUID 为 `E4D67B75-8034-3291-A144-94C077EC4550`，
与 staging release 二进制一致。
验收后同一包已替换 `/Applications/Rovai AI.app`，旧包保留为
`/Applications/Rovai AI.app.backup-before-grok-v128-v002-20260825-010127`，接入前原包另保留在
`/Applications/Rovai AI.app.backup-before-grok-v128-20260825-002302`。替换没有终止正在运行的日常实例，
因此当前实例需由用户正常退出并重新打开后才会加载磁盘上的 v0.0.2 最终合并包。

验收使用独立 `userData` 启动该包，未复用日常 App 数据。包内 App CLI 的 `runtime check` 返回
`grok-build / ready`，模型目录返回默认 `minimax-m3` 与可选 `grok-4.5`；随后创建队员“艾达”（Runtime
验证工程师），绑定 `grok-build`、runtime-default 与 `bypassPermissions`，在快速对话 Camp
`rvcamp_01m0t933s0f10854z1z9e3xktv` 发起真实 AgentRun `9396f7f9-bc49-4618-b914-c015b270aee1`。
该 Run 以 `minimax-m3` 在约 6 秒内 `succeeded`，最终输出 `ROVAI_GROK_AGENTRUN_VIEW_OK`。Desktop
Agent 执行台已实际打开并核对：队员、Grok Build、实际模型、Run/Turn ID、终态、处理时长、原样 thinking
与 final 均可见；这同时确认 MiniMax 文本没有 Kimi/Grok 专属清洗路径。

macOS x64 客户端另以原生 x86_64 `grok 1.0.5 (5115b46bc909)` 和最新 `main` 构建
`dist/mac/Rovai AI.app`。App、Core 与包内 `rovai` CLI 均为 x86_64 并通过 ad-hoc `codesign --deep --strict`；
隔离 App 的包内 CLI 自动创建成员“戈洛克-x64”、绑定 `grok-build` runtime-default 与
`bypassPermissions`，随后发起真实 AgentRun。该 Run 对 `/bin/bash`、`/bin/sh`、`/bin/cat` 形成三个不同的
非空 Tool ID，每个都从 `in_progress` 收敛到 `completed`，最终 View 为 `succeeded`、实际模型为
`minimax-m3`，三个 marker 均进入 final。App 自身终止请求随后完成 `core.shutdown` protocol v2：无 deadline
过期、无 forced signal，App/Core/Grok/Helper 进程与 automation socket 全部退出。

x64 cold-resume 原命令第一次在进入 Resume 前遇到 MiniMax-M3 空 Tool 名瞬态；原始 Runtime 事件为
`toolName=null / Tool not found`，Rovai 未补写或改名。同一未修改命令立即重跑后，exact-ID resume、marker、
恢复后 Tool/Approval/cancel 与坏 ID 单次 fallback 全部通过，因此该失败按上游瞬态保留，不增加 provider 特例。

## 证据与交接

- 当前资格证据：[macos-arm64-grok-build-v2.json](../../../qualification/runtime-platform/macos-arm64-grok-build-v2.json)，
  digest `sha256:6a2a96944ca7021f6e4c9c7289cdacde0e2077736a8e8af6bd247ce929e92b1e`；历史 v1 artifact 保持不可变；
- Windows x64 资格证据：[windows-x64-grok-build-v1.json](../../../qualification/runtime-platform/windows-x64-grok-build-v1.json)，
  digest `sha256:66f80ed14dc6c2903f86af29f8209c6bee6aa72340f09a8b2b52da335242c66b`；
- macOS x64 资格证据：[macos-x64-grok-build-v1.json](../../../qualification/runtime-platform/macos-x64-grok-build-v1.json)，
  digest `sha256:6ce70fc844ef6f18327e5a23396072566fd907c972f273aeccfd987c87398879`；
- 兼容性总表：[Runtime 兼容性清单](../../runtime-compatibility.md)，digest
  `sha256:d0573aeaa59648975e10a4ded0d3643809fae161bc085180cd36d5ca4b59e5a8`；
- v2 implementation base revision：`8f0aad1b989ed7eccb695c131da964f6a6ac4d77`；
- macOS x64 implementation base revision：`61a99977ad590c6e8a8f5c4f99b36d4dc0682801`；
- Windows x64 implementation base revision：`61a99977ad590c6e8a8f5c4f99b36d4dc0682801`；
- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-grok-1-0-resume`；
- Branch：`rovai/grok-1-0-resume`；由 PR #50 交付。

revision 2 已明确确认并实施。以上 `0.2.118` load-only 结论已由当前 `>= 1.0.0 / session.resume` 合同取代，
但它仍是 Plugin MCP、rules、compaction、BYOK 与 macOS arm64 原始平台资格的历史证据。Usage/Cost 未启用，
account cached-token 仍需独立验收。
