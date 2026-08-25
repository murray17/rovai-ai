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
| 最低版本 | 三个宿主平台共用 `grok >= 1.0.0` | semver release gate；`0.2.118` 和 `1.0.0-beta` 拒绝，`1.0.0`/更高接受；macOS arm64 实测 `1.0.5 (5115b46bc909)` | macOS x64、Windows x64 记录实际版本与 fingerprint |
| Ready / Deep Probe | 必须观察 `initialize.agentCapabilities.sessionCapabilities.resume` 对象并真实 Resume 同一 ID 成功 | 缺少广告或广告但方法拒绝的 fixture 均不能 Ready；macOS arm64 1.0.5 真实完成生产形状 New、空 roots Resume 与 set-model | macOS x64、Windows x64 各跑真实 initialize/auth/session-new/resume |
| cold continuation | compatible same-host → exact `session/resume` → 一次 replacement `session/new` | macOS arm64 1.0.5 跨 Core/Host 保持 exact ID 和 marker；恢复后 Tool/Approval/cancel、Built-in CLI/attachment 与坏 ID 单次 fallback 通过 | macOS x64、Windows x64 重复同一矩阵 |
| System Prompt | 不变：`session/new._meta.rules = Rovai Bootstrap`；resume 不重新注入 | creation-only rules fixture；Resume 携带 rules 会 fail closed，`None` 才通过；无 `systemPromptOverride` | 真实 resume 后冲突 prompt 继续服从原 Session rules |
| Native Binding fence | `grok-build:resume-v1`；配置/rules generation 变化建新 Session | installation、protocol、fingerprint、Host config、workspace、model、permission、官方 config 与 rules revision 变化均改变 key | 客户端确认相同 key cold resume、变化后 new |
| load / HistoryRestore | Grok 正常路径停用；其他 Runtime 不变 | Grok 不再把 `loadSession` 映射为产品 capability；TRAE/Kimi 等通用 load fallback 回归保留 | 无 Grok load smoke；只需验证 resume |

本次开发机已升级为 `grok 1.0.5 (5115b46bc909)`，macOS arm64 已完成上表真实 Runtime 验收并更新为 v2
qualification artifact。原 `0.2.118` v1 artifact 保留为不可变历史证据；macOS x64、Windows x64 仍为
`not_qualified`，待对应客户端完成同一矩阵后再更新。

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

确定性门禁最终计数：`pnpm test` 通过 76 个 Vitest 文件 / 525 个测试，以及 198 个 Node 测试；
`pnpm test:rust:pr` 通过 library 310、CLI 25、slow 273 个测试；`pnpm test:rust:core` 通过 156 个测试，
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

## 证据与交接

- 当前资格证据：[macos-arm64-grok-build-v2.json](../../../qualification/runtime-platform/macos-arm64-grok-build-v2.json)，
  digest `sha256:6a2a96944ca7021f6e4c9c7289cdacde0e2077736a8e8af6bd247ce929e92b1e`；历史 v1 artifact 保持不可变；
- 兼容性总表：[Runtime 兼容性清单](../../runtime-compatibility.md)，digest
  `sha256:5d82ad48e6155ca6c4b90aaccc2a7d5c92eac7232c56c4ff8b2a4a6b4e03fed0`；
- v2 implementation base revision：`8f0aad1b989ed7eccb695c131da964f6a6ac4d77`；
- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-grok-1-0-resume`；
- Branch：`rovai/grok-1-0-resume`；由 PR #50 交付。

revision 2 已明确确认并实施。以上 `0.2.118` load-only 结论已由当前 `>= 1.0.0 / session.resume` 合同取代，
但它仍是 Plugin MCP、rules、compaction、BYOK 与 macOS arm64 原始平台资格的历史证据。Usage/Cost 未启用，
account cached-token、macOS x64 与 Windows x64 的 `>= 1.0.0` 真实 continuation 仍需分别验收。
