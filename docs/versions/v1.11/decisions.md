---
document_type: version-decisions
version: v1.11
lifecycle: historical
last_updated: 2026-08-19
---

# v1.11 决策记录

本文件保留迁移前属于 v1.11 的历史数字 ADR，并记录当前版本新增的决策治理取舍。决定只解释背景与理由；当前规范由相应 Architecture、Contract、Context、UI 或 Development 文档直接拥有。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0220](#adr-0220) | Runtime Model Catalog Stale-While-Revalidate and Execution-Time Validation | `accepted` |

<!-- legacy-adr:begin id=ADR-0220 source-file-sha256=44764dac7085a5cb30fd22b02273da04560da38840ec8c7faeb02312a0569345 -->
<a id="adr-0220"></a>

## ADR-0220: Runtime Model Catalog Stale-While-Revalidate and Execution-Time Validation

迁移时原路径：`docs/adr/0220-runtime-model-catalog-stale-while-revalidate.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0220
title: Runtime Model Catalog Stale-While-Revalidate and Execution-Time Validation
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.11
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0220 -->
<a id="adr-0220-context"></a>
### Context

队员配置需要快速、稳定地展示 Runtime 模型目录，但切换 Runtime 本身必须保持零副作用，真实 Runtime
进程也不能为了绘制表单而提前启动。正常保存的显式模型也可能在 Provider 更新目录后暂时或永久缺失；把“没有可用
目录”误判成“模型已失效”会阻断用户修复，而把缓存当成执行事实又可能在 Provider 目录变化后静默使用
错误模型。

Runtime discovery 具有外部进程、认证状态和 Provider 依赖。它需要可复用的 last-known-good，同时必须有
明确的新鲜度、最大服务窗口、失效和执行期核对边界。这些语义跨越 Core、Adapter、Renderer 与 AgentRun，
并直接影响是否启动第三方 Runtime，因此不能由每个 Picker 或 Adapter 自行决定。

<a id="adr-0220-decision"></a>
### Decision

Core 拥有统一的 Runtime model catalog stale-while-revalidate 模块。切换 Runtime 只读取现有 Installation
snapshot；打开模型 Picker 才通过一个 Core interface 请求目录。成功目录在 60 秒内为 fresh，60 秒后至
24 小时内仍可立即服务并触发单飞后台刷新，达到 24 小时后不再作为可选目录服务。

刷新失败不得用空目录、fallback catalog 或失败快照覆盖 last-known-good。确定的 executable、安装、认证或
Provider 配置变化可以立即使目录失效；account/provider identity 只有在 Adapter 能提供稳定、非敏感证据时
才允许自动比较，否则以用户显式检查或真实执行重新建立证据。用户显式检查强制重新验证，但在结果产生前
不清空 last-known-good。

目录缓存只拥有配置体验，不拥有 AgentRun 真相。`runtime_default` 不依赖目录，配置与执行均不发送显式
model。显式模型在真实 Runtime Session/Host 建立后必须对当前实际广告目录进行核对；不存在或无法核对时
进入 typed `needs_attention`/不可执行结果，不得静默回退到 Runtime default。所有 Product Runtime 使用同一
缓存、Picker、Availability Check 与执行期验证规则；TRAE 仅继续遵守已有 purpose-scoped 启动限制和串行
真实验收要求，不形成产品级缓存或刷新特例。

<a id="adr-0220-consequences"></a>
### Consequences

- Runtime selection 保持零副作用，Picker 对 fresh/LKG 目录即时响应；超过最大窗口时诚实等待 discovery。
- 既有已保存显式模型在没有当前目录时显示“尚未核对”，而不是被无证据地宣告失效。
- 人工修改或技术恢复导致的损坏数据不属于兼容、迁移或修复范围。
- Core 必须拥有目录年龄、单飞刷新、失败保留和 typed check 终态；Renderer 只呈现这些事实。
- Adapter 必须在真实 Session/Host seam 核对显式模型，并保持 `runtime_default` 不发送 model。
- 现有 snapshot/attempt 时间戳足以表达该策略，因此本决定不要求新持久字段或 Data Contract migration。
- 本机真实 TRAE 验收必须串行，以避免第三方密钥/状态文件竞争；该测试约束不进入产品语义。

<a id="adr-0220-rejected-alternatives"></a>
### Rejected Alternatives

- **切换 Runtime 时立即 discovery。** 这会把表单选择变成有外部进程副作用的操作，并放大竞态和认证干扰。
- **Picker 永久信任 snapshot。** Provider 目录变化后会无限服务过时模型，且无法解释既有保存值的当前有效性。
- **刷新失败清空目录或写 fallback。** 瞬时失败会摧毁 last-known-good，并把观测失败伪装成目录事实。
- **保存时的缓存校验作为最终执行事实。** 缓存可能在启动前变化，不能证明真实 Session 当前接受该模型。
- **为 TRAE 保留独立缓存策略。** 本机并发验收冲突属于测试调度问题，不应形成长期产品分支。

<a id="adr-0220-references"></a>
### References

- [v1.11 版本范围](README.md)
- [Runtime Launch and Verification v9](../../contracts/runtime-launch-and-verification-v9.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [ADR-0127](../v0.43/decisions.md#adr-0127)
- [ADR-0192](../v0.87/decisions.md#adr-0192)
- [ADR-0204](../v0.98/decisions.md#adr-0204)
- [ADR-0208](../v1.03/decisions.md#adr-0208)
<!-- legacy-adr-body:end id=ADR-0220 -->
<!-- legacy-adr:end id=ADR-0220 -->

<a id="v1-11-d01"></a>

## V1.11-D01：当前权威收敛与数字 ADR clean break

### 背景

仓库已经积累 220 份独立数字 ADR。有效 ADR 同时拥有长期规范边界，Architecture/Contract 又承担当前结构与精确协议，导致读取路径、链接维护、替代图、正文冻结和生成器治理持续增长；部分当前规范仍只存在于 ADR，因而不能简单删除旧文件。

### 决定

当前规范完整收敛到 Architecture、Contracts、Context、UI 和 Development。版本 `decisions.md` 只保存重要改变的背景、选择、后果与替代方案，不作为当前规范或实现真源。

本次迁移先以不可变、自包含 Manifest 封存全部数字 ADR，再逐规范内核建立当前权威覆盖，随后按 `source_version` 等价聚合历史正文，最后删除数字 ADR、生命周期/替代图、HISTORY 生成器和 hash amendment 体系。

未来决定使用版本内 ID；一个版本最多一个 `decisions.md`，不再创建 `ADR-NNNN`。历史版本冻结，当前语义变化写入新的 current 版本并同步当前权威文档。

本次选择文件 URL clean break：不保留逐 ADR stub，明确接受仓库外旧 URL 失效；旧 ID、完整内容和来源仍通过 Manifest、Legacy Map、版本锚点、基线 commit 与 Git 历史追溯。

### 后果

- 维护者判断当前系统规则时不再需要解析历史替代图；理由和规范分别从 Decisions 与当前权威文档读取。
- 新增长期决定不再造成全局编号、全局 graph 或一文件一决定增长。
- 迁移 Manifest 和历史 ADR block 永久只读，成为一次性 clean-break 证据；它们不随未来决定扩充。
- 旧文件 URL 会失效，这是减少文件和停止旧目录治理明确接受的兼容代价。
- 当前权威文档必须保持自包含；仅链接历史理由不能替代直接写出当前约束。

### 被拒绝方案

- 只移动 ADR 正文而不先补齐当前权威：会产生规范真源缺口。
- 保留几百个逐 ADR redirect stub：继续保留文件数量和旧目录维护负担。
- 把 Architecture/Contracts 继续定义为 ADR 的派生说明：无法解除对旧生命周期和替代图的依赖。
- 用摘要替换历史正文：无法证明迁移完整性，也会丢失被拒绝方案和后果。
- 在新目录重新实现完整 accepted/superseded graph 与 hash amendment：没有降低治理复杂度。

### 当前权威影响

- 决策治理：[版本决策治理](../../decisions/README.md)。
- 当前规范路由：[文档导航](../../README.md)、[当前决定导航](../../decisions/CURRENT.md)。
- 当前架构基础：[当前基础架构不变量](../../architecture/foundational-invariants.md)。
- 迁移证据：[ADR 迁移 Manifest](../../decisions/ADR-MIGRATION-MANIFEST.json)、[权威覆盖](../../decisions/AUTHORITY-COVERAGE.md)、[Legacy Map](../../decisions/LEGACY-MAP.md)。

<a id="v1-11-d02"></a>

## V1.11-D02：局部替代归一与一次性迁移条款退役

### 背景

旧 ADR 的 Front Matter 只能表达整份文件的 `accepted / superseded`，不能表达某个三级 Decision 内核后来被局部替代。若迁移仅筛选 `accepted + cross-version + superseded_by: null`，会把旧 MCP Bridge、旧 Task、旧 Runtime 验证、旧 Context 和旧 UI 条款误报为仍然有效，也会把版本迁移步骤当成永久产品规范。

### 决定

本次 clean break 以规范内核而不是文件状态作最终盘点。仍原样有效的内核记为 `migrated`；已被后续决定改变的旧内核记为 `replaced`，并只把归一后的语义写入当前 Architecture/Contract/UI/Development；已经完成且没有持续产品约束的一次性迁移步骤记为 `retired`。历史 `decisions.md` 与 Manifest 保留当时原文，不回写新的状态。

下表是这次迁移中所有非 `migrated` 裁决。受影响内核的逐项当前权威锚点以[权威覆盖表](../../decisions/AUTHORITY-COVERAGE.md)为准。

<!-- authority-resolution:begin -->

| 原 ADR | 受影响内核 | 裁决 | 归一理由 |
| --- | --- | --- | --- |
| ADR-0013 | Managed Blob store | `replaced` | ADR-0081 将消息附件改为 Camp-public stable path/directory snapshot，Blob Store 不再拥有全部附件。 |
| ADR-0013 | Migration | `retired` | v0.06 的兼容迁移已经完成，不再构成跨版本运行时约束。 |
| ADR-0071 | Conversation is allocated only for admitted targets | `replaced` | ADR-0076 将完整执行 Preflight 移到已接受消息之后；Conversation 仍惰性创建，但旧事务顺序不再成立。 |
| ADR-0072 | Camp persists a directory workspace；Project navigation groups by canonical directory | `replaced` | ADR-0074 以 Quick Chat/`quick-chat` 替代旧 Lobby binding 名称，保留目录身份与动态 Git 边界。 |
| ADR-0080 | Durable Camp Composer Draft and Atomic Attachment Consumption | `replaced` | ADR-0169 加入原子目录快照，ADR-0185 将 reply/recipient continuation 纳入持久 Draft。 |
| ADR-0081 | Camp-Public Attachment Paths and Frozen Discovery | `replaced` | ADR-0169 将单文件路径模型扩展为 file/directory 封闭联合与目录树快照。 |
| ADR-0128 | Exact Draft revision is the only user write entry | `replaced` | ADR-0185 将 optional reply target 改为 Core-owned durable Draft intent，同时保留 exact revision。 |
| ADR-0056 | Existing built-in companions and upgrade | `replaced` | ADR-0086/0110 先收敛当前内置外观，再以内部 UUID + 单调 Agent ID 取代固定可读 Profile ID。 |
| ADR-0057 | Retained permanent removal | `replaced` | ADR-0136 要求永久移除在同一事务结束 membership、释放非终态 Task 并修复 Lead。 |
| ADR-0060 | Opaque routing identity；Summary model entry | `replaced` | ADR-0110 采用单调 `agent_N` 身份；ADR-0129 删除 Summary model entry。 |
| ADR-0058 | Collaboration aggregate；Project projection and repository binding；Camp membership and Member Presence；New Camp creation；Addressing and execution admission；Messages and execution；Lightweight Task；Dynamic Task context；Permanent Camp deletion | `replaced` | ADR-0067/0071/0072/0076/0129/0130/0136/0137/0206 分别收敛 Context、Workspace、message-first admission、公共 Delivery、Durable Task 和 force deletion。 |
| ADR-0058 | Required constraints and migration | `retired` | v0.15 的 schema/迁移收口已经完成；持续的不变量已进入当前协作权威。 |
| ADR-0108 | Discovery-Only Camp Message Search and Sequence-Paged Reads | `replaced` | ADR-0215 统一显式 Camp History target，并允许当前授权边界内的 public history 搜索/读取。 |
| ADR-0130 | Public A2A Messages and Unified Message Delivery | `replaced` | ADR-0163/0182/0184/0215 增加 caller return、显示名行首 alias 与统一 History publication boundary。 |
| ADR-0136 | 3. Make Task Coordination Authority explicit | `replaced` | ADR-0152 将普通 Agent 的协调权收敛为 Default Lead/User 拥有，Assignee 只更新自身执行状态。 |
| ADR-0137 | 1. Admit Task linkage exactly once | `replaced` | ADR-0157 明确触发消息的 `CURRENT_INPUT` 是唯一自然语言 instruction，Task/purpose 不形成第二指令。 |
| ADR-0163 | Explicit Caller Return and Core-Managed Reply Reference | `replaced` | ADR-0182/0184 扩展精确行首 alias，ADR-0193 为可信 Gather capture 增加不创建普通 caller continuation 的窄例外。 |
| ADR-0165 | Core-Owned Current-User Message Attention | `replaced` | ADR-0175 以 Occurrence/Episode/Disposition/Change Journal 取代旧 per-message Inbox row。 |
| ADR-0182 | Core-Resolved Current-Camp Display-Name Inline Addressing Alias | `replaced` | ADR-0184 将 alias 收紧为逻辑行首第一个非空白 token。 |
| ADR-0193 | Durable Gather Barrier over Unified Message Delivery | `replaced` | ADR-0195 使最后捕获值按 generation 替换，且 capture 不再消费 ordinary accepted-A2A 计数。 |
| ADR-0065 | 当前实现继续以精确 MCP 能力准入；兼容性候选只保存在项目文档 | `replaced` | Built-ins 改用 CLI，外部 MCP 采用 additive 能力轴；ADR-0189 允许严格禁用的 Settings Preview。 |
| ADR-0066 | 3. 快速发现与深度探测拥有不同权威；5. 刷新采用最近成功证据与失败分类；7. Run 准入通过可持久恢复的 Resolution Job 衔接；9. 路径与诊断只属于高级界面 | `replaced` | ADR-0075/0076/0083/0189/0192/0204 形成 message-first、浅检/按需深检、Preview 与 execution-deferred 最终边界。 |
| ADR-0075 | 3. 实际执行边界先做轻量比较 | `replaced` | ADR-0156 允许在逻辑 Runtime 身份内一次有界 Installation rebind，不再要求旧 path/fingerprint 永久不变。 |
| ADR-0123 | 3. 复用兼容性采用三项精确相等 | `replaced` | ADR-0126 移除 Codex Conversation Home/thread MCP compatibility identity，继续保留真正 process-scoped digest。 |
| ADR-0164 | Accepted Input Recovery Requires Proven Native Turn Reconciliation | `replaced` | ADR-0177 为 durable planned-shutdown cycle 增加受控失败收口窄例外，普通 crash recovery 不变。 |
| ADR-0168 | Planned Shutdown Preserves Runtime Terminal Authority | `replaced` | ADR-0177 允许达到受控 shutdown deadline 后结束产品生命周期，但仍不伪造 Runtime outcome。 |
| ADR-0192 | Purpose-Scoped Runtime Launch and Execution-Deferred Verification | `replaced` | ADR-0207/0208 将 TRAE 改为最高权限默认、正常 `--version` light check 与用户授权 Availability Check。 |
| ADR-0204 | On-Demand Runtime Deep Verification with Manager-Owned Attempts | `replaced` | ADR-0208 允许 TRAE light/availability verification，不再固定为 `installed_unverified` 或禁止用户检查启动。 |
| ADR-0051 | 工具组与网关 | `replaced` | ADR-0106/0108/0129/0215 将旧 Context 工具组归一为有界 public History discovery/read。 |
| ADR-0067 | Immutable Native Session Bootstrap evidence；Dynamic sections；Trusted A2A reply alias；ContextManifest, coverage and recovery；Task and attachment boundaries | `replaced` | ADR-0100/0129/0130/0141/0152/0163/0200 重分 Bootstrap、Dynamic Context、Delivery、Task 与 Evidence 生命周期。 |
| ADR-0147 | Model projection may be compact, but not lossy or renamed | `replaced` | ADR-0149/0200 将截断 continuation 与 omission navigation 收敛为非可执行、有界证据和紧凑 Run Facts。 |
| ADR-0152 | Lead-Owned Task Responsibility and Self-Active Task Awareness | `replaced` | ADR-0153 要求真实空的 self-active Task projection 显式出现，而不是省略。 |
| ADR-0194 | Mandatory Typed Gather Completion Current Input | `replaced` | ADR-0195 将 projection 收敛为每 Item/generation 的最后一个合格 capture。 |
| ADR-0014 | Stable gateway and replaceable connectors；Native Binding credential；Team MCP tool set；Charter and Tool Schema；Adapter surface | `replaced` | ADR-0067/0088/0091/0124 逐步以公共 Delivery 与 CLI-only Built-in Router 取代 Team MCP connector surface。 |
| ADR-0018 | Per-AgentRun projection | `replaced` | ADR-0088/0123/0125 将内部 Built-in attachment 与外部 additive MCP 分离，并允许兼容 IdleWarm 保留精确进程级投影。 |
| ADR-0088 | 三个能力轴独立冻结；只挂接一个无凭据的内部 Bridge；原生配置采用保留 ambient 的受管合并；Core 以 OS 进程身份建立连接绑定；原生权限必须窄授权且单独同意；Attachment 与工具合同按 Session/Run 冻结 | `replaced` | ADR-0124 clean break 删除 `rovai_team`、MCP Bridge、native permission bundle 和 attested attachment，改用 per-Run CLI lease。 |
| ADR-0089 | Discovery proves attachment, not authority；Exact permission is a complete user-consented bundle；Tool contract participates in Session compatibility | `replaced` | ADR-0124/0135 删除 Agent catalog discovery 与 MCP permission bundle，保留 Core catalog、领域授权和版本化 CLI contract。 |
| ADR-0103 | Reviewed built-in definitions | `replaced` | ADR-0197 将外部 MCP Library 初始状态改为空，不再内置或自动恢复第三方 preset。 |
| ADR-0105 | Library identity and revisions；Enablement and assignment；Safe projection and overlapping discovery；Run stability and presentation | `replaced` | ADR-0158/0161/0188/0214 建立 default-all assignment、desired-state reconciliation、启动前完整性门禁与 Windows crash recovery。 |
| ADR-0124 | CLI 是唯一内置工具运输；CLI 使用领域分组命令，canonical operation 不改名；Bootstrap 只承载稳定 CLI 合同；九个 Runtime 共同构成发布门禁 | `replaced` | CLI-only 方向保留，但 ADR-0135/0166/0180 删除 Agent discovery、演进 operation projection；ADR-0212 将全局 Runtime 门禁改为逐平台合格矩阵。 |
| ADR-0135 | 3. Define the Agent result contract by operation | `replaced` | ADR-0180 合并 Memory 写命令并相应改变 operation-specific Agent output。 |
| ADR-0161 | Event-Driven Root-Scoped Skill Projection Reconciliation | `replaced` | ADR-0214 仅对 Windows copy backend 以 Execution Root Gate 串行 replacement 与 active launch。 |
| ADR-0114 | 1. `capabilityKind` 的合同语义是 Activity Domain | `replaced` | ADR-0122 将 wire 字段改名为 `activityDomain`，保留顶层观测域含义。 |
| ADR-0090 | Human intervention has an exact boundary；Formal Trials use fresh product state and real Runtimes | `replaced` | ADR-0092/0094/0095 将恢复失败、隔离和 Human Intervention 独立 Hard Gate 纳入最终资格语义。 |
| ADR-0154 | Agent-Level Continuous Execution Process Surface | `replaced` | ADR-0160/0190 以单一 Approval Dock 和用户可放置的 Console/Inspector 取代旧三 tab、bottom-only surface。 |
| ADR-0160 | Focused Camp Inspector and Single Approval Surface | `replaced` | ADR-0190 取消无条件双 tab Inspector，改为按用户布局展示相连的执行阅读面。 |

<!-- authority-resolution:end -->

### 后果

- 覆盖表不再把“文件仍 accepted”误当成“其中每个旧条款仍当前有效”。
- `replaced` 只否定旧内核，不否定其未被改变的相邻约束；最终实现只读取覆盖表指向的当前权威。
- `retired` 仅用于已经完成的一次性迁移步骤；没有产品决定因“代码里暂时找不到”而被静默废止。
- Checker 必须校验处理方式与当前有效标志一致、目标锚点真实存在，并要求每个 `replaced/retired` ADR 在权威覆盖 Front Matter 固定的一次性迁移裁决来源中出现；版本冻结后该来源不随 `current_version` 移动。

### 被拒绝方案

- 继续把所有 391 行强制标成 `migrated`：会把历史局部替代重新引入当前规范。
- 只按 `superseded_by` 过滤整份 ADR：Front Matter 无法表达局部替代。
- 修改历史 ADR 状态或正文来补图：会破坏本次内容等价基线。

<a id="v1-11-d03"></a>

## V1.11-D03：统一 Runtime 深检生命周期与候选局部失败

### 背景

v1.11 已统一模型目录缓存，却仍继承 TRAE-only 启动限制：Installation Refresh、Health Probe 与 Dispatch
Preflight 不得启动 TRAE，`light_ready`/旧 `installed_unverified` 可以绕过统一 `ready` 门禁，首次正式
AgentRun 再承担专属补偿验证。这让同一 Product Runtime Catalog 继续维护两套执行准入语义；原始理由只是
本机并发验收时多个 TRAE 进程竞争第三方密钥/状态文件，并不是产品必须不同。

Runtime relocation 同时暴露出另一项身份归属问题：按搜索顺序探测备用 executable 时，若把每个候选的
fingerprint 都与当前 Installation 比较，未被采用的候选失败也可能以 `identity_changed` 使当前
last-known-good catalog 失效。候选失败不证明当前 Installation 身份发生变化。

### 决定

所有 Product Runtime 使用同一 purpose-scoped 深检生命周期。`light_ready` 仍可保存 runtime-default 与静态
permission descriptor，但正式 AgentRun 必须先通过统一 Dispatch Preflight 达到 `ready`；TRAE 不再拥有
execution-deferred 放行、首次 AgentRun 补偿、Installation Refresh 或 Health Probe 禁止分支。旧
`installed_unverified` 只保留历史读取能力，不再是配置或执行入口。真实 TRAE acceptance/smoke 以串行调度
隔离第三方本机状态。

当前 Installation 的 canonical path 是 executable identity change 的唯一比较对象。其他搜索候选失败统一
记录为 candidate-local transient attempt，不修改当前 snapshot 的 `stale_at`，也不使 LKG 失效。备用候选只有
完成完整 deep probe 并被正式采用时，才能替换 Installation、推进 generation 和失效旧 catalog。

### 后果

- Runtime launch policy、Scheduler Dispatch Preflight、安装刷新和 Health Probe 不再维护 TRAE-only 产品分支。
- `light_ready` 保持低副作用配置体验，但不再等价于任何 Runtime 的真实执行资格。
- 搜索路径中的坏版本、旧版本或临时候选不能破坏当前 Installation 的成功目录；失败诊断仍可审计。
- 本决定不新增 Migration、持久字段或 projection schema；不为人工修改、技术恢复或损坏数据增加兼容逻辑。

### 被拒绝方案

- 保留 TRAE 首次 AgentRun 验证，只统一 Picker：继续留下双执行路径并让 Health/刷新语义漂移。
- 把 `installed_unverified` 提升为通用可执行状态：会让未验证认证、协议、模型与权限的 Runtime 绕过 `ready`。
- 任一候选 fingerprint 不同即失效当前 snapshot：把搜索证据误当 Installation 身份，会摧毁无关 LKG。
- 为 TRAE 增加专属缓存或验收锁产品状态：测试调度问题不应成为 Runtime wire 或产品状态。

### 当前权威影响

- [Runtime Catalog 与 Installation 不变量](../../architecture/foundational-invariants.md#runtime-catalog-installation)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [Runtime Launch and Verification v9](../../contracts/runtime-launch-and-verification-v9.md)
- [首次训练 UI](../../ui/components/first-run-onboarding.md)
- [Runtime 兼容性清单](../../runtime-compatibility.md)
