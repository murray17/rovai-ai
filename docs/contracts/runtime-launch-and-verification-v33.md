---
document_type: contract
name: Runtime Launch and Verification
version: v33
status: accepted
source_version: v1.39
last_updated: 2026-09-04
---

# Runtime Launch and Verification v33

v33 replaces [v32](runtime-launch-and-verification-v32.md). v32 的 Pi 独立 JSONL transport、无 Prompt Machine Ready、
External MCP `Unsupported`、private exact Session locator、Resident Host/Fleet/LRU、Final、Cancel、Usage、platform preview
与 cleanup 语义保持不变。v33 把正式 Pi Host 从 Rovai 重建的受管空壳改为 Pi 原生运行环境加薄 Rovai extension。

## 1. 正式启动与一次降级

正式 AgentRun 首次启动只能使用以下能力参数，并继续继承目标 executable 的用户 Home、Pi 配置、认证与模型：

```text
pi --mode rpc --no-themes --extension <private rovai-pi-host-v5>
```

不得追加 `--no-skills`、`--no-context-files`、`--no-prompt-templates`、`--no-builtin-tools`、`--approve` 或
`--no-approve`。Pi 自己加载 Built-in tools、用户与已信任项目的 Extensions、Skills、Context files、Prompt templates
和 Settings；Rovai 不重建完整 catalog，也不自动改变 Pi 项目信任。

若自动发现的 Extension 使第一次 Host 在任何 Prompt、steer、follow-up 或 compaction 输入前无法建立 RPC，可且只能重试
一次 `pi --mode rpc --no-extensions --no-themes --extension <private rovai-pi-host-v5>`。显式 Rovai extension 与 Pi
Built-in tools 仍保留。输入一旦可能被接受，禁止透明重试。

Machine Ready 继续使用隔离的 config/session root、private `--session` seed 和 managed-only extension。它只执行
`get_state → get_available_models → get_state → new_session → get_state → switch_session(exact file) → get_state`，
不得发送 Prompt、调用 Tool/MCP/Provider 或等待 agent lifecycle，也不证明用户原生资源的行为资格。

## 2. 薄 managed extension 与部分审批

`rovai-pi-host-v5` 只负责：AgentRun/epoch/binding/Session 身份、Rovai Bootstrap 注入、`bash/edit/write` 调用审批、
最小输入回执、必要 Session 状态与失败上报。它可以把本轮 Rovai 分配的 `.pi/skills` root 作为额外 skill path；Core
只验证分配 Skill 是实际 catalog 的子集，允许 Pi 加载任意额外原生 Skill。

extension 不得调用 `setActiveTools`，也不拥有完整 Tool、Skill、Extension 或 template catalog。`read/grep/find/ls` 和
未知 Pi/用户 Extension Tool 按 Pi 原生语义继续；Rovai 只拦截确切名字为 `bash`、`edit`、`write` 的调用。Bash Approval
必须携带 Pi 在当前项目 trust 状态下由 `SettingsManager.getShellPath()` 与 `getShellConfig()` 实际解析出的 shell path、
args 和 `argv|stdin` transport，Core 不伪造 `/bin/zsh -lc`。

Pi permission mode 为 `partial_managed`。这表示已识别调用具有 best-effort durable Approval，不表示 sandbox、完整
mutation coverage 或最终 Tool input attestation。后加载的原生 Extension 仍可能改写 Rovai hook 之后的 system prompt、
context、Tool input 或 provider payload；产品不得声明覆盖这些变化。

## 3. Bootstrap 与最小 V2 receipt

每个实际模型 Prompt 在 Rovai `before_agent_start` hook 位置使用：

```text
S1 = PiCurrentSystemPrompt + "\n\n" + exactBootstrapFormatter3Bytes
```

V2 binding 与 receipt 均为 closed object，`schemaVersion=2`、`extensionVersion=rovai-pi-host-v5`。binding 必须携带
Host/binding generation、Run/epoch、Native Binding/generation、Delivery/Prompt、expected Session、Bootstrap bytes/digest、
managed Skill root/exposure digest。receipt 只携带并逐字段核对：

- Host/binding generation、Run/epoch、Native Binding/generation、Delivery/Prompt；
- 完整 Native Session ID、canonical cwd、Bootstrap evidence/digest、binding document digest；
- 按 UTF-8 byte order 固定的 `bash/edit/write` 三项 `{name, observable:true}`。

receipt 不含 Session file 或其 digest，也不含完整 Tool、Skill、Extension、template、system-prompt catalog/digest。确认 nonce
为 `sha256("rovai-pi-managed-input-receipt-v2\n" + canonicalJson(receipt))`。只有 nonce 返回后，Core 才在同一 SQLite
事务插入 immutable receipt 并把对应 Runtime Input Delivery 改为 `accepted`；不得关闭 foreign keys 或拆开原子提交。
父 Delivery 的合法 `ON DELETE CASCADE` 必须能删除 receipt，直接 UPDATE 和父仍存在时的直接 DELETE 保持禁止。

关键 binding/session/bootstrap/receipt/approval-channel 失败必须立即拒绝当前 operation，且发生在 provider request 前；
不得以永不 resolve 的 Promise 模拟 fail-closed。

## 4. Prompt transform 与图片

Formatter 22 原始 Dynamic Context 不变。只有 `invocationKind=direct` 且 `CURRENT_INPUT.source.type` 为人类来源时，Core
才把整个 current message 开头的 slash token 与 activation 时 `get_commands` catalog 做 exact-name 匹配：

- `source=prompt`：读取同一非 symlink 普通文件，复核 canonical path/digest，去除 front matter，按 Pi 参数规则展开；
- `source=skill`：保留完整 `SKILL.md` bytes，有参数时追加 `"\n\nUser: " + rawArguments`；
- `source=extension`：返回 `pi_extension_command_unavailable_in_managed_agent_run`，不得绕过 receipt 直接 dispatch；
- 未识别命令保持普通文本；已识别文件缺失、漂移、歧义或无效时明确失败，不静默回退。

Core 只替换 cloned `CURRENT_INPUT.message`，并在 dispatch 前私有保存原始 P22、实际 Runtime payload、closed transform
evidence、source/expanded bytes blob。完整 source path 与内容不得进入公开事件、Activity、diagnostics 或 read model。

当前输入中已通过既有附件授权的 PNG/JPEG/GIF/WebP 以原顺序发送为 Pi `prompt.images`：每项使用 exact bytes 的 base64、
sniffed MIME、raw SHA-256 与 byte length；每项上限 20 MiB、合计上限 80 MiB。模型 catalog 未声明 image input 时明确
拒绝。每项证据、图片数量和有序集合 digest 在 dispatch 前私有持久化；零图片也必须有 count=0 与空集合 digest。

## 5. 诊断、协议与恢复

Pi stderr、startup stdout prelude 和可恢复的单条 malformed stdout 都进入脱敏 `runtime.host.log`，并关联 Host、可用的
Run/epoch 与阶段。单条文本最多 64 KiB；startup prelude 最多 32 行且合计 64 KiB。协议开始后连续三条 malformed、
超长/read framing 错误、response ID/command identity 冲突或响应没有 pending owner 才使 Host 不可信并终止 reader。

单次 Prompt/model/state/Tool、可选资源或非关键 receipt 错误只失败当前 operation；只有身份冲突、持续 framing 损坏、
response identity 冲突、Session 被其他 Run 接管或无法重同步时标记 Host poisoned。

恢复 exact-first：healthy 相同 Host/session 直接复用，否则从 Core 私有 locator 调用 `switch_session(exact file)` 并以
`get_state` 和 extension Session state 核对 full ID/file/cwd。locator 缺失、文件删除/损坏、cwd/版本不兼容或 switch
失败时记录 continuity lost，最多创建一个新 Session；新 Session 重新注入同一 Bootstrap，并通过正常 Formatter 22
恢复 Rovai 可恢复上下文。Core 扫描旧 JSONL 时跳过 Session header 前的未知或单条 malformed 记录；locator 永不公开。

## 6. 并发、RPC 与 MCP

Runtime creation singleflight key 为 `(agent_run_id, execution_epoch)`。全局 registry mutex 只保护 keyed gate 的查找、
插入和清理，不跨 spawn、RPC、Session、Extension、文件或网络 IO；同 key 共享创建，不同 Run 并行，late epoch 不能覆盖
较新 active Runtime。

Pi adapter 使用原生 wire 支持 `prompt.images`、`clear_queue`、steering/follow-up mode、message/entry retrieval、Session
stats/name、manual/auto compaction 与 HTML export。任何未来暴露的 `steer`/`follow_up` 用户输入都必须先取得独立
Delivery ID、Native Prompt ID 与 V2 receipt，不能复用旧 receipt；`export_html` 只能来自显式用户动作并落入已授权路径。

Pi External MCP 继续为 `Unsupported`：Core 静默忽略 Assignment，不读取/冻结 MCP 配置、不启动 Server、不注册 proxy
Tool、不调用 `tools/call`，MCP 不参与 compatibility、LRU 或 resume。Pi 自己由原生 Extension 提供的能力仍可使用，但不
是 Rovai MCP projection，也不进入其证据。其他 Runtime、MCP UI、配置和 Assignment 数据不变。

## 7. 版本与资格

新写入使用 binding/receipt v2、Prompt Transform 1、Image Evidence 1、`partial_managed` 与 Pi compatibility
`native-capabilities-v1`。Migration 136 从 Data Contract v1.45 / Schema 86 原子升级到 v1.46 / Schema 87，保留历史 V1
receipt reader，Writer 只写 V2，并规范化已存 Pi `managed` permission。

Pi 三个平台继续是 `preview / runtime_platform.qualification_evidence_missing`，本合同不创建或升级 qualification artifact。

## References

- [Runtime Launch and Verification v32（historical）](runtime-launch-and-verification-v32.md)
- [V1.39-D10](../versions/v1.39/decisions.md#v1-39-d10)
- [Pi model-context revision 3](../versions/v1.39/model-context-change-pi-managed-system-prompt.md)
- [Pi parity matrix](../research/pi-runtime-reintegration-parity-matrix.md)
