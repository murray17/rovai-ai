---
document_type: contract
name: Runtime Launch and Verification
version: v19
status: accepted
source_version: v1.26
last_updated: 2026-08-22
---

# Runtime Launch and Verification v19

v19 replaces [v18](runtime-launch-and-verification-v18.md). Existing launch purpose、identity fencing、Ready、
LKG、检查 attempt、Session continuation、公开 failure 与自动恢复语义保持不变；本版把 Cursor Agent
加入 closed Product Runtime Catalog，同时保持逐平台 `not_qualified`，直到完整行为证据通过。

## Cursor executable identity

Cursor 的稳定 wire identity 是 `cursor-agent`。产品优先发现官方 `cursor-agent` 可执行文件；兼容候选
`agent` 只有在有界 `--version` 输出严格匹配 Cursor `YYYY.MM.DD-<build>` build identity 后才可形成
light evidence。未通过该判定的同名程序返回 `runtime_identity_mismatch`，不能建立 Installation、Ready
或触发 ACP。环境变量覆盖键是 `ROVAI_CURSOR_BIN`。

该边界用于避免 Grok Build 等同样安装为 `agent` 的 Runtime 被误识别为 Cursor。路径、可执行内容或
fingerprint 改变后，旧 snapshot 仍按 v18 规则失效。

## Cursor ACP Host

有效 Cursor Host 的启动形态是 `<resolved-executable> acp`，传输为 newline-delimited JSON-RPC 2.0 / ACP v1。
Host 启动必须依次完成：

1. `initialize` 协商 `protocolVersion = 1`；
2. `authenticate({ methodId: "cursor_login" })` 在有界期限内成功；
3. `session/new` 返回非空 Session ID。

当前 Ready requirements 只记录 `acp.initialize`、`cursor.authenticate` 与 `session.new`。它不声明模型
动态目录、Tool、Approval、cancel、Resume、MCP、Usage 或 Compaction 已通过行为资格。

Cursor 私有阻塞 request `cursor/ask_question` 与 `cursor/create_plan` 只可路由到唯一 Active Prompt，
并继续受 Host、Session、Prompt、delivery 与 execution epoch fencing；无唯一归属时 fail closed。
当前产品分别返回 `skipped` 与 `rejected`，不把它们冒充 Tool Permission。`cursor/update_todos`、
`cursor/task`、`cursor/generate_image` 保持私有，不产生 Activity、Narration、Final、Usage 或 Compaction。
未知 `cursor/*` request 返回 JSON-RPC `-32601`。

## 配置与收窄

Cursor 静态权限 shape 为：

```text
execution_mode = agent | plan | ask
approval_policy = default | auto_review | force
```

`execution_mode` 映射 `--mode`；`auto_review` 与 `force` 分别映射 `--auto-review`、`--force`。Core-enforced
read-only workspace 强制 `--mode plan` 且移除自动审批/强制执行参数。附件授权根与每 Run 临时目录通过
`--add-dir` 注入；Cursor `session/new` 不接收尚未验证的 `additionalDirectories` 扩展字段。

External MCP、History Restore、Missing-Send Recovery、Usage 与 Compaction detector 均保持 Disabled。
Rovai managed Skill 可以投影到项目 `.cursor/skills`，但 Runtime load/invocation 仍为 DocumentationOnly，
不能成为平台准入证据。

Cursor Host 不跨已完成 AgentRun 进入 warm reuse。terminal 可持久可见前先停止 Host；planned shutdown、
Camp 删除与 App shutdown 都必须覆盖 Cursor Host 和进程树。

## 平台准入

`cursor-agent` 在 macOS arm64、macOS x64 与 Windows x64 均为
`not_qualified / runtime_platform.qualification_evidence_missing`，不产生 discovery、Installation、成员配置、
Availability Check、诊断机器状态或 AgentRun 动作。Catalog 可见不等于当前平台可执行。

至少完成 authenticate、Session、固定 command output、allow/deny、cancel、private requests、terminal、
process cleanup、Built-in CLI 以及声明的 continuation 策略真实 Smoke 后，才可用新的 digest-bound evidence
revision 把一个平台改为 `qualified`。

## Acceptance

- `cursor-agent` 和经严格 build identity 验证的 `agent` 都可解析为同一产品；无关 `agent` 被拒绝；
- launch argv、read-only 收窄、附件/Run tmp 授权与 External MCP 拒绝有确定性测试；
- private request 唯一 Prompt 路由、private notification 隔离和未知 request `-32601` 有 fixture；
- Cursor completion 后回收 Host，并进入 Camp 删除、planned shutdown 与 App shutdown 集合；
- closed Adapter、Skill group、Migration、Activity registry 与 Renderer catalog 各恰有一个 Cursor identity；
- 平台未准入时不执行 discovery、Probe、配置或 AgentRun，UI 不把 macOS 的阻断误写为 Windows 状态。

## References

- [Runtime Launch and Verification v18](runtime-launch-and-verification-v18.md)
- [Runtime Platform Admission v1](runtime-platform-admission-v1.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Cursor Agent Runtime Research](../research/cursor-agent-runtime-research.md)
- [V1.26-D01](../versions/v1.26/decisions.md#v1-26-d01)
