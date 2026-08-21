---
document_type: runtime-research
runtime: kimi-code-cli
upstream: MoonshotAI/kimi-code
authority: research-evidence-only
status: proposed
admission: not_qualified
last_updated: 2026-08-20
---

# Kimi Code CLI Runtime 接入研究

> 本文按 [`runtime-integration-checklist.md`](https://github.com/murray17/rovai-ai/blob/main/docs/development/runtime-integration-checklist.md) 整理。
> 这是接入前研究，不是平台准入证据；任何 `qualified` 结论仍需要目标安装版本、目标平台和真实行为 Smoke。

## 基本结论

```text
Runtime: Kimi Code CLI
建议 AdapterKind: kimi-code-cli
上游源码快照: MoonshotAI/kimi-code main；package version 0.38.0
建议接入形态: vendor_extended_acp
Exact launch command: kimi acp
Transport: stdio / JSON-RPC 2.0 / ACP v1
当前 Admission: not_qualified
一句话结论: ACP 主面完整，适合优先接入；但 stdio MCP、真实命令输出、认证与精确恢复必须先做实机 Probe。
最接近的现有 Adapter: TRAE/Kiro ACP Host，加上 Kimi 私有 Session、Skill catalog 与交互扩展处理。
```

### 推荐决定

**进入 P0 Probe 和实现设计，但不要直接进入 Product Runtime Catalog。**

源码已经覆盖 `session/new`、`session/load`、`session/resume`、模型/模式切换、结构化 Tool、Permission、Skill command 更新和取消。主要阻断点是：

1. 当前源码与文档对 **stdio MCP** 的表述不一致；转换器测试明确拒绝 stdio Server。
2. Bash 输出可能通过 ACP Client Terminal，而不是普通 Tool Result 文本返回；必须证明 `printf` marker 能进入 Rovai 的 `runtime.action.payload.output`。
3. `session/load` 与 `session/resume` 的 replay 语义不同，必须分别实现和验证。
4. Kimi 的 Compaction 事件当前未形成可直接准入的 ACP 结构化 lifecycle。
5. Usage 目前只看到上下文使用量，不足以声明 Token/Cache/Cost 监控。

## 1. 证据边界

### 源码/文档已经确认

- `kimi acp` 使用 stdin/stdout JSON-RPC；协议 stdout 不应输出 banner，日志走 stderr/日志文件。
- `session/new` 建立 Session；`session/load` 恢复并回放历史；`session/resume` 恢复但不回放历史。
- Server 还实现 Session list、close、delete、fork、set model、set mode、config option 和 cancel。
- Tool 生命周期包含稳定 call ID、start/progress/result；Permission 和结构化提问通过客户端请求桥接。
- Skill 在项目级、用户级和额外目录扫描；Session 建立/恢复后异步发送 available-command 更新，并可响应 `skills.changed`。
- `turn.ended` 是最接近可靠 Prompt final 的上游边界。
- 当前源码把 Compaction 生命周期转换为普通 assistant 文本，而不是独立 ACP lifecycle update。
- 当前 MCP 转换器接受 HTTP/SSE，但测试明确要求 stdio MCP 抛错。

### 仍需实机证明

- 当前发布二进制是否与 main 源码一致。
- `initialize`、Session response 和异步 catalog 的精确 wire shape、到达顺序与延迟窗口。
- 登录失效、限流、配额、模型不可用和权限拒绝的结构化错误。
- 同一 Host 多 Session 是否真正并发安全；Session 是否存在进程级锁。
- `session/load`、`session/resume` 是否保持请求的精确 Session ID。
- Client Terminal、普通 Tool Result 和空输出命令的实际事件序列。
- Windows 安装产物、进程树和 Git Bash 子进程清理。
- stdio MCP 在当前发布二进制中的实际行为。

## 2. 接入形态

```text
Integration shape: vendor_extended_acp
Exact launch command: kimi acp
是否为常驻 Host: 是
一个 Host 是否支持多个 Session: 源码结构支持；真实并发仍需 Probe
依赖的私有 method/notification:
- Session list/resume/close/delete/fork
- Session config/model/mode
- available command / skill update
- 结构化 elicitation/interaction bridge
- 上下文 usage metadata
```

### Rovai Host 要求

- 启动前冻结 executable path、fingerprint、cwd、环境和 Kimi 私有数据根。
- stdout 只按 JSONL/JSON-RPC 解析；stderr 有界采集并脱敏。
- 支持 ACP Client Terminal，或明确验证 Kimi 在 `terminal=false` 时会把命令结果降级为公开文本。
- 未知 `_...` 扩展按 Runtime Checklist 私有隔离；未知标准 ACP method/variant 继续 fail closed。
- Session response 后保留有界 async catalog 窗口，不把 catalog/metadata 误投影为 Prompt output。

## 3. Session 生命周期

| 能力 | 当前研究结论 |
| --- | --- |
| `session/new` | 源码实现；返回稳定 Session ID，模型/mode 等 catalog 需保存脱敏 shape |
| 同 Host 复用原 Session | 源码可持有多个 Session；只允许 compatibility digest 完全一致时复用 |
| `session/resume` | 源码实现；目标语义是不回放历史，必须验证精确 ID |
| `session/load` | 源码实现；历史在 response 前回放，必须走 History Restore quarantine |
| Host/Core 重启后的恢复 | 优先 exact `session/resume`；需要历史投影时才使用 `session/load` |
| 恢复失败策略 | fail closed，记录 continuity lost，停止失败 Host，至多新建一个 Session |

### 推荐 Session 策略

```text
Primary: exact_resume
Secondary: history_restore（仅 session/load）
Fallback: fresh session after durable continuity-lost evidence
```

不得把 `session/load` 和 `session/resume` 合并成一个 “Resume” 分支：

- `session/load`：回放事件进入独立 quarantine，response 前不可公开。
- `session/resume`：不进入 history replay settling window；只接收普通 Session metadata/extension。
- 两者都必须返回原精确 Session ID；不同 ID 直接视为协议异常。

## 4. Host 与 Session 兼容性

| 变化 | 复用原 Session | 新 Session | 重启 Host | 加载阶段/理由 |
| --- | ---: | ---: | ---: | --- |
| Runtime version / executable | 否 | 否 | 是 | `process_start`；fingerprint 改变使 Ready 失效 |
| Model | 有条件 | 可选 | 否 | `session_set_model`；必须收到成功 ACK 并刷新 catalog |
| Permission / mode | 有条件 | 可选 | 否 | `session_set_mode/config`；schema digest 变化不可静默保留 Ready |
| MCP | 否 | 是 | 建议 | `session_new/load/resume`；已存活 Session 可能忽略新 MCP |
| Skill exposure | 仅在 live-watch 证据通过后 | 是 | 可选 | 源码有 `skills.changed`，但真实项目级刷新仍需 Smoke |
| cwd / workspace access | 否 | 是 | 可选 | Session-scoped；不得把另一工作区绑定到旧 Session |
| Attachment root | 否 | 是 | 建议 | 文件访问和 Client Terminal 授权必须冻结 |
| Per-Prompt input/context | 是 | 否 | 否 | `per_prompt`；每次 Prompt 按 delivery/execution epoch 重建 |

特别注意：源码注释显示 `additionalDirectories` 只在 `session/new` 有完整语义；`load/resume` 对该字段的处理不能按通用 ACP 猜测。

## 5. Ready 语义

### Light Ready

只证明：

- `kimi` 可执行文件存在且可执行；
- `kimi --version` 在有界时间内成功；
- 输出可识别，fingerprint 已保存。

### Product Ready

建议要求同一个 validator 验证：

1. `initialize` 成功并满足协议版本；
2. `session/new` 返回非空 Session ID；
3. 动态 model/mode/permission catalog 可解析；
4. Session response 后 async catalog 窗口收敛；
5. 当前 permission schema digest、Runtime fingerprint 和 Host config 一致；
6. Host 可有界终止和回收完整进程树。

认证如果没有独立、无模型调用的结构化检查，则：

- Availability Check 不得仅凭 `initialize/session/new` 声称 authenticated；
- 保持 `light_ready`，由用户授权的首次真实 AgentRun 在同一 Host 上建立 Ready；
- Availability Check 和 Dispatch 必须复用同一 Ready validator，不能写入较弱的 `ready`。

## 6. 核心能力矩阵

| 能力 | Runtime evidence | Rovai implementation | 边界说明 |
| --- | --- | --- | --- |
| Dynamic model catalog | DocumentationOnly | NotImplemented | 来自 Session response；需保存完整 replacement 语义 |
| Permission / mode catalog | DocumentationOnly | NotImplemented | 动态 mode/config；schema drift 必须失效 Ready |
| Structured Tool lifecycle | DocumentationOnly | NotImplemented | call ID 与 start/progress/result 已有源码路径 |
| Approval allow / deny | DocumentationOnly | NotImplemented | `session/request_permission`/interaction bridge；需真实副作用 Smoke |
| Cancellation | DocumentationOnly | NotImplemented | 需证明 cancelled final 与无延迟副作用 |
| Reliable final boundary | DocumentationOnly | NotImplemented | 候选为 `turn.ended`/Prompt response；需迟到消息窗口 |
| External MCP | Unverified | Blocked | HTTP/SSE 源码可见；stdio 转换器当前明确拒绝 |
| Rovai managed Skill | DocumentationOnly | NotImplemented | 候选项目路径 `.kimi-code/skills` 或 `.agents/skills` |
| Runtime advertised commands | DocumentationOnly | NotImplemented | Session 后异步 available-command update |
| Compaction signal | NotObserved | Disabled | 当前 ACP 转换仅产生普通 assistant 文本 |
| Usage / Token / Cache / Cost | DocumentationOnly | Disabled | 只发现 context used/max gauge；不声明标准 Token/Cost |

## 7. Skill 与异步 Catalog

```text
Managed Skill 项目路径候选:
- <repo>/.kimi-code/skills/<name>/SKILL.md
- <repo>/.agents/skills/<name>/SKILL.md

其他扫描路径:
- $KIMI_CODE_HOME/skills
- ~/.agents/skills
- extra_skill_dirs

源码中的更新面:
- Session 建立/恢复后异步 available-command update
- skills.changed 后重新发布
```

必须做五组唯一 marker Probe：

1. cold Host + new Session；
2. warm Host + 同 Session；
3. warm Host + new Session；
4. `session/resume`；
5. `session/load`。

分别记录 Skill 是否真实加载、available-command 首条到达时间、update 是 full replacement 还是 delta。Rovai 不应修改用户全局 Skill。

## 8. Command Output、Usage 与 Compaction

### Command Output

这是首要 Smoke：

- 强制模型运行 `printf 'ROVAI_KIMI_COMMAND_OK\n'`；
- 断言同一原生 Tool ID 的 started/terminal；
- marker 必须进入对应 `runtime.action.payload.output`；
- 分别测试 stdout、stderr、混合、空输出和非零退出；
- 如果输出只存在于 ACP Client Terminal，必须把 terminal 累积输出安全投影到对应 Action；
- 不能从最终回答或 workspace diff 补猜。

### Usage

当前只建议记录为未接入：

- 上下文 used/max 可作为私有诊断候选；
- 未证明 input、uncached、cache read/write、output、reasoning 和 cost 的 canonical 语义；
- 不得把 Session gauge 或上下文占用当作 AgentRun Token Usage。

### Compaction

Kimi 内部有 Compaction 生命周期，但当前 ACP 投影看起来只是普通 agent message。除非实机观察到独立、稳定、可去重的 method/update：

```text
Runtime structured-signal evidence: NotObserved
Rovai detector: Disabled
```

## 9. Windows 平台边界

```text
Install form: 官方 Windows 安装脚本；实际产物待 Probe
实际启动文件: 待记录 canonical executable / shim
Native Windows 或 WSL: 官方支持 Native Windows
Shell dependency: Git for Windows / Git Bash
Shell override: KIMI_SHELL_PATH
认证存储: KIMI_CODE_HOME（精确文件范围待脱敏 Probe）
进程树清理: Windows Job Object
```

必须验证：

- PowerShell 安装后实际 `kimi` 是 `.exe`、`.cmd` 还是 shim；
- Git Bash 子进程是否进入同一 Job Object；
- cancel/shutdown 后无 bash、node 或辅助进程残留；
- 路径含空格、非 ASCII、长路径和 NTFS 工作区；
- `KIMI_CODE_HOME` 隔离是否同时隔离认证、Session、Skill 和日志。

## 10. 最小真实 Probe 计划

1. `kimi --version`：成功、stderr、空输出、超时、非法格式。
2. `kimi acp`：完整记录 initialize 前后、Session new 后、Idle、Prompt、terminal 后、cancel 后消息面。
3. 认证：已登录、未登录、过期凭据、API 配额和模型不可用。
4. Tool：固定 `printf`、空输出、失败命令、读/写/编辑。
5. Approval：allow-once 只有一次副作用；deny 后目标文件不存在。
6. Session：
   - 同 Host 同 Session；
   - 新 Host `session/resume`；
   - 新 Host `session/load`；
   - 错误 ID、返回不同 ID、非法 replay、超限 replay。
7. MCP：
   - stdio Built-in Tool；
   - HTTP/SSE；
   - A/B Server 集合隔离；
   - 相邻未配置 Session 不可见。
8. Skill：cold/warm/new/resume/load 五组 marker。
9. Missing-Send：zero-send、accepted-send suppression、tool→final。
10. Process cleanup：正常、错误、cancel、Probe timeout、App shutdown。
11. Windows：Native x64 完整重复上述关键路径。

## 11. Rovai 所需改动

- 新增 `AdapterKind::KimiCodeCli`、Migration、显示名、图标和逐平台 Admission。
- 增加 Kimi ACP launch policy、认证目录/私有数据根和 capability parser。
- 实现 `session/resume` 与 `session/load` 两条独立 continuation 路径。
- 增加 Kimi async catalog/Skill update reducer。
- 实现或确认 ACP Client Terminal，并建立 command-output 真实 Smoke。
- 对 Kimi interaction/elicitation 映射 durable Approval/Ask。
- 在 MCP 问题解决前，把 External MCP 和 Built-in MCP transport 标为 Blocked。
- 增加 `smoke:kimi-runtime`，并纳入 Built-in CLI、Runtime Activity、diagnostics、planned shutdown。
- 更新 `runtime-compatibility.md` 和平台 evidence revision。

## 最终决定

```text
Qualified capabilities: 无；尚未形成目标安装与平台真实证据
Disabled capabilities: Compaction detector、Usage/Cost monitoring
Unverified capabilities: 精确 Resume/Load、认证、Command Output、Windows、并发 Session
Blocking issues: stdio MCP 转换冲突；Client Terminal 输出投影；完整真实 Smoke
Recommended admission decision: not_qualified；完成 P0 Probe 后再决定 macOS arm64 首个平台准入
```

## 上游来源

- https://github.com/MoonshotAI/kimi-code
- https://github.com/MoonshotAI/kimi-code/blob/main/README.md
- https://github.com/MoonshotAI/kimi-code/blob/main/apps/kimi-code/package.json
- https://github.com/MoonshotAI/kimi-code/blob/main/docs/zh/reference/kimi-acp.md
- https://github.com/MoonshotAI/kimi-code/blob/main/packages/acp-server/src/server.ts
- https://github.com/MoonshotAI/kimi-code/blob/main/packages/acp-server/src/session.ts
- https://github.com/MoonshotAI/kimi-code/blob/main/packages/acp-server/src/interaction-bridge.ts
- https://github.com/MoonshotAI/kimi-code/blob/main/packages/acp-server/src/convert.ts
- https://github.com/MoonshotAI/kimi-code/blob/main/packages/acp-server/test/convert.test.ts
- https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/skills.md
