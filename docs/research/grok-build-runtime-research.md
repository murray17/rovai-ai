---
document_type: runtime-research
runtime: grok-build
upstream: Grok Build CLI
authority: research-evidence-only
status: validated
admission: qualified
last_updated: 2026-08-25
---

# Grok Build Runtime 接入研究

> 本文按 [`runtime-integration-checklist.md`](https://github.com/murray17/rovai-ai/blob/main/docs/development/runtime-integration-checklist.md) 整理。
> xAI 官方文档是主要来源；Multica/Botmux 代码只作为非合同参考，不替代当前 Grok 二进制的真实 Probe。

## 2026-08-25 `1.0.0` continuation 基线

当前产品支持下限已切到 `grok >= 1.0.0`。该版本正式在
`initialize.agentCapabilities.sessionCapabilities.resume` 广告标准 ACP resume，因此当前实现采用：

```text
compatible same-host Session
  -> exact ACP session/resume
  -> one continuity-lost replacement session/new
```

Grok 不再声明或选择 `session.load` 产品能力，也不保留 `0.2.118` load-only fallback；通用 ACP load 能力仍供
其他 Runtime 使用。light discovery 对低于门槛或不可解析的版本 fail closed，Deep Probe / machine Ready 还必须
看到 resume capability 对象。

System Prompt 合同没有变化：只有新 Session 的 `session/new._meta.rules` 携带完全相同的 Rovai Bootstrap；
resume 不重新注入 rules，恢复沿用原 Session 的 system prompt。Native Binding compatibility 改为
`grok-build:resume-v1`，继续包含官方配置摘要与 native-rules revision，因此 Bootstrap generation 改变时仍会
建立新 Session，未改变时才 resume。

本机截至本次变更仍为 `grok 0.2.118 (1e1687c1cf6a)`，只能验证旧版本会在启动 ACP 前被最低版本门拒绝；
`>= 1.0.0` 的真实 Deep Probe、cold resume 与 AgentRun 需要由 macOS arm64、macOS x64、Windows x64 客户端
分别补证。共享最低版本规则不改变逐平台 qualification 边界。

## 2026-08-24 历史目标版本实机复核

下文保留接入前研究假设；本节记录 `grok 0.2.118 (1e1687c1cf6a) × MiniMax-M3 × macOS arm64` 的后续
实证，当前产品结论以 v1.28 Version、Contract 与 compatibility register 为准。

- ACP `initialize/authenticate/session/new/prompt/cancel`、动态 catalog 与标准 `session/set_model` 通过；
  `session/set_config_option` 不存在；
- BYOK `xai.api_key` 真实通过。产品现直接支持官方 `$GROK_HOME/config.toml` 的 custom-model schema，
  `$GROK_HOME/.env` 只承载 `env_key` 明确引用的进程密钥；无 BYOK 时保留原生 Home 并选择 advertised
  `cached_token`。本机没有 Grok login，account-token 端到端仍为 `Unverified`；
- Fleet LRU 的 warm Host/同 Session 两轮通过；Runtime 广告 load、不广告 resume。独立新进程与完整 Core
  重启都以 exact `session/load` 完成 HistoryRestore，replay quarantine、恢复后 Tool/Approval/cancel、坏 ID
  fallback 全部通过；
- Session `mcpServers` 的确被忽略，但 process `--plugin-dir` 可加载权限收窄的临时 Plugin。产品 smoke 验证
  `AdditivePerRun / NativeWinsSkip`、两个 native 同名 Server 保留并启动、两个冲突 Assignment skip、第三个
  不同名 Server 被 MiniMax-M3 调用，以及 Plugin cleanup；
- `_meta.rules` 在 `session/new` 上是追加型原生 system rules，并随 exact load 保留。开发者已确认
  [model-context revision 2](../versions/v1.28/model-context-change-grok-native-rules.md)；生产保持完整 Bootstrap
  bytes 不变并改为 `native_append`，首轮 user payload 不再携带 Bootstrap，且不使用 `systemPromptOverride`；
- MiniMax `<think>` 可作为普通 `agent_message_chunk` 出现；产品不再做 provider-specific sanitizer，Kimi/Grok
  均按 generic ACP agent-text 路径原样投影到执行台、final 与 Missing-Send；
- no-leader live Probe 已取得 `_x.ai/session_notification` 的 structured `auto_compact_completed` 与稳定 event ID；
  产品 detector 为 `best_effort`，真实强制压缩后的下一轮 Redelivery revision 1 已 accepted。Usage/Cost 语义仍未
  独立验证并保持 Disabled；macOS x64 与 Windows x64 不从本机证据外推。

## 基本结论（接入前研究基线）

```text
Runtime: Grok Build CLI
建议 AdapterKind: grok-build
上游版本: 未冻结；必须由 grok --version + fingerprint 建立
建议接入形态: vendor_extended_acp
Exact launch command: grok --no-auto-update agent stdio
Transport: stdio / JSON-RPC / ACP
当前 Admission: not_qualified
一句话结论: 官方 ACP、认证、权限、MCP 和 Skills 基础较好；Session/Usage/迟到通知是接入重点。
最接近的现有 Adapter: TRAE/Kiro ACP Host，加 Grok authenticate、vendor usage 和 notification quiescence。
```

### 推荐决定

**进入 P1 Probe，并优先验证官方 ACP 而不是 TUI/Transcript 适配。**

官方已经确认：

- `grok agent stdio` 是 ACP 入口；
- automation 应关闭自动更新；
- initialize 后需要显式 authenticate；
- 支持 API key 和 cached login token；
- MCP、Skills、Permission modes 有官方配置面。

但官方文档没有完整冻结：

- `session/load`/`session/resume`；
- model/mode catalog；
- Usage `_meta`；
- Prompt response 后迟到 notification；
- Compaction lifecycle。

Multica 的当前实现表明这些面可能存在，但只能作为 Probe 提示，不能直接变成 Rovai 合同。

## 1. 证据边界

### 官方文档已经确认

- ACP 启动：`grok agent stdio`。
- 对脚本/ACP 建议传 `--no-auto-update`，或在配置中关闭自动更新。
- stdin/stdout 使用 JSON-RPC；assistant 文本通过 `session/update` 流式到达。
- 认证可使用：
  - `XAI_API_KEY`
  - `grok login` 后的 cached token
- Grok Build 有 Ask、Auto、Always-approve 权限模式；deny 规则和 PreToolUse hook 优先。
- User/Project MCP 支持 stdio 和 HTTP。
- Skills 扫描 `.grok/skills`、`~/.grok/skills`、plugin 和额外路径，并兼容 `.agents/skills`。
- `$GROK_HOME` 控制用户数据根，Windows 默认在 `%USERPROFILE%\.grok`。
- Headless 有 exact session-id/resume 参数，但不能自动外推为 ACP Session API。

### 非合同参考实现显示

Multica 当前 Grok Adapter：

- 启动 `grok --no-auto-update agent ... stdio`；
- initialize 后必须调用 `authenticate`；
- 尝试 `session/load` 和 `session/set_model`；
- Prompt response 后保留 notification quiet window；
- 从 turn `_meta` 读取 model/usage/provider cost；
- stdout/stderr reader 需要有界 drain。

这些结论必须由目标 Grok 版本重新验证。

### 仍需实机证明

- initialize 的 protocol version、auth methods、MCP capabilities。
- `session/new/load/resume/set_model` 的真实存在与语义。
- Prompt terminal、cancel 和迟到通知。
- Tool lifecycle、command output、Permission option ID。
- per-Run MCP 注入与相邻 Session 隔离。
- Skills 与 available-command update。
- `_meta.usage` 的 Token/Cache/Cost scope 和 source identity。
- Native Windows 安装产物、认证和进程树。

## 2. 接入形态

```text
Integration shape: vendor_extended_acp
Exact launch command:
  grok --no-auto-update agent stdio

Permission launch:
- 首版不要无条件传 --always-approve
- 使用 Ask/Runtime permission request，映射 Rovai durable Approval
- 最高权限值只有在用户配置和真实 Probe 通过后才可加入 descriptor

是否为常驻 Host: 是
一个 Host 是否支持多个 Session: 未验证
依赖的 vendor 面:
- authenticate authMethods
- 可能的 session/load / session/set_model
- 可能的 _meta.modelId / _meta.usage / provider cost
```

### Auth flow

1. initialize；
2. 读取 Runtime 实际广告的 authMethods；
3. 若 child env 有 `XAI_API_KEY` 且广告 `xai.api_key`，优先该方式；
4. 否则使用 `cached_token`；
5. 无可用方法时返回 authentication_required；
6. 不从文件是否存在推断已登录。

## 3. Session 生命周期

| 能力 | 当前研究结论 |
| --- | --- |
| `session/new` | 官方 ACP 示例使用；必须记录完整 response |
| 同 Host 复用原 Session | 候选；需要 compatibility 和 late-notification fencing |
| `session/resume` | 官方 ACP 文档未确认；按 NotObserved 处理 |
| `session/load` | 非合同参考实现使用；必须在当前二进制上验证 |
| Host/Core 重启后的恢复 | 候选为 exact `session/load`/history restore |
| 恢复失败策略 | fail closed，只有明确 Session-not-found 才允许 fresh fallback |

### 推荐 Session 策略

```text
Candidate primary: history_restore via session/load
Possible exact resume: NotObserved
Fallback: new session after continuity-lost evidence
```

不要把 headless CLI 的 `--resume`/`--session-id` 当作 ACP `session/resume` 证据。Rovai 产品路径只能使用目标 Transport 已验证的 Session API。

如果 `session/load` 返回不同 Session ID，Rovai 必须 fail closed；不能像部分参考实现那样静默接受新 ID。

## 4. Host 与 Session 兼容性

| 变化 | 复用原 Session | 新 Session | 重启 Host | 加载阶段/理由 |
| --- | ---: | ---: | ---: | --- |
| Runtime version / executable | 否 | 否 | 是 | `process_start`；关闭 auto-update 仍要 fingerprint |
| Auth method/account | 否 | 否 | 是 | authenticate/进程凭据边界 |
| Model | 有条件 | 是 | 可选 | `session_set_model` 需当前版本验证 |
| Permission/mode | 有条件 | 是 | 可选 | mode/allow/deny/hook schema 变化失效 Ready |
| MCP | 否 | 是 | 建议 | `session_new/load`；A/B 集合必须隔离 |
| Skill exposure | 仅 live refresh 通过后 | 是 | 可选 | project/user/plugin scan 时机未知 |
| cwd / workspace access | 否 | 是 | 可选 | Session/Project config 绑定 |
| Attachment root | 否 | 是 | 建议 | filesystem/network sandbox 与授权根 |
| Per-Prompt context | 是 | 否 | 否 | 每次 Prompt fencing |

Project `.grok/config.toml` 可以包含 MCP、plugins 和 permission rules。若 Rovai 使用项目 overlay，文件 digest 和 ownership 必须进入 Native Session compatibility；不得改用户 `$GROK_HOME/config.toml`。

## 5. Ready 语义

### Light Ready

- `grok` 可执行；
- `grok --version` 有界成功；
- canonical path、version、fingerprint；
- 启动检查关闭 auto-update；
- 不发模型请求。

### Product Ready

建议同一 validator 要求：

1. initialize；
2. advertised auth method 可选择；
3. authenticate 成功；
4. `session/new` 返回非空 Session ID；
5. Runtime advertisement 中的 model/mode/permission/MCP capability 可解析；
6. Session response 后异步窗口收敛；
7. Host 可有界 shutdown 和进程树清理。

Availability Check 可以完成 authenticate 和 `session/new` 而不发送模型 Prompt。它不能因此声明 command output、resume、MCP、Skill 或 Usage 已完成行为资格。

## 6. 核心能力矩阵

| 能力 | Runtime evidence | Rovai implementation | 边界说明 |
| --- | --- | --- | --- |
| Dynamic model catalog | Unverified | NotImplemented | 官方有 models 命令；ACP catalog shape 未冻结 |
| Permission / mode catalog | DocumentationOnly | NotImplemented | Ask/Auto/Always-approve + allow/deny |
| Structured Tool lifecycle | Unverified | NotImplemented | 必须记录标准 update 和稳定 ID |
| Approval allow / deny | DocumentationOnly | NotImplemented | Ask 模式候选；需真实 option ID 与副作用 Smoke |
| Cancellation | DocumentationOnly | NotImplemented | ACP cancel 需终态和迟到通知验证 |
| Reliable final boundary | Unverified | NotImplemented | Prompt response + bounded notification quiescence 候选 |
| External MCP | DocumentationOnly | NotImplemented | stdio/HTTP 官方支持；per-Run Session 注入需 Probe |
| Rovai managed Skill | DocumentationOnly | NotImplemented | `.grok/skills` / `.agents/skills` |
| Runtime advertised commands | Unverified | NotImplemented | Skill slash command存在；ACP update 未确认 |
| Compaction signal | NotObserved | Disabled | 未发现官方 ACP structured lifecycle |
| Usage / Token / Cache / Cost | Unverified | Disabled | 参考实现看到 `_meta.usage/cost`，官方未冻结 |

## 7. Skill、MCP、Permission

### Skill

项目候选：

```text
<repo>/.grok/skills/<name>/SKILL.md
<repo>/.agents/skills/<name>/SKILL.md
```

需要证明 cold/warm/new/load 时机，以及是否有 ACP available-command update。Grok 还会读取 Claude Code 兼容目录；Rovai 不应依赖这一兼容层作为 managed Skill 真源。

### MCP

官方支持：

- stdio；
- HTTP；
- User/Project scope；
- namespaced tool。

Rovai 要求：

- 优先 Session-level per-Run 注入；
- 若只能使用 `.grok/config.toml`，则建立受管项目 overlay；
- A/B MCP 集合不复用不兼容 Session；
- 不写用户 `$GROK_HOME`；
- MCP OAuth/header 不进入公开事件；
- Built-in `rovai` stdio Server 通过真实调用验证。

### Permission

- 不以 `--always-approve` 作为唯一运行模式；
- 默认 Ask，响应 Runtime request；
- deny 规则优先；
- highest-authority descriptor 只有在真实 `always-approve` 行为和 read-only 收窄通过后启用；
- Project permission config 不能静默扩大用户已保存权限。

## 8. Command Output、Usage 与 Compaction

### Command Output

固定 marker：

```text
printf 'ROVAI_GROK_COMMAND_OK\n'
```

必须验证：

- Tool ID stable；
- start/progress/terminal；
- marker 进入 Action output；
- 空输出命令保留 input；
- stderr/non-zero/large output；
- Prompt response 后延迟到达的 terminal Tool update 不被截断；
- notification quiet window 有明确上限，App shutdown 不挂住。

### Usage / Cost

非合同参考实现表明 Prompt terminal 可能携带：

- model ID；
- input/output/cache buckets；
- Provider 计算的 cost。

正式接入前必须确认：

- method/path 和 exact version；
- scope 是 model-call、turn、session 还是 gauge；
- source identity；
- reasoning 是否包含在 output；
- cache read/write 语义；
- Provider cost 的 amount/currency/单位；
- 200K+ context surcharge 是否已经包含。

在此之前：

```text
Runtime evidence: Unverified
Rovai implementation: Disabled
```

### Compaction

接入前，官方公开 headless/ACP 文档没有给出结构化 compaction lifecycle，因此当时不能用 Skill、Hook 或文本
提示替代 Runtime signal：

```text
接入前 Runtime evidence: NotObserved
接入前 Rovai detector: Disabled
```

后续对目标二进制源码与真实 `grok --no-leader agent stdio` 的 debug-arm Probe 找到并验证了 direct live wire：
无 request ID 的 `_x.ai/session_notification`，`params.sessionId` 为 exact Session ID，
`params.update.sessionUpdate=auto_compact_completed`，`params._meta.eventId` 为稳定 occurrence identity。产品只
准入这一完成态与非负 `tokens_after`，拒绝 started/failed/cancelled/replay/nested/unknown；不使用 token、summary
或模型文本猜测。真实 Core 两轮 smoke 证明 revision 1 在下一次输入中 accepted 并 ACK。

```text
当前 Runtime evidence: Verified（0.2.118 / macOS arm64）
当前 Rovai detector: Implemented / best_effort
当前 Usage/Cost: Unverified / Disabled
```

## 9. Windows 平台边界

```text
Install form: 官方 Windows PowerShell 安装（具体脚本/产物由安装页与实机冻结）
Actual executable: 待记录 grok.exe / shim
Native Windows or WSL: 官方页面覆盖 Windows PowerShell，目标按 Native Windows 验证
Home: %USERPROFILE%\.grok 或 GROK_HOME
Process cleanup: Windows Job Object
```

必须验证：

- PowerShell 安装后的 binary、auto-update 和替换行为；
- `grok login --device-auth`、cached token 和 `XAI_API_KEY`；
- Git/shell/tool 子进程；
- cancel/timeout/shutdown 后无残留；
- `$GROK_HOME` 隔离是否覆盖 auth、sessions、skills、plugins、hooks、SQLite；
- NTFS、路径空格、非 ASCII；
- Project `.grok/config.toml` merge/precedence。

## 10. 最小真实 Probe 计划

1. `grok --version`、`grok --help`、`grok agent --help`、`grok --no-auto-update agent stdio`。
2. initialize + auth methods + authenticate 的成功/失败矩阵。
3. Session new 后 async catalog、Idle、Prompt、terminal 后和 cancel 后完整消息面。
4. Tool marker、empty、stderr、non-zero、large output。
5. Approval：Ask allow/deny；Auto/Always-approve 只做独立行为资格。
6. Session：
   - warm same session；
   - cold `session/load`；
   - 是否存在 `session/resume`；
   - wrong/different ID；
   - Core restart；
   - replay quarantine。
7. MCP：stdio Built-in、HTTP、A/B 集合、OAuth/header 脱敏。
8. Skill：cold/warm/new/load + marker + advertised command。
9. Usage：重复通知、terminal `_meta`、cost unit、long-context。
10. Compaction：枚举所有 method/update/hook，但不预设存在。
11. Missing-Send 三件套。
12. Process cleanup 和 Windows x64 重复关键路径。

## 11. Rovai 所需改动

- 新增 `AdapterKind::GrokBuild`、Migration、图标、显示名和平台 Admission。
- 增加 Grok launch policy：`--no-auto-update agent stdio`。
- 实现 initialize authMethods → authenticate 的明确流程。
- 增加 Grok vendor extension/usage 私有解析边界。
- 为 Prompt response 后通知实现有界 quiet/drain，不等待无限 stdio。
- 单独研究 `session/load`，不从 headless `--resume` 外推。
- 实现 Ask/Auto/Always-approve descriptor 与 read-only 收窄。
- 建立 per-Run MCP/Skill compatibility。
- 新增 `smoke:grok-runtime`，覆盖 auth、output、Approval、resume、MCP、cleanup。
- 更新 Runtime Activity、monitoring eligibility、diagnostics、planned shutdown 和 compatibility register。

## 接入前决定（已由 2026-08-24 实机复核取代）

```text
Qualified capabilities: 无
Disabled capabilities: Usage/Cost、Compaction detector（接入前）
Unverified capabilities: session/load/resume、Tool output、ACP model catalog、Usage、Windows
Blocking issues: 当前二进制全消息面；精确 Session；Prompt 后迟到 notification；per-Run MCP
Recommended admission decision: not_qualified；先完成官方 ACP 的 macOS arm64 Probe，再实现 Adapter
```

## 上游来源

- https://docs.x.ai/build/overview
- https://docs.x.ai/build/cli/headless-scripting
- https://docs.x.ai/build/cli/reference
- https://docs.x.ai/build/settings
- https://docs.x.ai/build/features/permissions
- https://docs.x.ai/build/features/mcp-servers
- https://docs.x.ai/build/features/skills-plugins-marketplaces
- https://github.com/multica-ai/multica/blob/main/server/pkg/agent/grok.go
- https://github.com/deepcoldy/botmux/blob/master/src/adapters/cli/grok.ts
