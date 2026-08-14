---
title: "Rovai AI × TRAE CLI（CN）运行时接入 Research Brief"
status: "pre-implementation"
reviewed_at: "2026-08-14"
target_repo: "murray17/rovai-ai"
target_adapter: "trae-cn-cli"
intended_reader: "Codex / implementation agent"
---

# Rovai AI × TRAE CLI（CN）运行时接入 Research Brief

> 这是一份给实现 Agent 的开工上下文，不是 TRAE CLI 的完整产品说明。
>
> 目标是让 Codex 在开始修改代码前，先知道：哪些事实已经确认、哪些行为必须通过实机 Probe 验证、Rovai 哪些模块是权威边界，以及什么情况下应停止集成而不是“先兼容再说”。

## 0. 使用方式

Codex 开工前应依次完成：

1. 阅读本文件的“已确认事实”“未知项”和“兼容性门槛”。
2. 在本机可用的 TRAE CLI CN 企业版上采集 Probe 资料。
3. 先让 Runtime Discovery 和 Capability Probe 能正确区分 `ready / authentication_required / incompatible / probe_failed`。
4. Probe 通过后再接 AgentRun、审批、MCP、会话复用和 UI。
5. 遇到本文件列出的 Blocker 时停止，不得用文本解析、默认 `--yolo`、静默降级或伪造 Capability 绕过。

本次 Research **没有在真实 TRAE 企业账号和 TRAE CLI 二进制上完成端到端实测**。除“产品存在”“外部 ACP Client 使用的启动命令”“Rovai 当前代码结构”之外，TRAE 的权限、MCP、Session、模型与取消行为均应视为待验证。

---

# 1. 推荐决策

## 1.1 接入形态

将 TRAE CLI CN 作为 Rovai 的一个原生 ACP Runtime Adapter：

```rust
AdapterKind::TraeCnCli
```

建议序列化名称：

```text
trae-cn-cli
```

建议产品显示名：

```text
TRAE CLI（中国企业版）
```

不要在第一版使用泛化的 `TraeCli`。当前研究对象是中国区企业 CLI；未来国际版即使提供 CLI，也可能拥有不同的命令、鉴权、租户策略、模型目录、MCP 策略和 ACP 方言。

## 1.2 传输与协议

```text
Transport:  stdio
Protocol:   ACP v1
Command:    traecli acp serve
```

Rovai 已有通用 ACP Host，不应为 TRAE 新建专用 Transport。

## 1.3 第一版保守策略

| 能力 | 第一版建议 |
|---|---|
| Public output | `ExplicitSendOnly` |
| Missing-send recovery | 先 `Disabled`；证明 TRAE final boundary 可靠后再启用 |
| Host warm reuse | 先禁用 / Run 完成后 retire；多 Session 隔离通过后再复用 |
| Model selection | 先只支持 `runtime_default`；从真实 Session Config Options 发现后再开放 |
| Permission mode | 不默认 `--yolo`；必须优先验证结构化 Permission Request |
| MCP | 未完成真实 additive-per-run 测试前不得标记支持 |
| Skill discovery | 未确认目录和格式前返回空/未验证，不写入猜测的目录 |
| Session recovery | 未证明 `load/resume` 前按“不支持原生恢复”处理 |
| Compaction hook | 第一版不注入 TRAE 私有 Hook |
| Client terminal | Rovai 当前声明 `terminal: false`；TRAE 不得依赖 Client Terminal |

---

# 2. 证据台账

## 2.1 已确认

| 事实 | 证据等级 | 对实现的含义 |
|---|---|---|
| TRAE CN 企业产品提供 CLI 形态，并用于批处理、自动化和 CI/CD | 官方产品页 | 当前目标应限定为 CN 企业版 CLI |
| 外部 ACP Client `acpx` 将 TRAE 注册为原生 ACP Agent | 第三方公开实现 | TRAE 至少被公开生态当作 ACP Server 使用 |
| `acpx` 使用 `traecli acp serve` 启动 TRAE | 第三方公开实现 | 可作为 Rovai 命令构造的初始候选 |
| Rovai 当前 Adapter 是编译期注册，不是动态插件 ABI | Rovai main | 必须同步修改 Rust、TS 合同、Catalog、Probe、测试和迁移 |
| Rovai 已有通用 ACP v1 Host | Rovai main | TRAE 应复用 `health.rs` + `acp.rs` 的 ACP 路径 |
| Rovai ACP 初始化声明 Client FS 可配置、Client Terminal 为 false | Rovai main | 若 TRAE 强依赖 ACP Client Terminal，当前不能直接接入 |
| Rovai 当前 ACP Runtime 参考包括 Qoder、Qwen Code、CodeBuddy、Kiro 等 | Rovai main | 优先复制原生 ACP Adapter 的模式，而不是 Codex/Claude 专用路径 |

## 2.2 有线索、但不能当作合同

| 线索 | 用途 | 限制 |
|---|---|---|
| 社区样本显示 `trae-cli version 0.120.42` | 版本输出解析样本 | 不是版本稳定性保证 |
| 社区样本显示企业邮箱登录、tenant security、MCP whitelist | 提醒鉴权与企业策略可能影响 Ready 判定 | 社区帖子不能替代官方协议和实机 Probe |
| TRAE 交互 CLI 中存在 `/model` 等能力 | 提醒模型选择可能存在 | 不代表 ACP 暴露 `models` 或 `session/set_config_option` |
| 某些第三方 Host 可能添加 `--yolo` | 解释无 TTY 环境的常见绕过 | 不适合作为 Rovai 的默认安全策略 |

## 2.3 未确认，必须 Probe

- `initialize` 是否稳定协商 ACP v1。
- stdout 是否只输出逐行 JSON-RPC，日志是否全部走 stderr。
- 未登录时返回什么错误、退出码和可识别诊断。
- `session/new` 是否接受 `cwd`、`mcpServers` 和额外 workspace roots。
- Prompt 是否拥有可靠的接受信号、流式更新和终态。
- Tool Call 是否有稳定 ID，输入、状态、结果是否可关联。
- 写文件或执行命令时，是否通过 ACP 发出结构化 Permission Request。
- 用户拒绝 Permission 后，TRAE 是否停止对应动作且不伪报成功。
- `session/cancel` 是否真正停止模型、工具和待审批动作。
- 是否支持 `session/load`、`session/resume`、`session/list`、`session/close`。
- 是否提供 Session Config Options / model category，以及如何切换模型。
- Client 传入 MCP 后，是 additive、覆盖还是被企业白名单拒绝。
- 多 Session 共用一个 Host 时，cwd、MCP、权限、模型和上下文是否串线。
- 进程退出后的原生 Session ID 是否仍有效。
- TRAE 是否要求 Client Terminal；若要求，当前 Rovai 是 Blocker。
- TRAE 的 Skill、自定义 Agent、Commands 目录和格式是否稳定、是否适合由 Rovai 投影。

---

# 3. 上游资料索引

## 3.1 TRAE 官方与官方社区

- 企业产品页：<https://www.trae.cn/enterprise>
  - 确认 CLI 是企业产品形态；当前页面使用“TraeCode CLI”命名。
- 官方文档入口：<https://docs.trae.cn/>
- 旧 CLI 入口：<https://docs.trae.cn/cli>
  - 截至 2026-08-14 返回 404，不可作为唯一实现依据。
- 企业账号登录样本：<https://forum.trae.cn/t/topic/44307>
- tenant security / MCP whitelist 日志样本：<https://forum.trae.cn/t/topic/13207>

社区内容仅用于发现风险和构造测试，不应被编码成稳定合同。

## 3.2 ACP 官方资料

文档总索引：<https://agentclientprotocol.com/llms.txt>

本次只需要阅读 ACP v1：

- Initialization  
  <https://agentclientprotocol.com/protocol/v1/initialization>
- Authentication  
  <https://agentclientprotocol.com/protocol/v1/authentication>
- Session Setup  
  <https://agentclientprotocol.com/protocol/v1/session-setup>
- Prompt Turn  
  <https://agentclientprotocol.com/protocol/v1/prompt-turn>
- Tool Calls  
  <https://agentclientprotocol.com/protocol/v1/tool-calls>
- Cancellation  
  <https://agentclientprotocol.com/protocol/v1/cancellation>
- File System  
  <https://agentclientprotocol.com/protocol/v1/file-system>
- Terminals  
  <https://agentclientprotocol.com/protocol/v1/terminals>
- Session Config Options  
  <https://agentclientprotocol.com/protocol/v1/session-config-options>
- Session Modes  
  <https://agentclientprotocol.com/protocol/v1/session-modes>
- Session List / Close / Resume  
  从 `llms.txt` 中进入对应 v1 页面。

ACP v2 已有 Draft 文档，但 Rovai 当前 Host 明确使用 v1；本任务不要顺手迁移协议版本。

## 3.3 外部实现参考

- `openclaw/acpx` TRAE 说明：  
  <https://github.com/openclaw/acpx/blob/main/agents/Trae.md>
- `openclaw/acpx` Agent Registry：  
  <https://github.com/openclaw/acpx/blob/main/src/agent-registry.ts>
- `openclaw/acpx` README：  
  <https://github.com/openclaw/acpx>

外部实现只能证明启动入口和生态使用方式，不能证明 Rovai 所需的审批、MCP、取消、恢复和证据合同全部成立。

---

# 4. 实机 Probe 包

建议在仓库中建立但不提交敏感数据：

```text
docs/research/trae-cli-runtime/probe/
├── environment.md
├── version.txt
├── help.txt
├── acp-help.txt
├── initialize.json
├── session-new.json
├── prompt-transcript.jsonl
├── permission-allow-transcript.jsonl
├── permission-deny-transcript.jsonl
├── cancel-transcript.jsonl
├── mcp-transcript.jsonl
├── multi-session-transcript.jsonl
├── recovery-transcript.jsonl
└── findings.md
```

## 4.1 基础命令

先记录：

```bash
command -v traecli
traecli --version
traecli --help
traecli acp --help
traecli acp serve --help
```

采集字段：

- OS、架构、安装方式；
- 可执行文件绝对路径；
- 版本、build date、build commit；
- stdout / stderr 分布；
- 未登录与已登录的退出码；
- 是否存在非交互式 auth status 命令；
- 是否需要企业租户、白名单或浏览器登录。

## 4.2 ACP 最小探测

按 Rovai 当前请求形态发送：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientCapabilities": {
      "fs": {
        "readTextFile": true,
        "writeTextFile": true
      },
      "terminal": false
    },
    "clientInfo": {
      "name": "rovai_probe",
      "title": "Rovai AI Runtime Probe",
      "version": "probe"
    }
  }
}
```

随后至少实际执行：

```text
session/new
session/prompt（普通回答）
session/prompt（读文件）
session/prompt（触发写文件或命令）
permission allow
permission deny
session/cancel
```

不要只检查 `initialize` 和 `session/new` 是否返回成功。

## 4.3 MCP 行为验证

创建一个一次性测试 MCP Server，只暴露一个无副作用工具，例如：

```text
rovai_probe.echo({ value }) -> { echoed: value, nonce }
```

要求：

1. 仅通过该 AgentRun 的 `session/new.mcpServers` 注入。
2. Prompt 明确要求 TRAE 调用该工具并回传 nonce。
3. 同一 Host 的另一个 Session 不注入该 MCP，并验证不可见。
4. 与用户已有同名 MCP 测试冲突策略。
5. 企业 MCP whitelist 拒绝时，Probe 应返回可理解的 `missing_capabilities` 或 policy diagnostic，而不是 Ready。

仅仅 `session/new` 接受 `mcpServers` 字段，不足以证明 `mcp.additive_per_run`。

## 4.4 脱敏规则

不得提交：

- access token、cookie、企业邮箱；
- tenant ID、内部域名、私有 MCP URL；
- 本机用户名和完整 HOME 路径；
- 私有仓库正文；
- Runtime 输出中的密钥和环境变量。

可以保留：

- 方法名、Capability；
- ID 的一致性关系；
- 状态变迁；
- 错误类别；
- 经过替换的路径和标识符。

---

# 5. 兼容性门槛

## 5.1 必须通过，否则停止正式接入

| 门槛 | 通过标准 |
|---|---|
| ACP 协议卫生 | stdout 为合法逐行 JSON-RPC；非协议日志不污染 stdout |
| ACP v1 初始化 | 明确返回 `protocolVersion: 1` |
| Session | `session/new` 返回稳定 `sessionId` |
| Prompt 终态 | 每次 Prompt 有可证明的完成、取消或失败边界 |
| Cancel | `session/cancel` 能停止模型和正在执行的工具 |
| Tool Call 关联 | Tool Call 有稳定 ID，输入、状态和结果可关联 |
| 结构化审批 | 风险动作能回到 Rovai Approval；拒绝后不执行 |
| Workspace 隔离 | 不越过 Rovai 指定的 cwd / roots |
| 进程退出语义 | 异常退出不得被标成正常完成 |

以下任一情况都是 Blocker：

- 只有 TTY 文本询问，没有 ACP Permission Request；
- Cancel 只关闭 UI、不停止工具；
- 无稳定 Tool Call ID，只能靠文本猜；
- Runtime 必须调用 ACP Client Terminal，而 Rovai 声明 `terminal: false`；
- stdout 混入 banner、进度条或日志，无法可靠解析；
- Prompt 没有可信终态。

## 5.2 可降级但必须如实表达

| 能力 | 可接受的第一版降级 |
|---|---|
| Session load/resume | 不支持原生恢复；新建 Session 并由 Rovai Context 重建 |
| Model selection | 只提供 Runtime Default |
| Skill discovery | 不投影原生 Skill |
| Host reuse | 每个 Run 使用新 Host 或完成后 retire |
| Compaction hook | 不支持 Runtime 原生压缩观察 |
| Session list/close | 不展示原生历史；通过进程生命周期释放资源 |

## 5.3 不能静默降级

- Permission 不可用时改成 `--yolo`。
- MCP 被企业策略拒绝后假装工具可用。
- 目标模型不可选时静默使用另一个模型。
- Session 恢复失败后伪装成同一原生会话。
- TRAE 进程崩溃后把最后一段文本当作成功 final。
- Tool Call 无证据时生成虚假的 Action 记录。

---

# 6. Rovai 代码地图

## 6.1 P0：一定要阅读，基本一定会修改

| 文件 / 模块 | 关注内容 |
|---|---|
| `packages/contracts/src/index.ts` | TS `AdapterKind`、Runtime Catalog、Capability、模型与权限合同 |
| `crates/rovai-core/src/agent_profile.rs` | Rust `AdapterKind`、`as_str`、命令名、显示名、`uses_acp`、环境变量、输出策略 |
| `crates/rovai-core/src/agent_runtime_adapter.rs` | Adapter Policy、默认权限、Capability Snapshot、Skill/MCP 投影、Runtime Resolution |
| `crates/rovai-core/src/runtime_discovery.rs` | PATH、Login Shell、Known Location、版本、指纹、手动路径 |
| `crates/rovai-core/src/health.rs` | ACP Probe、启动参数、Ready/Auth/Missing Capabilities 分类 |
| `crates/rovai-core/src/acp.rs` | 实际进程启动、initialize、Session、Prompt、消息、审批、取消、MCP 与退出 |
| 数据库 migrations / fixtures | Adapter 字符串约束、旧数据兼容、契约 Fixture |

建议先运行：

```bash
rg "AdapterKind" crates packages apps
rg "QoderCli|QwenCode|CodebuddyCli|KiroCli" crates packages apps
rg "additive_acp_mcp_verified|acp_required_capabilities|configure_acp_command" crates
rg "PublicOutputMode|MissingSendRecoveryMode" crates
```

## 6.2 P1：Probe 结果决定是否修改

| 模块 | 触发条件 |
|---|---|
| `runtime_resolution.rs` | TRAE 需要独立兼容键或 Host 配置摘要 |
| `runtime_fleet.rs` | 决定 Host 是否可复用、何时 retire |
| `runtime.rs` | Prompt/Run 生命周期或终态有 TRAE 特殊行为 |
| `runtime_mcp.rs` / `mcp_projection.rs` | 需要特殊 MCP 配置、同名策略或企业白名单诊断 |
| `action.rs` | TRAE Permission / Tool Call 形态需要映射 |
| `runtime_activity_mapping.rs` | TRAE 的 ACP 更新需要活动语义映射 |
| `builtin_tool_evidence_projection.rs` | 工具输入和结果字段与现有映射不同 |
| `skill_projection.rs` | 官方确认 Skill / Agent 目录和格式后 |
| `compaction.rs` / `acp.rs` Hook 分支 | TRAE 提供稳定压缩信号后 |

## 6.3 P2：Core 兼容后再处理

```text
RuntimeInstallationsPanel
MembersView
DiagnosticsCenter
App.tsx
Renderer tests
Contract fixtures
Core integration tests
Runtime docs
```

UI 不应新增 TRAE 专属页面。复用现有 Runtime 安装、成员配置和诊断入口，只增加真实的 Catalog、状态、模型、权限和修复文案。

---

# 7. Rovai 当前实现中需要特别警惕的点

## 7.1 当前 ACP Probe 有“推断能力”倾向

现有 `acp_observed_capabilities` 在拿到 `session/new` 后，会把 `session.prompt`、`session.cancel`、`session.update`、`structured_permission_request`、`workspace.additional_roots` 和配置能力加入观察结果。

对成熟的已验证 Adapter 可以接受，但对新 TRAE Adapter 不够严格。TRAE 必须增加行为 Probe，不能因为 `session/new` 成功就宣告审批和取消可用。

## 7.2 `include_session` 与 additive MCP 白名单存在耦合

当前 `acp_capability_probe_at` 的 Session 深度可能由 `additive_acp_mcp_verified(kind)` 间接决定。新增 TRAE 时不要直接把它加入“已验证 additive MCP”白名单来换取 Probe 通过。

推荐调整：

```text
是否执行 session/new 深度探测
与
是否已经验证 additive per-run MCP
```

拆成两个独立事实。

## 7.3 MCP 白名单是声明，不是证据

把 `TraeCnCli` 加进 `additive_acp_mcp_verified` 前，必须完成：

```text
session/new 注入测试 MCP
→ Prompt 成功调用
→ 未注入 Session 不可见
→ 同名策略明确
→ 下一 Run 不泄漏
```

## 7.4 配置能力不能靠 Session 存在推断

非 Kiro Adapter 当前通常被映射为 `session.set_config_option`。TRAE 是否支持这一方法、模型是否以 Config Option 暴露，都必须从真实响应和方法调用证明。

未证明前：

```text
model = runtime_default
permission options = empty / unsupported
```

## 7.5 不要过早启用 Missing-send Recovery

所有现有 shipped Adapter 都有各自测试过的 final boundary。TRAE 第一版应先：

```rust
PublicOutputMode::ExplicitSendOnly
MissingSendRecoveryMode::Disabled
```

只有当真实 Prompt transcript 能证明 TRAE 的 final message 与 Prompt terminal 边界稳定、无重复、无中间文本误判时，才改为 `IfNoAcceptedSend`。

## 7.6 不要过早启用 Warm Host Reuse

即使 TRAE 能在一个进程中开多个 Session，也必须验证：

- cwd 不串；
- MCP 不串；
- 模型和模式不串；
- 企业策略状态不污染；
- Session 关闭后资源释放；
- 一个 Session 取消不影响另一个。

第一版可选择保守 retire，之后再打开复用。

---

# 8. 参考 Adapter

## 8.1 主参考

```text
QoderCli
QwenCode
CodebuddyCli
```

它们与 TRAE 最接近：原生 ACP、共享 Host、配置参数、MCP 投影和 Runtime Fleet。

优先比较：

- `configure_acp_command`
- `acp_capability_snapshot`
- Permission descriptors
- `configure_runtime_command`
- MCP 注入
- Host release disposition
- Tool Call / Permission 映射

## 8.2 条件参考

```text
KiroCli
```

只有在 TRAE 需要私有 HOME、自定义 Agent 文件或特殊工作目录时参考 Kiro 的隔离逻辑。

## 8.3 不作为主模板

```text
CodexCli
ClaudeCodeCli
AntigravityApp
```

它们使用专用 app-server、print-mode 或伴随进程，不代表 TRAE 的通用 ACP 集成方式。

---

# 9. 推荐实现顺序

## Phase 0：采集真实行为

- 获取合法的 TRAE CN 企业账号和安装包。
- 生成第 4 节的脱敏 Probe 包。
- 完成兼容性矩阵。
- 对 Blocker 作出 go / no-go 决策。

**没有 Probe 包，不开始正式 Runtime 集成。**

## Phase 1：Catalog 与 Discovery

- Rust / TS 增加 `TraeCnCli`。
- 增加 `trae-cn-cli` 序列化。
- 命令名初始为 `traecli`。
- 环境覆盖变量建议：`ROVAI_TRAE_CN_BIN`。
- 接入 Runtime Catalog、安装发现、版本和指纹。
- 增加 DB / Fixture / Exhaustive Match 测试。

此阶段不得把 Runtime 标记为 Ready。

## Phase 2：TRAE 专用 Behavioral Probe

- 启动 `traecli acp serve`。
- 验证 ACP v1、Session、Prompt、Cancel、Permission 和协议卫生。
- 区分未安装、未登录、企业策略拒绝、能力缺失、协议不兼容和普通启动失败。
- 只根据真实行为写 Capability Snapshot。

## Phase 3：最小 AgentRun

仅在 Phase 2 通过后：

- 接入正式 ACP Host；
- `runtime_default` 模型；
- 不启用 Skill；
- 不启用 warm reuse；
- 不启用 missing-send recovery；
- Public output 保持 `ExplicitSendOnly`；
- 验证普通回答、文件读取、写入审批、拒绝、取消和异常退出。

## Phase 4：MCP、模型、恢复与复用

每项独立解锁：

1. additive MCP；
2. Session Config Options / model；
3. load/resume；
4. Host reuse；
5. missing-send recovery；
6. Skill / Agent 投影；
7. compaction observation。

不要把这些能力打包成一次“大适配”。

## Phase 5：产品化

- Runtime Installations 显示 TRAE CN；
- 成员可选择该 Runtime；
- Diagnostics 显示真实 blocker；
- 登录修复文案只使用已确认命令；
- 增加 Experimental / 兼容版本说明；
- 完成文档和回归测试。

---

# 10. 验收测试矩阵

## 10.1 Discovery / Probe

- PATH 中存在 `traecli`。
- Login Shell 才能发现 `traecli`。
- 环境变量覆盖路径。
- 路径失效、文件替换、指纹变化。
- `--version` 超时、失败、stderr 输出。
- 未登录被分类为 `authentication_required`。
- 企业 MCP policy 错误被分类为 policy / missing capability，而不是 Ready。
- stdout banner 污染导致 incompatible。

## 10.2 ACP 生命周期

- initialize 成功和版本不匹配。
- session/new 成功和失败。
- Prompt accepted。
- 流式 Agent Message。
- 正常完成、模型失败、工具失败、进程崩溃。
- cancel 在思考中、工具中、等待审批时。
- 一个 Session 的取消不影响另一个。

## 10.3 Approval / Action

- 读取动作无需错误地升级为危险审批。
- 写文件触发结构化审批。
- Shell 命令触发结构化审批。
- 用户拒绝后不执行。
- 用户允许后只执行一次。
- 重复 Tool Update 不创建重复 Action。
- Permission Request 缺少必要关联 ID 时拒绝接入，不猜测。

## 10.4 MCP / 隔离

- 单 Run 注入测试 MCP。
- 下一 Run 不继承。
- 同一 Host 的其他 Session 不可见。
- stdio MCP 与 HTTP MCP 分别测试。
- 同名策略固定且有测试。
- 企业白名单拒绝时不静默丢失。

## 10.5 模型 / 配置

- 没有模型能力时只显示 Runtime Default。
- 有模型 Config Option 时从 Runtime 返回生成目录。
- 选择失败不静默回落。
- Session 级配置不污染其他 Session。

## 10.6 输出与恢复

- Runtime final 不直接绕过 `camp.message.send` 发布公共消息。
- Missing-send recovery 默认关闭。
- 开启 recovery 前验证 final 唯一性和稳定性。
- 不支持原生恢复时明确建立新 Session。
- 恢复失败不得伪装成功。

---

# 11. Codex 开工说明（增强版，可直接复制）

```text
任务：
在 Rovai AI 中新增 TRAE CLI 中国企业版 Runtime Adapter。

目标 Adapter：
- Rust: AdapterKind::TraeCnCli
- Wire value: trae-cn-cli
- Display name: TRAE CLI（中国企业版）
- Executable candidate: traecli
- ACP server command: traecli acp serve
- Protocol target: ACP v1 over stdio

架构约束：
1. 基于现有 Qoder/Qwen/CodeBuddy 的通用 ACP 路径。
2. 不新增 TRAE 专属 Transport。
3. 不迁移 Rovai 到 ACP v2。
4. PublicOutputMode 必须保持 ExplicitSendOnly。
5. MissingSendRecoveryMode 第一版设为 Disabled；只有真实 final boundary 测试通过后才启用。
6. 第一版禁止 warm Host reuse；只有多 Session 隔离测试通过后才启用。
7. 不默认使用 --yolo，也不通过文本 TTY 提示模拟结构化 Approval。
8. 不静态写死模型、Skill 路径、Session 恢复、MCP 或 Permission Capability。
9. 所有 Capability 必须来自真实 Probe 或明确的、测试覆盖的 Adapter 合同。
10. 不修改用户已有 TRAE 配置；需要隔离时使用 Rovai 私有临时目录。

开始编码前：
1. 阅读 docs/research/trae-cli-runtime/ 下的资料和脱敏 Probe。
2. 检查 initialize、session/new、普通 prompt、工具调用、permission allow/deny、cancel、MCP 和多 Session transcript。
3. 先列出已证明 Capability、未证明 Capability 和 Blocker。
4. 如果没有真实 TRAE binary/企业账号或 Probe 资料，只完成可安全完成的 Catalog/Discovery/Probe scaffolding，不宣告 Runtime Ready。

实现顺序：
A. 扩展 Rust/TS AdapterKind、Catalog、wire value、display name、command name、env override、DB/fixtures。
B. 接入 Runtime Discovery 和 --version。
C. 实现 TRAE 专用 behavioral ACP probe；不要仅凭 session/new 推断 cancel、permission、config 或 MCP 能力。
D. Probe 通过后接入最小 AgentRun：runtime_default、无 Skill、无 warm reuse、无 missing-send recovery。
E. 分别验证并解锁 additive MCP、模型配置、原生恢复、Host reuse、final recovery。
F. 最后更新 Runtime UI、Diagnostics、文档与集成测试。

必须关注的 Rovai 文件：
- packages/contracts/src/index.ts
- crates/rovai-core/src/agent_profile.rs
- crates/rovai-core/src/agent_runtime_adapter.rs
- crates/rovai-core/src/runtime_discovery.rs
- crates/rovai-core/src/health.rs
- crates/rovai-core/src/acp.rs
- crates/rovai-core/src/runtime_fleet.rs
- crates/rovai-core/src/runtime.rs
- crates/rovai-core/src/action.rs
- crates/rovai-core/src/runtime_mcp.rs
- crates/rovai-core/src/mcp_projection.rs
- crates/rovai-core/src/skill_projection.rs
- DB migrations、contract fixtures、Core/Renderer tests

主要参考 Adapter：
- QoderCli
- QwenCode
- CodebuddyCli
特殊隔离参考：KiroCli
不要以 CodexCli、ClaudeCodeCli 或 AntigravityApp 作为主模板。

需要主动修正的现有 Probe 风险：
- 深度 session probe 与 additive_acp_mcp_verified 不应耦合。
- session/new 成功不等于 session.cancel、structured_permission_request、workspace roots 或 set_config_option 已验证。
- 不得为了让 TRAE 变成 Ready，提前加入 additive MCP 白名单。

Blocker：
- stdout 不是干净 JSON-RPC；
- 无可靠 prompt terminal boundary；
- cancel 不能停止执行；
- tool call 无稳定 ID；
- 风险动作无法通过 ACP 返回结构化 permission request；
- TRAE 必须依赖 ACP Client Terminal，而 Rovai 当前 terminal=false；
- MCP 或 Session 状态跨 AgentRun 泄漏。

交付物：
1. TRAE Adapter 的最小、安全实现。
2. Probe 与 Capability Snapshot 测试。
3. Discovery、DB、Contracts、UI Catalog 和 Diagnostics 回归测试。
4. 一份实现后兼容性表，区分 verified / unsupported / deferred。
5. 不得声称未实测的 Capability 已受支持。

验证：
- 运行仓库既有格式化、类型检查、Rust/TS 单测和相关集成测试。
- 增加至少：未安装、未登录、协议不兼容、普通 prompt、permission allow/deny、cancel、MCP 隔离、进程异常退出测试。
- 在最终总结中列出实际运行的命令、通过结果、未完成的实机验证，以及是否仍保持 Experimental。
```

---

# 12. 建议交付边界

第一份 PR 最理想的范围：

```text
AdapterKind + Catalog + Discovery + Version + Behavioral Probe + Diagnostics
```

第二份 PR：

```text
最小 AgentRun + Approval + Cancel + 异常退出
```

第三份及以后：

```text
MCP → 模型配置 → Session 恢复 → Host 复用 → Missing-send Recovery → Skill/Compaction
```

这样即使 TRAE 的企业鉴权、MCP 白名单或 ACP 方言存在问题，也不会在大量 UI 和 Runtime 代码已经铺开后才发现基础合同不成立。

---

# 13. 最终兼容性记录模板

实现完成后填表：

| 能力 | 状态 | 证据 | 备注 |
|---|---|---|---|
| 安装发现 | pending |  |  |
| 版本读取 | pending |  |  |
| 企业鉴权识别 | pending |  |  |
| ACP v1 initialize | pending |  |  |
| session/new | pending |  |  |
| prompt streaming | pending |  |  |
| prompt terminal | pending |  |  |
| structured permission | pending |  |  |
| permission deny | pending |  |  |
| session/cancel | pending |  |  |
| tool-call correlation | pending |  |  |
| additional roots | pending |  |  |
| MCP stdio | pending |  |  |
| MCP HTTP | pending |  |  |
| MCP per-run isolation | pending |  |  |
| model discovery | pending |  |  |
| model selection | pending |  |  |
| session load/resume | pending |  |  |
| multi-session isolation | pending |  |  |
| warm Host reuse | deferred |  |  |
| missing-send recovery | deferred |  |  |
| Skill projection | deferred |  |  |
| compaction observation | deferred |  |  |

状态只允许：

```text
verified
unsupported
deferred
blocked
pending
```

