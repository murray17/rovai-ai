---
document_type: runtime-research
runtime: pi
upstream: earendil-works/pi
authority: research-evidence-only
status: implemented
admission: macos_arm64_qualified
last_updated: 2026-08-25
---

# Pi Runtime 接入研究

> 本文按 [`runtime-integration-checklist.md`](https://github.com/murray17/rovai-ai/blob/main/docs/development/runtime-integration-checklist.md) 整理。
> Pi 不是 ACP Runtime；应直接接入其官方 JSONL RPC，而不是通过 TUI 抓屏或把第三方 ACP shim 当作上游合同。
> 第 1–13 节保留接入前研究快照；其 `NotImplemented` / `Blocked` 与未准入结论不能覆盖后续真实证据。
> 当前实施与准入结论见第 14–16 节、[Runtime Launch and Verification v27](../contracts/runtime-launch-and-verification-v27.md)
> 和 [Runtime 兼容性清单](../runtime-compatibility.md)。

## 基本结论

```text
Runtime: Pi Coding Agent
建议 AdapterKind: pi
上游源码快照: earendil-works/pi main；package version 0.84.2
建议接入形态: other / pi_jsonl_rpc
Exact launch command:
  pi --mode rpc --no-extensions --no-skills --no-context-files --no-prompt-templates --no-themes
     --no-approve --no-builtin-tools --extension <rovai-pi-host-v2>
Transport: strict LF-delimited JSON over stdin/stdout
当前 Admission: macOS arm64 qualified；macOS x64 / Windows x64 not_qualified
一句话结论: 独立 JSONL RPC、原生认证/默认模型、workspace resident Host、动态 Bootstrap/Skills、Core-managed stdio MCP 与 exact resume 已实现；Usage/Compaction Disabled。
最接近的现有 Adapter: 新建 Pi RPC Transport；可复用 Runtime Fleet、Event normalization、process cleanup 与 Session fencing。
```

### 接入前推荐决定（历史研究快照）

**进入 P0 技术实现原型，但在受管权限扩展和启动隔离完成前保持 `not_qualified`。**

Pi 的优点：

- 官方 RPC 是专门面向进程集成的 JSONL 协议；
- Tool lifecycle、Streaming text、Session、Usage 和 Compaction 都有结构化事件；
- `agent_settled` 比 `agent_end` 更适合作为可靠 final；
- Session 文件/ID 可精确恢复；
- Extension 可以在 Tool 执行前阻断并通过 RPC UI 请求用户决定。

Pi 的主要风险：

1. 上游明确说明 **没有内建 sandbox 或权限系统**。
2. 用户/项目 Extension 与 Skill 会在进程内执行，必须隔离受管扩展和用户资源。
3. Session cumulative Usage 不能直接记为当前 AgentRun。
4. Pi 没有原生 Built-in MCP；External MCP 若需要，只能另做受管 Extension，不能当作基础能力。
5. Windows 依赖 Bash，进程树比单一 npm launcher 更复杂。

## 1. 证据边界

### 源码/文档已经确认

- `pi --mode rpc` 使用严格 LF 分隔 JSONL；Command、Response 和 Event 均结构化。
- Prompt accepted 由带 request ID 的 response 表示；后续失败在事件流报告。
- 结构化事件包括：
  - `agent_start`、`agent_end`、`agent_settled`
  - `turn_start`、`turn_end`
  - `message_start/update/end`
  - `tool_execution_start/update/end`
  - `compaction_start/end`
  - retry、queue、extension error
- Tool 事件带稳定 `toolCallId`、toolName、args、partial result 和 final result。
- Session 可通过 `--session <path|id>` 精确启动；RPC 可读取 `sessionFile` 和 `sessionId`，也可 `switch_session`。
- RPC 提供 model、thinking、commands、Session stats、compact 和 abort。
- Extension 的 `tool_call` 事件可以在执行前返回 `{block: true}`。
- RPC mode 的 Extension UI 会发送阻塞式 `extension_ui_request`，客户端可用 `extension_ui_response` 回答。
- Pi 没有内建 sandbox；Project Trust 只控制项目资源加载，不限制模型调用 Tool。
- Windows 需要 Git Bash/Cygwin/MSYS2/WSL 等 Bash。

### 仍需实机证明

- 目标发布二进制的完整 RPC shape 和版本兼容。
- `agent_settled` 在 retry、compaction、steer/follow-up、cancel 下是否始终唯一。
- `--session` 使用 full ID/path 时的 exact restore、Session lock 和 cold restart。
- 受管 Extension 是否能覆盖所有危险 Tool，并在 Core restart 后恢复 Approval。
- 如何只加载 Rovai 受管 Extension，而不执行不受信任的用户/项目 Extension。
- Skill 的 cold/warm/reload 时机和 `get_commands` 稳定 identity。
- Windows npm `.cmd`/standalone binary 与 Bash 子进程的 Job Object 清理。
- per-message Usage 的 counter mode、稳定 source identity 和 Provider 差异。

## 2. 接入形态

```text
Integration shape: other
Internal protocol family proposal: pi-jsonl-rpc-v1
Exact launch:
  pi --mode rpc
  --session-dir <absolute isolated directory>
  -e <absolute Rovai managed approval extension>
可选:
  --session <exact path or full ID>
是否为常驻 Host: 是
一个 Host 是否支持多个 Session: RPC 可 switch；首版建议一 Host 绑定一个 Native Session
```

### 不采用的方案

- 不使用 PTY/TUI 屏幕解析。
- 不使用 `-p --mode json` 作为主要交互 Transport。
- 不依赖第三方 `pi-acp` 作为产品协议真源。
- 不使用 `-c/--continue` 或 `/resume` 最近 Session 选择。
- 不扫描私有 Session 文件寻找“最接近”的会话。

### Host 启动隔离

首版必须证明以下至少一种路径：

1. 独立 Pi config/home，只含 Rovai 受管 Extension 和明确投递的 Skill；或
2. CLI 可以禁用自动 Extension 扫描，同时用 `-e` 显式加载受管 Extension。

如果无法阻止用户/项目 Extension 在 Runtime Host 内任意执行，正式准入应保持 Blocked。

## 3. 受管 Approval Extension

Pi 官方示例已经证明 `tool_call` 可在 Tool 执行前阻断。Rovai 应提供自己的 Extension，职责仅包括：

1. 规范化 Tool name/input 为 canonical Action；
2. 向 RPC client 发出阻塞式 UI request；
3. 等待 Rovai durable Approval；
4. allow 时返回 `undefined`；
5. deny/timeout/restart 时返回 `{block: true, reason}`；
6. 不保存用户全局授权，不修改 Pi 用户设置。

### 必须覆盖的 Tool

- `bash`
- `write`
- `edit`
- 其他启用的 built-in/extension Tool
- 未来 External MCP Tool（若实现）

### Approval 语义

- allow-once：只允许一个 exact toolCallId / canonical digest。
- deny：目标副作用不得发生。
- Core restart：未决 Approval fail closed；不能因 Extension 内存丢失而继续执行。
- read-only workspace：写/编辑/危险 shell 直接阻断或按 Core policy 询问。
- Extension error：按拒绝处理，并形成 compatibility failure。

## 4. Session 生命周期

| 能力 | 当前研究结论 |
| --- | --- |
| 新 Session | 进程启动默认创建，或 RPC `new_session` |
| 同 Host 复用原 Session | 可行；首版一个 Host 绑定一个 Session，避免 switch 并发复杂度 |
| exact resume | `--session <exact path/full ID>` 或 RPC `switch_session`；必须保存两者 |
| history restore | Session 文件本身是持久历史；加载时不得把历史事件重新投影为当前 Prompt |
| Host/Core 重启后的恢复 | 新进程使用 exact `--session`，随后 `get_state` 核对同一 ID/path |
| 恢复失败策略 | fail closed，记录 continuity lost，至多创建一个新 Session |

### 推荐 Session 策略

```text
Warm: warm_host
Cold: exact_resume via canonical sessionFile + full sessionId
No fuzzy fallback: 禁止 partial ID、continue-most-recent 和目录扫描
```

`sessionFile` 是敏感内部 locator，不进入普通公共投影；Core 只保存受管引用和 digest-bound binding。

## 5. Host 与 Session 兼容性

| 变化 | 复用原 Session | 新 Session | 重启 Host | 加载阶段/理由 |
| --- | ---: | ---: | ---: | --- |
| Runtime version / executable | 否 | 否 | 是 | `process_start` |
| Provider/model | 有条件 | 可选 | 否 | RPC `set_model`；需成功 ACK 和 model identity |
| Thinking level | 是 | 否 | 否 | RPC `set_thinking_level`，per Session |
| Permission policy/Extension | 否 | 可选 | 是 | Extension 在 `process_start` 加载，是 Host compatibility |
| External MCP Extension | 否 | 可选 | 是 | 若实现，Extension/process-scoped |
| Skill exposure | 仅 reload 证据通过后 | 是 | 可选 | project/user scan 时机需 Probe |
| cwd / workspace access | 否 | 是 | 是 | Pi cwd 与项目资源在启动时加载 |
| Attachment root | 否 | 是 | 是 | Host OS 权限与工具根 |
| Per-Prompt context | 是 | 否 | 否 | RPC `prompt`，按 execution epoch fencing |

## 6. Ready 语义

### Light Ready

- `pi` 可执行；
- `pi --version` 成功；
- 当前版本与 fingerprint 已记录；
- Node/npm launcher 或 standalone binary identity 可解析。

### Product Ready

建议同一 validator 要求：

1. `pi --mode rpc` 启动；
2. `get_state` 返回 Session ID/file、isStreaming=false；
3. `get_available_models` 或等价模型查询成功；
4. Rovai managed Approval Extension 完成 handshake；
5. 未加载未授权 Extension；
6. Host shutdown/process-tree cleanup 通过。

认证可能只在真实 Provider 调用时暴露。如果没有无模型 auth check，Product Availability 保持 `light_ready`，首次真实 AgentRun 在同一 Host 建立 Ready。不能仅因模型列表存在就声明凭据有效。

## 7. 核心能力矩阵

| 能力 | Runtime evidence | Rovai implementation | 边界说明 |
| --- | --- | --- | --- |
| Dynamic model catalog | DocumentationOnly | NotImplemented | RPC `get_available_models` |
| Permission / mode catalog | Unsupported | Blocked | 上游无内建 permission；必须由受管 Extension 提供 |
| Structured Tool lifecycle | DocumentationOnly | NotImplemented | `tool_execution_start/update/end` |
| Approval allow / deny | DocumentationOnly | Blocked | Extension 机制可行，Rovai durable bridge 尚未实现 |
| Cancellation | DocumentationOnly | NotImplemented | RPC `abort`；需 `agent_settled` 和副作用 Smoke |
| Reliable final boundary | DocumentationOnly | NotImplemented | 使用 `agent_settled`，不能使用 `agent_end` |
| External MCP | Unsupported | Disabled | 上游核心未内建；第三方 Extension 不自动成为产品能力 |
| Rovai managed Skill | DocumentationOnly | NotImplemented | 候选 `.pi/skills` / `.agents/skills` |
| Runtime advertised commands | DocumentationOnly | NotImplemented | RPC `get_commands`，含 source/path |
| Compaction signal | DocumentationOnly | NotImplemented | `compaction_start/end`；需 occurrence/dedupe |
| Usage / Token / Cache / Cost | DocumentationOnly | NotImplemented | per-message usage + Session stats；需 Run 归因 |

## 8. Tool、Final 与 Missing-Send

### Tool/Command Output

固定 marker：

```text
printf 'ROVAI_PI_COMMAND_OK\n'
```

断言：

- `tool_execution_start.toolCallId` 与 end 相同；
- partial update 是累计还是 delta，按文档/实测处理；
- marker 从 final result 进入 Action output；
- 空输出命令保留 `args.command`；
- direct RPC `bash` 与模型调用 `bash` 分开，不混合 Action identity；
- fullOutputPath 是私有内部路径，不公开。

### Final

- `message_end.message` 是消息权威快照；
- `agent_end` 之后可能 retry/compaction/queued continuation；
- 只有 `agent_settled` 才可形成 AgentRun final candidate；
- 若 settled 前有多个 assistant message，只选择最后一个已完成、非 thinking 的 assistant text；
- process exit 不能替代 settled。

### Missing-Send

只有在以下 Smoke 通过后启用：

- zero-send + final；
- accepted send 抑制 recovery；
- tool→final；
- retry/compaction 后只取 settled 最终正文；
- cancel/error 不发布成功 final。

## 9. Usage、Token、Cache 与 Compaction

### Usage

Pi 文档公开：

- message update 的最新 cumulative Provider usage；
- Session stats 的 input/output/cache read/cache write/total/cost；
- compaction summary 的独立 usage。

接入原则：

- Session stats 只建立 baseline，不能直接写当前 Run；
- 优先从权威 `message_end` 或 turn-level assistant message 取得单次 usage；
- 必须冻结 Provider/model dialect；
- reasoning 是否包含在 output 需按 Provider/版本证明；
- 同一 message update 重发不得重复累计；
- compaction usage 与普通 assistant turn 分开 source identity；
- contextUsage 不是 Token billing bucket。

### Compaction

结构化候选：

- `compaction_start { reason }`
- `compaction_end { reason, result, aborted, willRetry, errorMessage }`

建议：

```text
Runtime evidence: DocumentationOnly
Rovai implementation: NotImplemented
Candidate detector: BestEffort after real Probe
Signal phase: started / completed
```

因为事件未显示稳定 occurrence ID，需使用 `host_instance + session_generation + monotonic_sequence` 建立去重，并验证 replay/restart 不会重复。

## 10. Skill 与 Command

候选路径：

```text
User:
- ~/.pi/agent/skills
- ~/.agents/skills

Project:
- <repo>/.pi/skills
- <repo>/.agents/skills
```

RPC `get_commands` 返回 command name、description、source、location 和 path。必须验证：

- cold Host；
- warm Host；
- new Session；
- exact restored Session；
- 是否存在 RPC reload；
- project trust 对 managed Skill 的影响；
- 同名 user/project 优先级；
- Rovai managed Skill 不覆盖用户文件。

## 11. Windows 平台边界

```text
Install form:
- npm launcher / .cmd
- 官方 standalone installer/binary（实际形式待 Probe）

Bash requirement:
- custom shellPath
- Git Bash
- bash.exe on PATH (Cygwin/MSYS2/WSL)

Native Windows or WSL: Native Windows 可运行，但工具依赖 Bash
Process cleanup: Windows Job Object 必须覆盖 npm/node/bun/bash/child tools
```

必须验证：

- `pi.cmd`/`pi.exe` 的 canonical child；
- `--mode rpc` 不进入 TUI；
- Git Bash 路径和空格；
- Extension 产生的后代进程；
- cancel/stop 后无 bash、node、bun、LSP 或 Tool 残留；
- Session path 在 NTFS、非 ASCII 和长路径下稳定；
- Native Windows 与 WSL 不共享错误 Session locator。

## 12. 最小真实 Probe 计划

1. `pi --version`、`pi --mode rpc` JSONL framing，包括 `U+2028/U+2029` 字符。
2. get_state/model/commands，记录启动异步消息和 model catalog 延迟。
3. 受管 Extension：
   - handshake；
   - bash/write/edit allow；
   - deny；
   - timeout；
   - Core restart。
4. Tool：marker、empty、stderr、non-zero、large output。
5. Final：无 Tool、Tool、retry、compaction、steer、follow-up、cancel。
6. Session：warm、cold exact path/ID、错误 ID、Session lock、Core restart。
7. Skill：cold/warm/new/restore/reload + unique marker。
8. Usage：streaming duplicate、message-end、session baseline、compaction usage。
9. Compaction：manual、threshold/overflow、abort、retry。
10. Missing-Send 三件套。
11. Process cleanup：正常、error、cancel、shutdown、Extension 后代进程。
12. Windows x64 重复关键 Probe。

## 13. Rovai 所需改动

- 新增 `AdapterKind::Pi` 和独立 `PiRpcRuntimeAdapter`。
- 实现严格 LF JSONL codec，不复用 ACP JSON-RPC 路由。
- 新增 Pi Host/Session owner、request correlation 和 monotonic event sequence。
- 编写、版本化并投递 Rovai managed Approval Extension。
- 建立 Extension isolation 和专用 config/session root。
- 使用 `agent_settled` 实现 terminal/final。
- 实现 exact session file/ID binding 和 cold resume。
- 增加 Pi Tool/Usage/Compaction reducer。
- External MCP 首版保持 Disabled；Built-in `rovai` CLI 通过 bash/受管 Tool 验证。
- 新增 `smoke:pi-runtime`、Runtime Activity、diagnostics、planned shutdown 和 Windows Job tests。

## 接入前最终决定（历史研究快照）

```text
Qualified capabilities: 无
Disabled capabilities: External MCP
Unverified capabilities: managed Approval、exact restore、Usage attribution、Skill refresh、Windows cleanup
Blocking issues: 上游无内建权限；Extension isolation；全进程树清理
Recommended admission decision: not_qualified；完成受管 Approval Extension 原型后再开展平台资格 Smoke
```

## 14. 2026-08-24 初版实施与真实验收回填（历史基线）

研究阶段的硬阻断已经由当前实现闭合：

| 研究问题 | 当前证据 | 实施结论 |
| --- | --- | --- |
| 官方协议 | `pi 0.84.2` strict LF JSONL、split read、`U+2028/U+2029`、request correlation 通过 | 独立 `pi-jsonl-rpc-v1`，不复用 ACP，不解析 TUI |
| Extension 隔离 | 私有 `PI_CODING_AGENT_DIR`，`--no-extensions/--no-skills` 后只 explicit `-e/--skill`；handshake fixture 与真实 Host 通过 | 未授权用户/项目 Extension 不进入正式 Host；Probe 使用另一临时 root |
| Provider secret | 权限 `0600` 的 Claude settings exact 三字段成功驱动 MiniMax；负向 owner/mode/URL fixture 通过 | env-ref models.json + child-only token；不写 argv、DB、Evidence 或 Pi 用户配置 |
| Approval | managed Extension 的 Bash allow、write allow、write deny、restart/timeout fail-closed 路由通过 | 唯一权限 `approval_mode=managed`；未知 mutating Tool 阻断 |
| Final / Tool | 稳定 `toolCallId`、cumulative update、`message_end.message`、`agent_settled` 与 private thinking 通过 | response 只表示 accepted；`agent_settled` 是 final/Missing-Send boundary |
| Warm / cold Session | 兼容 Run 同 Host/Session；Core restart 后 exact Session file 恢复同 UUID，并在源 marker 删除后回忆 | 公共 LRU；首版一 Host 一 Session；warm → exact resume → new，无 fuzzy/history restore |
| Skill | `.pi/skills` unique marker、CLI help、restart recovery、Shadowed/delete lifecycle 通过 | Session-scanned explicit `--skill`；exposure digest 进入 compatibility |
| Built-in | 当前十五项 operation、三种输入、Gather、conflict、lease fence、successor read 与 continuation 通过 | bundled `rovai` CLI 经 managed Bash，不依赖 MCP |
| MCP | Pi 核心没有 Product-managed external server projection | `Unsupported`，不是 `Disabled but available` |
| Usage / Compaction | 上游候选存在；本轮没有完成 Run attribution 和 resume dedupe 资格矩阵 | 两者首版 `Disabled`，不阻断基础 Runtime |
| 平台 | macOS arm64 真实 first/warm/cold、Approval、cancel、Skill、Missing-Send、Built-in 全通过 | macOS arm64 qualified；macOS x64/Windows x64 不外推 |

项目级真实矩阵为：

- `pnpm smoke:pi-runtime`：first、warm reuse、Core restart/cold exact resume、allow/deny、cancel、秘密隔离通过；
- `ROVAI_SKILL_SMOKE_ADAPTERS=pi pnpm smoke:skills`：managed projection、private marker 与 CLI help 通过；
- `ROVAI_MISSING_SEND_RECOVERY_ADAPTERS=pi pnpm smoke:missing-send-recovery`：zero-send 与 accepted-send
  suppression 通过；
- `ROVAI_BUILTIN_CLI_ADAPTERS=pi pnpm smoke:builtin-cli`：十五项 operation 全部通过。

以上 Smoke 使用隔离 Core data-dir、Session root 与 Git workspace，不启动日常 App，不读写日常数据库。公开报告
只记录版本、安全 fingerprint 和相等性结论，不记录 token、原始 provider URL、Prompt、Session UUID 或 locator。

## 15. 2026-08-24 初版决定（已由 revision 1 局部替代）

```text
Qualified platform: macOS arm64
Protocol: pi-jsonl-rpc-v1
Permission: managed only
Continuation: compatible warm host -> exact session-file resume -> new session
Managed Skill: .pi/skills, explicit at session start
Built-in CLI: Verified
External MCP: Unsupported
Usage / Compaction: Disabled
Not qualified: macOS x64, Windows x64
```

上述 provider overlay、一 Host 一 Session、explicit `--skill` 和 MCP Unsupported 已由下节与 v27 替代；
本节只保留当时证据，不再拥有当前产品语义。

## 16. 2026-08-25 revision 1 复核与实现回填

开发者已确认 [model-context-change revision 1](../versions/v1.28/model-context-change.md)。源码和本机 Pi
`0.84.2` 复核得到以下新结论：

| 轴 | revision 1 证据 | 当前实现结论 |
| --- | --- | --- |
| Auth/model | 不设置 `PI_CODING_AGENT_DIR`、provider 或 model 的真实 Prompt 使用用户 Pi native default 成功；当前 native default 由用户自己的 Pi 配置解析到 MiniMax | 不再读取 Claude settings或注入 token；支持 `pi://runtime-default` 与显式 `pi://model?...` exact list/set/state |
| Resident Host | deterministic Fleet test 证明 workspace Host 跨 Camp/member invalidation 继续复用；Host 仍 single-flight | compatibility 只含 workspace/process state；Session/identity/Skills/MCP/model 逐 Run binding，不跨 Workspace复用 |
| Session/identity | Host activation 使用 exact `switch_session/new_session`；new Session file 延迟 materialization 边界由真实 smoke 暴露并修复 | full UUID + canonical file；release 验证 header/UUID/cwd；Bootstrap Evidence v2 按 Binding 冻结身份 |
| Bootstrap | slow test 证明 profile edit 不改变同 Binding full bytes、无 redelivery overlay、receipt 前不能 accepted | `managed_system_prompt` + `before_agent_start` append + blocking Managed Input Receipt v1 |
| Skills | Session replacement 重建 ResourceLoader；`get_commands` 与 receipt 提供 actual catalog | exact `W/.pi/skills` 同时接纳 project-native 与 Rovai ready Skills；collision/escape/missing fail closed |
| MCP | Core stdio fixture 完成 initialize/initialized/tools-list/tools-call；Pi capability matrix 断言 CoreManaged | `AdditivePerRun / RovaiWins / CoreManaged`；stdio supported、HTTP unsupported；每次 MCP call durable approve |
| Migration | Migration 108 与 v052–v108 synthetic chain 定向回归通过 | v1.22/schema 63；旧 nonterminal Pi state clean break，completed history 与非 Pi state保留 |
| Compaction | ordinary managed prompt 真实 smoke 已通过；manual/threshold/overflow+retry 完整矩阵未执行 | protected instruction/no-redelivery 已实现，但 Compaction 继续 Disabled/unqualified |

当前产品语义由
[Runtime Launch and Verification v27](../contracts/runtime-launch-and-verification-v27.md)拥有；本研究只保留证据、
初始假设与后续验证轨迹。

## 上游来源

- https://github.com/earendil-works/pi
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/windows.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/permission-gate.ts
