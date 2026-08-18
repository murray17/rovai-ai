---
document_type: implementation-plan
version: v0.30
authority: implementation-status
status: complete
implementation_authorized: true
last_updated: 2026-08-01
---

# v0.30 实施与验收记录

> 生产合同：[architecture.md](architecture.md)
>
> 跨版本决策：[ADR-0088](decisions.md#adr-0088)

用户在文档确认后另行明确授权“实施”。Core、Runtime Adapter、专用 Bridge、受管 Plugin、
窄权限、Renderer 状态与真实账户 Smoke 已完成。以下清单记录完成事实；其中用户级 JSON
fallback 因专属 Plugin 路径已被真实验证而未激活，不属于本版本运行路径。

## 设计门禁

- [x] 核对当前 `agy 1.1.9` CLI 参数、官方 MCP/Plugin/permission 文档和已有本机证据。
- [x] 区分外部 MCP、Team Gateway attachment 和 ambient isolation 三个能力轴。
- [x] 用户确认采用受证明的原生 Bridge，而不是把 SDK 等价性或全局 MCP 合并当作既成事实。
- [x] 冻结 ADR-0088、配置所有权、进程证明、权限和真实 Smoke 验收矩阵。
- [x] 用户另行明确授权进入代码实施。

## 检查点 1：先证伪关键平台假设

- [x] 在不改产品代码的隔离 Spike 中验证专属 Plugin 生命周期和真实有效配置来源。
- [x] 记录 `agy → Bridge` 真实进程树，证明 Bridge 是当前 `agy` 的直接 MCP 子进程。
- [x] 验证 macOS Unix peer PID、PID start time、parent PID、executable identity 和 code
  signature/fingerprint 的可靠读取。
- [x] 用继承的匿名 Unix FD launch barrier 保证 Claim 先于 Bridge initialize。
- [x] 真实验证 `post_message`、`mcp(rovai_team/post_message)`、deny/ask/allow 优先级和
  headless soft-deny。
- [x] 对 Plugin、用户级和 workspace 同名 `rovai_team` 执行启动前冲突检测；未知归属失败关闭。
- [x] 验证真实 Antigravity MCP tool-call `_meta` 提供 conversation/progress identity；规范幂等键
  不使用每次连接都会重置的 JSON-RPC id。

本检查点任一硬条件失败时先停止并向用户报告，不进入“降低证明条件”的替代实现。

## 检查点 2：能力模型与发送准入

- [x] 把当前单一 MCP isolation 能力拆为三个正交、可序列化、可冻结的 typed capability。
- [x] 现有 exact Adapter 保持 `ExactPerRun + InjectedCredential + Exact`，没有行为回归。
- [x] Antigravity 只有证据完整时才得到
  `Unsupported + AttestedNativeBridge + PreservedUncontrolled`。
- [x] Attachment mode、工具 Schema、Bridge protocol/build 和 Charter 进入 Native Session
  compatibility key；变化只影响换绑后的新 Run，不热升级旧 Session。
- [x] 外部 MCP Assignment 在 Unsupported Runtime 上产生结构化准入错误，不被静默丢弃。
- [x] A2A 接收方准入继续与发送方 Team Tool 能力解耦。

## 检查点 3：受管配置与权限

- [x] 实现专属 Plugin 首选路径及安装、更新、缺失、冲突和 ownership divergence 状态。
- [x] Spike 已证明专属 Plugin 可用，因此按设计门禁没有激活或实现用户级 JSON fallback；
  共享用户 MCP 文件保持只读冲突来源。
- [x] 私有 ownership record 使用 exact file/entry digest；名称、路径或 namespace 不作为所有权。
- [x] Plugin 写入使用私有锁、全文 CAS、原子 replace 和目录同步；权限写入另有 digest journal、
  保留未知字段的全文 CAS 与 crash recovery。用户修改、同名项和 malformed JSON 均失败关闭。
- [x] 权限管理只申请精确 `mcp(rovai_team/post_message)`，并保持独立用户同意与撤回。
- [x] 不自动启用 `dangerously_skip_permissions`，不放宽只读模式的强制关闭规则，不覆盖
  deny/ask，不写 workspace MCP。

## 检查点 4：稳定 Gateway 与进程证明

- [x] 保留现有 credentialed endpoint/auth 语义；另建只接受 attested handshake 的每用户私有
  稳定 rendezvous，两条入口不得互相降级并在授权后才汇聚到同一 command handler。
- [x] 安全处理 Core crash/stale endpoint/第二 Core 竞争；Bridge 反向验证 Core peer identity
  和 endpoint owner/type/mode。
- [x] AgentRun 启动通过 launch barrier 登记 Run Claim，冻结 PID/start time/executable、Binding、
  Epoch、Capability、expiry 和 generation。
- [x] Core 从内核取得 Bridge peer PID，验证 Bridge identity、直接父 `agy` 和冻结 Runtime
  identity，不信任客户端自报字段。
- [x] 建立 connection-bound lease，同一 Bridge 进程可串行重连；不同 Bridge 不能重领。
  Spike 证明 `agy 1.1.9` 不会重启崩溃的 MCP 子进程，因此 Bridge process crash 按失败关闭处理。
- [x] Run/Binding/Epoch/Core 生命周期变化会撤销 lease；旧 generation 永不复活。
- [x] 配置 ownership divergence、用户撤回 permission、workspace 同名项或冻结 executable
  identity 变化也会
  撤销活跃 lease，修复后只允许新 Run/Binding 重新领取。
- [x] 每次 Tool Call 重新执行配置、进程、Run、成员、Capability、目标、配额和幂等校验。

## 检查点 5：最小 Antigravity Tool 面

- [x] 原生配置只注册 `rovai_team`，不含任何 secret、Binding 或 Run 标识。
- [x] 打包专用 attested Bridge entrypoint；它不接受 credentialed handshake，旧 Connector
  也不能在凭据缺失时自动降级到 attestation。
- [x] 绑定成功时 `tools/list` 只返回 `post_message`；未绑定时为空。
- [x] Bridge 把 `post_message` 映射到既有 `team.post_message` Core command，不复制领域逻辑；
  Capability、幂等 digest、审计和 completion receipt 继续使用 canonical identity。
- [x] 未绑定调用稳定返回 `run_not_bound`，所有拒绝路径 SQLite 领域零写入。
- [x] 只有 attachment 与非交互权限都 Ready 时才投递对应 Charter；不提及未暴露工具。

## 检查点 6：状态、测试与真实验收

- [x] Core/Contract/Renderer 状态呈现配置冲突、权限阻塞、ambient preserved 和 Team Gateway
  readiness；进程证明失败通过 Run/Bridge 诊断失败关闭。
- [x] 单元与集成测试覆盖 digest ownership、CAS/journal、进程 identity、Capability/Charter、
  prepared Binding 准入和幂等重放；真实 Smoke 覆盖直接父进程、连接重建、Core restart 与
  普通终端未绑定拒绝。
- [x] 打包 App 验证 Bridge 绝对可执行路径、文件 fingerprint、App 签名和受管配置更新。
- [x] 真实 Antigravity A→B→A Smoke 产生两条规范消息和三个且仅三个成功 Run。
- [x] 普通终端 Antigravity Smoke 的 `tools/list` 为空、调用为 `run_not_bound` 且 SQLite
  前后领域计数为零变化。
- [x] ambient MCP 共存披露和外部 MCP Assignment 结构化拒绝有测试证据。
- [x] 全量 Rust、TypeScript、desktop build/package 与现有 Runtime 回归测试通过。
- [x] 所有 `InjectedCredential` Adapter 继续使用原 endpoint/credential，并通过现有 Team
  Tool、Session resume、取消和错误语义回归。

## 可复现实证

- `pnpm typecheck`、`pnpm test`：27 个测试文件、159 项测试通过。
- `cargo test --workspace`：Rust lib 232 项、binary 49 项通过，5 项显式 ignored；
  `cargo clippy --workspace --all-targets -- -D warnings` 与 `cargo fmt --check` 通过。
- `pnpm build:desktop` 与 `pnpm package:mac` 通过，产物为
  `dist/mac-arm64/Rovai-ai.app`。
- `ROVAI_TEAM_SOURCE_ADAPTER=antigravity-app ROVAI_TEAM_TARGET_ADAPTER=antigravity-app
  pnpm smoke:antigravity-team` 真实完成 Debug Core 的 A→B→A；再以
  `ROVAI_CORE_EXECUTABLE=dist/mac-arm64/Rovai-ai.app/Contents/Resources/bin/rovai-core`
  运行同一脚本，打包 Core 也完成三 Run 链路、重启恢复和普通终端负例。
- Smoke 的受管 Plugin 和本次新增的 exact allow 在 finally 中按 exact identity 清理；验收后
  用户原生 Antigravity MCP 与权限设置未被永久改变。
