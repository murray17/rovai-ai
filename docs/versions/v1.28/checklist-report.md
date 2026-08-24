---
document_type: acceptance-record
version: v1.28
authority: version-runtime-integration-acceptance
status: qualified
last_updated: 2026-08-25
---

# v1.28 Grok Build Runtime 接入 Checklist 报告

本报告按 [Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)记录最终结论。
`qualified` 只覆盖下述 Grok 版本、模型、账号方式和平台；不外推到其他版本、账号或平台。

## 基本结论

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
| continuation | compatible warm Host/Session → 未来经验证的 resume → exact `session/load` HistoryRestore → fresh Session | 当前 0.2.118 不广告 `session/resume`；冷恢复复用 TRAE 的 replay quarantine |
| Native Session Bootstrap | Formatter 3 的完整 Bootstrap bytes 作为 Grok `session/new._meta.rules` 一次性追加；所有 Prompt 只发送当轮 Dynamic Context | 只改变 Grok 的投递层级；不使用覆盖式 `systemPromptOverride`，same-host/load 不重复注入 |
| compaction | exact live `auto_compact_completed` → Observer → Requirement → 下一次 eligible input 的 Redelivery v2 | `best_effort` 且 fail closed；不会在当前 Runtime 内部重采样中插入 Prompt |
| Built-in CLI | 当前 Charter/CLI contract；15 个 operation 的真实 Smoke 通过 | 无旧 alias 或旧 fixture 特例 |
| Settings / 平台可见性 | macOS arm64 qualified 后进入 catalog、成员配置与检查；其他平台不展示为 qualified | macOS x64、Windows x64 无证据，不外推 |

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
cargo fmt --all -- --check
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

确定性门禁最终计数：`pnpm test` 通过 76 个 Vitest 文件 / 523 个测试，以及 194 个 Node 测试；
`pnpm test:rust:pr` 通过 library 308、CLI 25、slow 273 个测试；`pnpm test:rust:core` 通过 146 个测试，
另有 4 个明确标记的 manual ignored 测试。`cargo fmt --check`、workspace/all-target Clippy `-D warnings`、
TypeScript typecheck、Desktop build 与文档治理门禁均通过。

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

作为非 Grok 回归观察，本机已升级到 Kimi `0.38.0`；其真实 Bash action 连续返回
`ACP terminal capability is unavailable`，使 accepted-send suppression smoke 无法建立 accepted send。冻结的
Kimi macOS arm64 资格仍绑定 `0.32.0`，generic agent-text 单元与 zero-send 路径通过；本报告不把 `0.38.0`
失败伪写成通过，也不因此改变 Grok `0.2.118` 的 adapter-scoped admission。

## Desktop 包与 AgentRun View 验收

`pnpm package:mac` 已产出 arm64 包 `dist/mac-arm64/Rovai-ai.app`。App、内置 `rovai-core` 与 `rovai` CLI
均通过 `codesign --verify --deep --strict`；Core UUID 为 `4289A8B1-6B16-3E4C-B5A9-FAAD4A52FC20`，CLI UUID
为 `0F90237C-2C3B-324D-9F9E-790CD835094C`，与 staging release 二进制一致。
验收后同一包已替换 `/Applications/Rovai AI.app`，旧包保留为
`/Applications/Rovai AI.app.backup-before-grok-v128-20260825-002302`；替换没有终止正在运行的日常实例，
因此该实例需由用户正常退出并重新打开后才会加载磁盘上的新包。

验收使用独立 `userData` 启动该包，未复用日常 App 数据。包内 App CLI 的 `runtime check` 返回
`grok-build / ready`，模型目录返回默认 `minimax-m3` 与可选 `grok-4.5`；随后创建队员“艾达”（Runtime
验证工程师），绑定 `grok-build`、runtime-default 与 `bypassPermissions`，在快速对话 Camp
`rvcamp_01m0t933s0f10854z1z9e3xktv` 发起真实 AgentRun `9396f7f9-bc49-4618-b914-c015b270aee1`。
该 Run 以 `minimax-m3` 在约 6 秒内 `succeeded`，最终输出 `ROVAI_GROK_AGENTRUN_VIEW_OK`。Desktop
Agent 执行台已实际打开并核对：队员、Grok Build、实际模型、Run/Turn ID、终态、处理时长、原样 thinking
与 final 均可见；这同时确认 MiniMax 文本没有 Kimi/Grok 专属清洗路径。

## 证据与交接

- 资格证据：[macos-arm64-grok-build-v1.json](../../../qualification/runtime-platform/macos-arm64-grok-build-v1.json)，
  digest `sha256:4af780448b73c2e8878cd63b298620ebf46b1e1f2181b7c44a0ab5cac9c28c21`；
- 兼容性总表：[Runtime 兼容性清单](../../runtime-compatibility.md)，digest
  `sha256:1093f682bab77c6d9cbe7d053f63e00d2748a448eecd22d4ce2c89e10c27ff28`；
- Base revision：`c5c745bf19745a2ca20a44f534aedcac843e4725`；
- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-grok-build`；
- Branch：`codex/grok-build-runtime`；通过 PR 交付并合并 `main`。

revision 2 已明确确认并实施，当前没有已知的 Grok Product admission 硬阻断项。剩余功能边界只有：原生
`session/resume` 不受上游支持、Usage/Cost 未启用、account cached-token 仍需在已有真实 Grok 登录的机器上
另行验收。上述边界不阻断本次经 PR 交付 `main`。
