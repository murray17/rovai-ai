---
document_type: runtime-research
runtime: cursor-agent
upstream: Cursor CLI
authority: research-evidence-only
status: proposed
admission: not_qualified
last_updated: 2026-08-22
---

# Cursor Agent Runtime 接入研究

> 本文按 [`runtime-integration-checklist.md`](https://github.com/murray17/rovai-ai/blob/main/docs/development/runtime-integration-checklist.md) 整理。
> 官方文档只能建立候选协议面；正式准入仍要求目标 CLI 版本、目标平台和可复现真实 Smoke。

## 基本结论

```text
Runtime: Cursor Agent CLI
AdapterKind: cursor-agent
本机候选版本: 2026.08.11-e8db854（隔离下载；未进入用户安装目录）
建议接入形态: vendor_extended_acp
Exact launch command: <validated cursor-agent-or-agent> acp
Transport: stdio / newline-delimited JSON-RPC 2.0 / ACP
当前 Admission: not_qualified
一句话结论: Catalog/Adapter 已实现并保守处理 Cursor 私有消息，但本机认证 Session 未建立，所有平台仍未准入。
最接近的现有 Adapter: 通用 ACP Host + Cursor 私有 request/notification router。
```

### 推荐决定

**已进入 Product Runtime Catalog，但在以下行为证据通过前保持逐平台 `not_qualified`：**

1. `session/load` 必须在 warm Host、cold Host 和 Core restart 后保持精确 Session ID。
2. `cursor/ask_question` 与 `cursor/create_plan` 是阻塞请求，Rovai 必须可靠响应，否则 Agent 会永久等待。
3. 官方 ACP 页面只明确保证项目/用户 `.cursor/mcp.json`；Rovai 所需的 per-Run additive MCP 注入必须单独证明，不能靠配置文件推断。

Cursor CLI 默认自动更新，因此 Runtime version/fingerprint 变化必须立即使旧 Ready 和行为资格失效。

Catalog identity 只表示实现了 closed Adapter、Migration、配置与 UI 投影；它不授予 discovery、成员选择、
Probe 或 AgentRun。平台准入仍由 `AdapterKind × HostPlatformKey` 矩阵单独控制。

## 1. 证据边界

### 官方文档已经确认

- 当前命令名为 `agent`，ACP 入口是 `agent acp`。
- 传输为 stdio，消息是逐行 JSON-RPC 2.0，日志可走 stderr。
- 标准流是 initialize → authenticate(`cursor_login`) → session/new 或 session/load → prompt。
- Permission 选项包括 `allow-once`、`allow-always`、`reject-once`。
- 支持 `agent`、`plan`、`ask` 三种核心模式。
- 私有阻塞请求：
  - `cursor/ask_question`
  - `cursor/create_plan`
- 私有通知：
  - `cursor/update_todos`
  - `cursor/task`
  - `cursor/generate_image`
- 官方提供 macOS/Linux/WSL 和 Native Windows 安装。
- CLI 默认自动更新。
- CLI 会读取 `.cursor/rules`、`AGENTS.md`、`CLAUDE.md` 和 Cursor Skills/MCP 配置。

### 仍需实机证明

- initialize response 的完整 capabilities、model/mode/config catalog。
- `session/load` 是否在当前发布版本可靠、是否 replay、是否保持精确 ID。
- 同 Host 多 Session 的并发与隔离。
- Tool start/progress/result 的实际 shape、稳定 ID 和 command output 字段。
- Session response 后是否有异步 catalog、usage 或 Cursor 私有 extension。
- per-Run `mcpServers` 是否被消费；还是只能依赖 `.cursor/mcp.json`。
- Skill 扫描与 available commands 的 cold/warm/load 时机。
- ACP Usage/Cache/Cost 与 Compaction lifecycle。
- Native Windows 的实际 executable、子进程和 Job Object 行为。

### 2026-08-22 本机隔离探测

- `/opt/homebrew/bin/agent --version` 返回 `grok 0.2.118`，证明通用命令名存在真实产品碰撞；因此 Rovai
  以 `cursor-agent` 为 canonical command，并只在 `agent --version` 严格符合
  `YYYY.MM.DD-<build>` Cursor build identity 时接受兼容别名；
- 用户现有 `~/.local/bin/cursor-agent` 为 `2025.09.18-7ae6800`，没有 ACP 子命令；
- 仅在临时隔离目录下载的最新候选为 `2026.08.11-e8db854`，`agent acp` 可完成 ACP v1 initialize；
- `authenticate({methodId:"cursor_login"})` 在 15 秒有界窗口内未完成；跳过认证时 `session/new` 明确返回
  Authentication required；
- 探测没有执行 `agent login`、没有改写用户凭据/配置、没有发送模型 Prompt，也没有把临时 CLI 安装为
  日常命令。

因此这轮只建立 executable identity、launch shape 与 initialize 证据。它不能建立 authenticated Ready，
更不能替代 command output、Approval、cancel、private request、Session continuation、MCP 或 cleanup Smoke。

## 2. 接入形态

```text
Integration shape: vendor_extended_acp
Exact launch command: agent acp
Discovery candidates:
- cursor-agent（canonical command）
- agent（仅在严格 Cursor build identity 验证后接受）
是否为常驻 Host: 是
一个 Host 是否支持多个 Session: 未验证
依赖的私有方法:
- cursor/ask_question（阻塞）
- cursor/create_plan（阻塞）
- cursor/update_todos（通知）
- cursor/task（通知）
- cursor/generate_image（通知）
```

### 私有方法处理要求

- 两个阻塞请求必须有 request ID、Session/epoch fencing、超时和 restart 后 durable state。
- `ask_question` 映射 Rovai 结构化 Ask；取消/跳过必须返回 Cursor 规定的 outcome。
- `create_plan` 映射独立 Plan Review，不可冒充普通 Tool Permission。
- 通知方法只进入受审查的私有/公开投影；不自动生成 Action、Final 或 Usage。
- 未来未知 `cursor/*` 方法先按 vendor extension 隔离；未知阻塞 request 返回 Method not found，不能让 Host 无期限等待。

## 3. Session 生命周期

| 能力 | 当前研究结论 |
| --- | --- |
| `session/new` | 官方文档确认；真实 Session ID 与 catalog shape 待 Probe |
| 同 Host 复用原 Session | 候选能力；必须证明 Prompt/extension/permission 不串 Run |
| `session/resume` | 官方文档未声明；当前按 Unsupported/NotObserved 处理 |
| `session/load` | 官方文档称可恢复 conversation；精确 ID、replay 和 cold-host 行为未验证 |
| Host/Core 重启后的恢复 | 候选为 `session/load` history restore |
| 恢复失败策略 | fail closed，记录 continuity lost；只在确认不可恢复后 fresh session |

### 推荐 Session 策略

```text
Candidate: history_restore
Not supported until proven: exact_resume
Fallback: new_only only after explicit continuity-lost record
```

`session/load` 的 Probe 必须回答：

- response 前是否回放历史；
- response 后是否还有迟到 replay；
- 返回的 Session ID 是否与请求完全相同；
- replay 是否包含 Tool、Permission、Usage、Cursor extension；
- 同一 ID 在进程重启后是否仍可恢复；
- Session 存储是否绑定 cwd、账号、模型或 CLI 版本。

## 4. Host 与 Session 兼容性

| 变化 | 复用原 Session | 新 Session | 重启 Host | 加载阶段/理由 |
| --- | ---: | ---: | ---: | --- |
| Runtime version / executable | 否 | 否 | 是 | 默认自动更新；fingerprint 是强边界 |
| Model | 未验证 | 是 | 可选 | 动态 set-model/catalog wire 未冻结 |
| Permission / mode | 有条件 | 是 | 可选 | mode 是 Session-scoped；schema drift 失效 Ready |
| MCP | 否 | 是 | 建议 | 官方只明确 `.cursor/mcp.json`，per-Run 注入未证明 |
| Skill exposure | 仅 live refresh 通过后 | 是 | 可选 | scan/update 时机未知 |
| cwd / workspace access | 否 | 是 | 可选 | Session-scoped，不能跨工作区偷复用 |
| Attachment root | 否 | 是 | 建议 | generated image/file paths 需要明确授权根 |
| Per-Prompt context | 是 | 否 | 否 | 每 Prompt 按 delivery/execution epoch 重建 |

如果最终只能通过 `.cursor/mcp.json` 或 `.cursor/skills` 注入资源，这些文件的 digest 必须进入 Native Session compatibility；Rovai 不能修改用户级配置。

## 5. Ready 语义

### Light Ready

- `agent`/兼容候选存在且可执行；
- `agent --version` 有界成功；
- 保存 canonical path、version 和 fingerprint；
- 不触发自动登录、模型调用或后台升级。

### Product Ready

同一 validator 建议要求：

1. initialize 成功；
2. `cursor_login` authenticate 成功，或预认证 token/API key 被明确接受；
3. `session/new` 返回非空 Session ID；
4. mode/permission schema 可解析；
5. Cursor 私有 method router 已启用；
6. Host 可有界 shutdown，进程树清理通过。

Product Ready 不代表以下行为已经完成 Adapter qualification：

- cold `session/load`；
- per-Run MCP；
- Skill；
- Command Output；
- Usage/Compaction。

CLI 默认自动更新。建议在真实 `agent --help` 中寻找官方的禁用自动更新参数；只有确认参数和 flag 位置后才加入 launch policy。无论是否禁用，fingerprint 改变都必须降级 Ready。

## 6. 核心能力矩阵

| 能力 | Runtime evidence | Rovai implementation | 边界说明 |
| --- | --- | --- | --- |
| Dynamic model catalog | Unverified | Disabled | 只提供 runtime-default；不伪造动态 catalog |
| Permission / mode catalog | DocumentationOnly | Implemented | 静态 `agent/plan/ask` 与 `default/auto_review/force`；不冒充 Session 证据 |
| Structured Tool lifecycle | Unverified | Implemented | 复用 ACP parser，但 Activity baseline 保持 run-level，待真实 Tool fixture |
| Approval allow / deny | DocumentationOnly | Implemented | 复用标准 ACP permission router；副作用 Smoke 未通过，不能准入 |
| Cancellation | DocumentationOnly | Implemented | 复用 `session/cancel`；真实终态/迟到事件仍未验证 |
| Reliable final boundary | DocumentationOnly | Implemented | 复用 ACP Prompt response；Missing-Send 保持 Disabled |
| External MCP | Unverified | Disabled | `.cursor/mcp.json` 已确认；per-Run additive MCP 未确认 |
| Rovai managed Skill | DocumentationOnly | Implemented | 只投影项目 `.cursor/skills`；load/invocation 未验证 |
| Runtime advertised commands | Unverified | NotImplemented | Skill slash command存在，但 ACP update 时机需 Probe |
| Compaction signal | NotObserved | Disabled | 未发现官方 ACP structured compaction lifecycle |
| Usage / Token / Cache / Cost | NotObserved | Disabled | Headless 能力不能直接外推到 ACP |

## 7. Skill、Rules 与 MCP

### Managed Skill 候选

```text
<repo>/.cursor/skills/<name>/SKILL.md
<repo>/.agents/skills/<name>/SKILL.md
```

必须分别证明：

- cold Host 是否扫描；
- warm Host 新 Session 是否扫描；
- 同一 Idle Session 是否 live refresh；
- `session/load` 是否使用历史快照还是当前文件；
- Skill 是否出现在 ACP available commands；
- update 是 full replacement 还是 delta。

### Rules

Cursor 还读取：

- `.cursor/rules`
- `AGENTS.md`
- `CLAUDE.md`

这些是 Session/Prompt 输入，不应与 Rovai managed Skill 混为同一 capability。Rovai 需要记录具体加载阶段和 digest。

### MCP

官方 ACP 页面保证的是项目级/用户级 `.cursor/mcp.json`，并明确不支持 Team Dashboard MCP。对 Rovai：

- 不写用户级 MCP；
- 优先 Probe `session/new.mcpServers` 是否真实生效；
- 若不支持，只能考虑受管项目 overlay，并把其 ownership、清理、优先级和 Session compatibility 写入合同；
- 未完成 A/B Server 集合隔离前，External MCP 和 Built-in MCP 均保持 Blocked。

## 8. Command Output、Usage 与 Compaction

### Command Output

真实 Smoke 必须强制：

```text
printf 'ROVAI_CURSOR_COMMAND_OK\n'
```

通过条件：

- 一个稳定 Tool ID；
- started → terminal 唯一配对；
- marker 在对应 Action output；
- 空输出命令仍显示安全 command input；
- stderr、失败命令和超大输出均正确；
- `cursor/task` 或最终 narration 不得被误认作命令输出。

### Usage

官方 ACP 页面当前未给出标准 Token/Cache/Cost shape。即使 headless/CI 模式存在 Usage 字段，也不能跨 transport 外推。

```text
Runtime evidence: NotObserved
Rovai implementation: Disabled
```

只有在 ACP transcript 中证明 source identity、scope、counter mode 和 bucket semantics 后再接入。

### Compaction

未发现官方 ACP structured compaction method/update。普通文本、上下文缩短或 token 下降均不能充当信号。

```text
Runtime structured-signal evidence: NotObserved
Rovai detector: Disabled
```

## 9. Windows 平台边界

```text
Install form: 官方 Native Windows PowerShell 安装
Verification: agent --version
实际启动文件: 待记录 agent.exe / shim canonical path
支持架构: 目标为 windows-x64，必须实测
认证存储: Cursor CLI 本机凭据；精确路径只做脱敏内部证据
进程树清理: Windows Job Object
已知边界: 文档已从旧 WSL-only 迁移到 Native Windows，不能沿用历史假设
```

必须验证：

- PowerShell 安装产物和升级替换行为；
- `CURSOR_API_KEY`、`CURSOR_AUTH_TOKEN` 与 `agent login`；
- 路径含空格/非 ASCII；
- shell/tool 子进程是否全部进入 Job Object；
- cancel、ACP error、App shutdown 后无残留；
- Native Windows 的 `session/load` 与 macOS/Linux 行为是否一致。

## 10. 最小真实 Probe 计划

1. `agent --version`、`agent --help`、`agent acp` 基础形态和自动更新控制。
2. initialize/authenticate/session-new 的完整脱敏 transcript。
3. Session response 后、Idle、Prompt active、terminal 后和 cancel 后的完整消息面。
4. 触发并回答：
   - `cursor/ask_question`
   - `cursor/create_plan`
   - `session/request_permission`
5. Tool：固定 marker、空输出、失败命令、文件读写编辑。
6. Approval：allow-once、allow-always、reject-once；deny 后无副作用。
7. Session：
   - warm same session；
   - new Host `session/load`；
   - Core restart；
   - 错误 ID、不同 ID、replay 超限。
8. MCP：session param、项目 overlay、A/B Server 集合、相邻 Session。
9. Skill：cold/warm/new/load + unique marker。
10. Missing-Send：zero-send、send suppression、tool→final。
11. Usage/compaction：完整枚举但不预设存在。
12. Process cleanup 和 Native Windows 重复验证。

## 11. Rovai 所需改动

- 已新增 `AdapterKind::CursorAgent`、Migration 104、图标、显示名和逐平台 Admission。
- 已增加 executable discovery：首选 `cursor-agent`，严格验证后兼容 `agent`。
- 已实现 Cursor ACP auth flow 和私有 extension router；Ask 当前安全跳过、Plan 当前安全拒绝，不声明 durable review。
- `session/load` / `session/resume` 均未准入；完成 Run 后停止 Host，不实现虚假的 continuation。
- 冻结自动更新/版本 fingerprint 行为。
- 在 per-Run MCP 通过前保持 MCP/Built-in transport Blocked。
- 新增 `smoke:cursor-runtime`，覆盖 private request、command output、resume、Approval、cleanup。
- 更新 Runtime Activity、diagnostics、planned shutdown、compatibility register。

## 最终决定

```text
Qualified capabilities: 无
Disabled capabilities: Usage/Cost、Compaction detector
Implemented but not behavior-qualified: identity/discovery、ACP auth flow、private request router、静态权限、planned shutdown、项目 Skill 投影
Unverified capabilities: authenticated session、Tool output、model catalog、Approval/cancel、session/load、per-Run MCP、Skill invocation、Windows
Blocking issues: 当前候选 authenticate 超时；尚无 authenticated Session 与完整行为 Smoke
Admission decision: macOS arm64、macOS x64、Windows x64 全部 not_qualified
Product presentation: 保留 closed identity 与历史 reader；默认不接入，也不在 Settings Agent Runtime 目录展示
```

## 上游来源

- https://prod.cursor.com/docs/cli/acp
- https://prod.cursor.com/docs/cli/installation
- https://prod.cursor.com/docs/cli/using
- https://cursor.com/cli
- https://cursor.com/docs/skills
- https://forum.cursor.com/t/cursor-acp-session-load-fails-with-session-id-not-found-breaking-persistent-sessions-acpx-openclaw-acp-runtime/155516
