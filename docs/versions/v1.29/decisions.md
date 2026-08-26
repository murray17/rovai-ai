---
document_type: version-decisions
version: v1.29
lifecycle: current
last_updated: 2026-08-25
---

# v1.29 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前行为规范由链接的 Architecture 与 Contract 拥有。

<a id="v1-29-d01"></a>
## V1.29-D01：Pi 使用独立 JSONL RPC、受管 Approval 与 exact Session binding

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

本决定形成时的规范见 [Runtime Launch and Verification v26](../../contracts/runtime-launch-and-verification-v26.md)与
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

<a id="v1-29-d02"></a>
## V1.29-D02：Pi resident Host 使用原生状态与逐 Run managed model input

### 背景

D01 的独立 JSONL RPC、managed Approval、exact Session identity 和保守 Usage/Compaction 仍成立，但首版把
provider、model、Bootstrap、Skills 和一个 Native Session 固定在 Host 启动参数中，并把 External MCP 声明为
Unsupported。这样会把本应属于 Native Binding/AgentRun 的成员身份和模型输入误放进 resident process key，
既不能在同一 Workspace 串行切换 Pi Session，也无法在不重启进程的情况下精确刷新 Skills/MCP。

源码复核同时证明 Pi `0.84.2` 已提供 `switch_session/new_session`、每次 Session replacement 重建
ResourceLoader、`before_agent_start` System Prompt override、Extension Tool registration 和原生 auth/model
state。用户于 `2026-08-25T10:34:14+08:00` 确认
[model-context-change revision 1](model-context-change.md)，明确接受 Bootstrap 位置、项目原生 Skills、MCP 模型
输入、旧 Pi Session clean break 和显式 `set_model` 全局默认副作用。

### 决定

1. D01 第 2 项的 Claude settings/MiniMax overlay 与私有 `PI_CODING_AGENT_DIR` 正式启动方式被替代。Host
   继承用户原生 `~/.pi/agent` 认证和默认模型；Core 不读取 Claude settings、不复制 token、不创建 models.json。
2. D01 第 4 项的“一 Host 一 Native Session”被替代。Pi 使用 workspace/process 级 resident LRU key；每 Run
   通过私有递增 binding 执行 exact `switch_session` 或 `new_session`。Session、Camp/member、identity、
   Bootstrap、Skills、MCP、model 和 thinking 都不进入 Host key；同 Host 只串行执行，跨 Workspace 不复用。
3. Pi 增加 `managed_system_prompt`。Bootstrap Evidence v2 冻结完整 Member Identity/full Bootstrap bytes；
   `rovai-pi-host-v2` 在 `before_agent_start` 将其追加到 Pi base System Prompt 末尾，并在 provider request 前
   通过 blocking Managed Input Receipt v1 证明实际 prompt、Skill 与 Tool catalog。Pi 不使用普通消息式
   compaction redelivery。
4. D01 第 5 项的 explicit `--skill`/Host compatibility 被替代。每次 Session activation 只发现 exact
   Workspace `.pi/skills`，合并项目原生 Pi Skills 与 Rovai ready projection，并用 `get_commands`/receipt 验证。
5. D01 第 5 项的 External MCP Unsupported 被替代为 `AdditivePerRun / RovaiWins / CoreManaged`。首版只支持
   stdio：Core owns Server process/JSON-RPC，Extension 注册当前 Run proxy Tools，每次 MCP call 都 durable approve；
   Streamable HTTP 仍 unsupported。
6. cold resume 继续只使用 full UUID + exact canonical file，但失败不再按 D01 “至多新建一个 Session”降级；
   当前输入 fail closed 并记录 controlled continuity loss。`agent_settled` final、Pi 无 sandbox、managed native
   Tool Approval、Usage/Cost Disabled、Compaction Disabled 和非 arm64 平台未准入均不变。
7. Grok 已占用 Migration 107/108，主线 Runtime entrypoint locator identity 已占用 Migration 109。Pi catalog
   使用 Migration 110 升至 `v1.23 / schema 64`，managed context 使用 Migration 111 升至
   `v1.24 / schema 65`；111 fence 缺少 frozen identity/managed receipt 的旧
   nonterminal Pi state 并清理旧 locator，completed 业务历史与非 Pi technical state 不回写、不失效。

当前字段级规范见
[Runtime Launch and Verification v27](../../contracts/runtime-launch-and-verification-v27.md)，精确模型可见 bytes、
binding/receipt shape、MCP naming/result 和迁移规则见
[model-context-change revision 1](model-context-change.md)。

### 后果

- resident Host 只承载真实进程级状态，可以在同一 Workspace 安全串行服务不同成员和多个 exact Session；
- identity 仍按 Native Binding 冻结，不会因 Host 跨成员复用而串线，也不会在既有 Session 中热更新；
- Bootstrap、Skills 和 MCP 从“argv 猜测”变为跨进程 receipt 证明的实际模型输入；
- Pi 直接使用用户已配置的原生 MiniMax/BYOK/OAuth/Subscription，不再依赖 Claude 配置；显式模型选择对 Pi
  全局默认的修改必须由 UI/文档诚实披露；
- stdio MCP 获得产品支持，但其每次调用都经过 Core durable Approval；HTTP、Usage/Cost、Compaction 与其他
  平台没有被连带晋升。

### 被拒绝方案

- **继续把 Binding 输入放进 Host compatibility：** 会为身份、Skills、MCP 或模型变化重复启动进程，且无法
  利用 Pi 已验证的 exact Session replacement；
- **在普通 user message 重投 Bootstrap：** 改变消息历史和 authority，并与 `before_agent_start` 的 protected
  instruction layer 重复；
- **让 Pi Extension 直接连接 MCP：** Core 无法统一拥有进程树、Approval、generation fence、secret 和 cleanup；
- **依赖 MCP readOnlyHint 免审批：** 首版没有足够信任链证明 annotation 与真实副作用一致；
- **为无副作用显式模型选择继续维持私有 Pi Home：** 会失去用户原生认证/订阅/Session，且 Pi `0.84.2`
  公开 RPC 本身会持久化默认；revision 1 已选择诚实披露该副作用。

<a id="v1-29-d03"></a>
## V1.29-D03：新版 First-Class Checklist 下 Pi 暂按 Core Compatible 管理

### 背景

合并 `main` 后，Runtime Checklist 的完成定义从“基础链路与已声明边界通过”收紧为：十四个核心能力轴必须
全部 `Verified + Implemented`，或由可靠上游证据证明 `Unsupported` 并形成版本决定；fixture、Disabled、
NotObserved 和单次普通回复均不能替代目标 Runtime Golden Flow。Pi revision 1 已实现 resident Host、exact
Session、managed Bootstrap、Skills、stdio MCP、Approval、final 与 cancel，但现有证据仍缺少完整 Compaction、
结构化 Usage、Skill/MCP 完整 lifecycle 矩阵、六类 Tool output、三类 Missing-Send、shutdown/crash cleanup 和不可变
平台资格 artifact。

### 决定

1. Pi 当前 admission 记录为 `core_compatible`，不得把代码已进入 closed catalog、macOS arm64 可执行或旧分支
   smoke 解释为新版 Checklist 的 `first_class`；
2. Usage/Cost 和 Compaction 的 `Disabled` 不是 accepted upstream difference。必须先继续探测 Pi 的结构化
   usage/compaction surface，并完成归属、去重与上下文连续性；只有可靠证明上游 `Unsupported` 后才能另行决定；
3. stdio MCP 的 Core bridge 是 `Implemented`，真实 Pi provider 的基础 Tool call 与逐次 durable Approval 已
   `Verified`；但在完成 assignment 增删、deny/cancel 与相邻 Session 无泄漏前，MCP 整体能力轴仍不得记为
   First-Class Pass；Streamable HTTP 同样不能仅因首版未实现写成上游 `Unsupported`；
4. 现有 Pi catalog 与平台 admission 代码保留为待验收实现，当前版本文档和 checklist report 显式标记
   visibility mismatch；在所有阻断项闭合前，不发布“Pi 已完成 First-Class 接入”的结论。

### 后果

- 已确认 revision 1 的模型输入、身份冻结、LRU、Session 与安全语义不回退；
- 用户可以精确区分“实现已存在”“真实 evidence 已建立”和“满足正式 Product admission”三个层次；
- 后续工作必须补真实 Golden Flows 或收窄产品可见性，不能通过把能力长期标为 Disabled 来绕过清单。
