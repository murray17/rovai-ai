---
document_type: version-decisions
version: v1.28
lifecycle: current
last_updated: 2026-08-24
---

# v1.28 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前行为规范由链接的 Architecture 与 Contract 拥有。

<a id="v1-28-d01"></a>
## V1.28-D01：Pi 使用独立 JSONL RPC、受管 Approval 与 exact Session binding

### 背景

Pi `0.84.2` 提供官方 LF JSONL RPC、结构化 Tool、Session file/UUID、Extension UI 和
`agent_settled`，但不是 ACP，也没有内建 sandbox 或 permission system。用户要求沿用本机 Claude Code 的
MiniMax API key 接入方式。直接继承 Pi 用户 Extension、把 token 写进 models.json/数据库，或把 RPC response、
`agent_end`、process exit 当作 final，都会分别扩大代码执行/秘密面或破坏终态正确性。

Pi 的 Skill 在 Session 启动时扫描，Session 可以由 exact file 恢复；公共 Runtime Fleet 已拥有 warm LRU、
Host compatibility、process fencing 和 Built-in lease。上游也暴露 Usage/Compaction 候选，但当前没有证明
per-Run attribution、occurrence/dedupe 与 resume 语义；Pi 核心不提供 External MCP。

### 决定

1. Pi 作为独立 `pi-jsonl-rpc-v1` Adapter，不复用 ACP Host、不解析 TUI、不引入第三方 ACP shim；prompt
   response 只表示 accepted，公开 assistant snapshot 来自 `message_end.message`，成功 terminal 只认
   `agent_settled`；
2. Core 只从权限收窄的 `~/.claude/settings.json` 读取 exact MiniMax 三字段；正式 Host 继承通用 `HOME`，
   但必须使用 Rovai 私有 `PI_CODING_AGENT_DIR`、env-ref models.json 和 child-only token。该 Pi-specific
   state/config 隔离用于禁止自动用户/项目 Extension、固定 provider 与 Session locator，Probe 另用临时 root；
3. Pi 只有 `approval_mode=managed`。Rovai 受管 Extension 是 launch/Ready 硬门：read/search 类 Tool 不弹
   Approval，文件可达性沿用 OS 用户与既有 Workspace/attachment 边界；`bash/write/edit` 在执行前桥接 durable
   Approval，unknown mutating Tool、error、timeout 与 restart 均 fail closed；Pi 本身不提供 sandbox；
4. Pi 使用公共 Fleet LRU，但首版一 Host 一 Native Session。continuation 只按 compatible warm reuse →
   exact canonical `--session <file>` cold resume → new Session；恢复后核对 full UUID/file/provider/model，禁止
   `--continue`、partial ID、最近 Session、目录扫描和 replay History Restore；
5. `.pi/skills` 由 Rovai 管理并以 explicit `--skill` 在 Session start 投递，exposure digest 进入
   compatibility。Built-in CLI 通过受管 Bash 与 per-Run lease；External MCP 为 Unsupported；Usage/Cost 与
   Compaction 为 Disabled；
6. 只有完成完整真实矩阵的 `macos-arm64` qualified。macOS x64 与 Windows x64 继续逐平台取证，不能从共享
   Fleet 或 arm64 结果外推。

当前规范见 [Runtime Launch and Verification v26](../../contracts/runtime-launch-and-verification-v26.md)与
[Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)。实测边界见
[Runtime 兼容性清单](../../runtime-compatibility.md)。

### 后果

- Pi 保留官方协议和原生 Session identity，同时秘密只存在于目标进程，用户 Claude/Pi 配置不被复制或改写；
- 缺少原生 sandbox 不会转化为无审批执行；Extension 握手和所有 mutating Tool 都受 fail-closed 硬门；
- warm Run 避免重复启动，Core/Host 重启后仍能精确恢复同一 Session；locator、provider 与 model drift 会 fence；
- Skill 变化不会误复用旧 Session；MCP、Usage 与 Compaction 的产品声明不会超过真实证据；
- 平台支持范围暂时小于大多数既有 Runtime，但准入陈述可复现且不会静默外推。

### 被拒绝方案

- **把 Pi 当 ACP Runtime：** 上游官方合同是自己的 JSONL RPC，第三方 shim 会成为额外不受控协议真源；
- **直接运行用户 Pi config/Extension：** Extension 在 Runtime 进程内执行代码，破坏受管 Approval 的完整覆盖；
- **把 Claude token 写入 Pi models.json、成员配置或数据库：** 扩大秘密持久化、备份、诊断和 argv 暴露面；
- **逐 Run 新 Session 或 fuzzy continue：** 前者丢失原生身份，后者可能恢复错误会话；exact locator 已可满足；
- **仅依赖 Extension 内存批准：** Core restart 会丢失决定，不能满足 durable Approval 与 unknown-effect recovery；
- **因为上游有 Usage/Compaction event 就立即启用：** 尚未证明 Run 归因和恢复去重，容易制造错误账单或上下文
  事件；保守 Disabled 不阻断 Runtime 基础价值；
- **通过第三方 MCP Extension 声明 External MCP：** 没有 Product-managed projection、隔离和真实资格矩阵。
