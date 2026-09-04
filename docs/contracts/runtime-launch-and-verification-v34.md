---
document_type: contract
name: Runtime Launch and Verification
version: v34
status: accepted
source_version: v1.44
last_updated: 2026-09-04
---

# Runtime Launch and Verification v34

v34 replaces [v33](runtime-launch-and-verification-v33.md). v33 的 Pi JSONL transport、无模型调用 Machine Ready、
原生资源、External MCP `Unsupported`、部分审批、图片、诊断、Usage、private exact Session locator、Resident
Host 与平台 Preview 保持不变。v34 删除 Rovai 对 Pi 交互式 CLI 和资源目录的二次模拟，并把公共 Fleet 启动改为
`Reserve → Spawn outside lock → Commit`。

## 1. 唯一正式启动模式

正式 Pi AgentRun 只能启动：

```text
pi --mode rpc --no-themes --extension <private rovai-pi-host-v6>
```

进程继承目标 executable 的用户 Home、Pi 配置、认证、provider、default model 与 workspace trust。不得追加
`--no-extensions`、`--no-skills`、`--no-context-files`、`--no-prompt-templates`、`--no-builtin-tools`、
`--approve` 或 `--no-approve`，也不得在启动失败后重试 managed-only 或 degraded Host。用户/项目 Extension 或
必要 Rovai extension 使 Host 启动失败时，保留真实安全诊断并直接失败；输入未被接受，不静默改变下一次 Host 的能力。

Machine Ready 仍使用隔离 config/session root、private `--session` seed 和必要 managed extension，只执行：

```text
get_state
get_available_models
get_state
new_session
get_state
switch_session(exact canonical session file)
get_state
shutdown/reap
```

Probe 不发送 `prompt`，不等待 `agent_start`、`message_update`、`message_end` 或 `agent_settled`，不调用 Tool、
MCP 或 Provider，也不写入用户原生 Session 目录。真实 Prompt/receipt/final/approval 行为只属于显式 smoke 或
qualification suite。

## 2. Pi 原生资源与薄 extension

Pi 自己通过原生 ResourceLoader 发现 Built-in tools、用户/项目 Extensions、Skills、Context files、Prompt templates
和 Settings。Rovai Skill projection 只把本轮冻结 Revision 物化到 workspace `.pi/skills`；managed extension 不处理
`resources_discover`，不返回 `skillPaths`，Core 不调用 `get_commands` 验证 catalog，也不把 Skill root、exposure
digest 或 command catalog 放入 Host compatibility、Session resume、binding 或 receipt。Pi 是否读取 `.pi/skills`
完全服从自己的 workspace trust 与资源配置。

Pi Skill discovery 能力继续声明，但验证等级是 `DocumentationOnly`，不能把文件投递或历史 smoke 误报为本次
Runtime catalog attestation。`rovai-pi-host-v6` 只负责 Run/epoch/binding/Session 身份、Bootstrap、managed input
receipt、必要状态/失败上报，以及对确切 `bash/edit/write` 的部分审批；它不固定 Active Tools，也不拥有完整 Tool、
Skill、Extension 或 template catalog。

Pi permission mode 保持 `partial_managed`。Bash Approval 必须携带 Pi 按当前项目 trust 实际解析的 shell path、args
和 `argv|stdin` transport；Core 不伪造 `/bin/zsh -lc`。其他原生或 Extension Tool 按 Pi 自身语义执行，这不构成
sandbox、完整 mutation coverage 或最终 provider payload attestation。

## 3. 普通 Prompt、Bootstrap 与 receipt

Rovai 输入是普通 Agent Prompt，不是 Pi TUI 命令框。无论 `CURRENT_INPUT.message` 是否以 `/` 开头，Core 都不得
识别、读取或展开 Pi prompt/skill/extension command。Formatter 22 已生成的
`prepared_context.rendered_payload` 必须逐字节作为 `prompt.message` 发送；不存在第二份 Runtime payload、
Prompt Transform、command source 或 expanded-content evidence。

每个实际模型 Prompt 仍由 managed extension 在自身 `before_agent_start` hook 位置形成：

```text
S1 = PiCurrentSystemPrompt + "\n\n" + exactBootstrapFormatter3Bytes
```

binding/receipt 是 closed schema 3，`extensionVersion=rovai-pi-host-v6`。binding 只包含：

```text
hostInstanceId
hostBindingGeneration
agentRunId
executionEpoch
nativeBindingId
nativeBindingGeneration
runtimeInputDeliveryId
nativePromptId
expectedNativeSessionId
bootstrapEvidenceId
bootstrap
bootstrapPayloadDigest
```

receipt 逐字段证明 Host、Run/epoch、binding、Delivery/Prompt、完整 Native Session ID、canonical cwd、Bootstrap、
binding document digest，以及 `bash/edit/write` 三个 governed Tool 在该 hook 可观察。它不证明完整 Tool/Skill/
Extension/catalog，不含 Session file、MCP 或原生资源 digest。Core 验证 nonce 后，仍在一个 SQLite 事务中插入
immutable receipt 并把 Runtime Input Delivery 改为 `accepted`。父 Delivery 的合法 `ON DELETE CASCADE` 可删除
receipt；直接 UPDATE 和父仍存在时的直接 DELETE 继续禁止。

## 4. 结构化图片与私有证据

图片只从当前 Delivery 绑定的 `ContextManifest.attachmentRefs` 与既有 attachment authorization 取得，不从
Dynamic Context 字符串反向解析 `CURRENT_INPUT`。PNG/JPEG/GIF/WebP 按 manifest 顺序读取 exact bytes，复核
sniffed MIME、raw SHA-256 与 byte length，再以 base64 `prompt.images` 发送；单项上限 20 MiB、合计 80 MiB，
模型未声明 image input 时在 Prompt 前失败。

`pi_prompt_image_evidence` schema 2 直接 `ON DELETE CASCADE` 绑定 Runtime Input Delivery，每项只保存 delivery、
image index、MIME、content digest、byte length 与版本。Data Contract v1.48 / Projection Schema 89 的 Migration 138
从 v1.47/schema 88 迁移旧图片行并删除 `pi_runtime_prompt_transform`；既有 receipt/accepted 原子事务不变，迁移后
必须通过 `PRAGMA foreign_key_check`。

## 5. exact resume 错误分类

恢复优先从 Core 私有 locator 调用 `switch_session(exact canonical file)`，再由 `get_state` 核对 full Session ID、
file 与 cwd。只有 `ResumeContinuityLost` 可以创建至多一个 replacement Session，包括 locator 缺失、文件缺失或
损坏、identity/cwd 不匹配、switch 明确报告目标不存在/不可读，或恢复后的 Session ID 不一致。

`ActivationFailed`、`HostFailed` 与 `ConfigurationFailed` 必须保留原错误并直接返回。Host/Extension 启动、普通 RPC
timeout、model catalog、显式 model、thinking、binding/receipt、diagnostic 或 Fleet acquire 错误不能记录旧 Session
continuity lost，也不能创建替代 Session。完整 Session file 只在 Core 私有状态中存在；公开事件、Activity、
diagnostic 与 read model 最多保存 materialized 状态或不可逆 digest。

## 6. Fleet Reserve / Spawn / Commit

`AgentRuntimeFleetManager.acquire` 是所有 Adapter 的统一 singleflight 和容量入口。短全局临界区完成已有 Run lease、
compatible Idle Host、Resident/Burst 容量、LRU eviction 选择及 `Starting` reservation；`Starting` 计入容量。需要停止
的 eviction 在锁外完成，随后进程创建、RPC/ACP handshake 与 health 检查也全部在锁外执行，因此不同 Run、不同
Runtime 可以并发 spawn。

Commit 重新取得短锁：成功时只有仍匹配当前 Core generation、Run/epoch 且未被 shutdown/invalidation 退役的
reservation 可以成为 Busy lease；失败或已退役时移除 reservation、释放容量并通知等待者。相同
`(agent_run_id, execution_epoch)` 看到 `Starting` 时不得二次 spawn，而是等待同一个 completion：创建者成功则共享
同一 lease，失败则观察同一失败。Camp 删除、成员永久移除、force-stop 与 shutdown 都必须先 fence/retire in-flight
reservation；迟到 spawn 不得提交并必须 shutdown/reap。

Pi Adapter 自身的 keyed creation gate 继续保留，但公共 Fleet 正确性不依赖任何 Adapter 私有 gate。Pi 的 Resident
reuse identity 仍为 canonical workspace + process digest；Session、Bootstrap、Skill、model、Prompt 和 MCP Assignment
不进入 process LRU key，当前 lease 的 Camp/member invalidation scope 每次领取时更新。

## 7. MCP、协议与资格

Pi External MCP 保持 `Unsupported`：Core 静默忽略 Assignment，不读取/冻结 MCP 配置，不启动 Server，不注册 proxy
Tool，不调用 `tools/call`，MCP 不参与 compatibility、LRU 或 resume。Pi 自己的原生 Extension 能力仍可使用，但不
属于 Rovai MCP projection 或证据。其他 Runtime、MCP UI、配置与 Assignment 数据不变。

Pi JSONL 的 Final、Cancel、Action、Usage、steering/follow-up 封装、Session 操作、compaction 和 HTML export 边界
继承 v33。Pi 三个平台继续为 `preview / runtime_platform.qualification_evidence_missing`；本合同不创建或升级
qualification artifact。

## References

- [Runtime Launch and Verification v33（historical）](runtime-launch-and-verification-v33.md)
- [V1.44-D01](../versions/v1.44/decisions.md#v1-44-d01)
- [V1.44-D02](../versions/v1.44/decisions.md#v1-44-d02)
- [Pi model-context change revision 1](../versions/v1.44/model-context-change-pi-native-prompt.md)
- [Pi parity matrix](../research/pi-runtime-reintegration-parity-matrix.md)
