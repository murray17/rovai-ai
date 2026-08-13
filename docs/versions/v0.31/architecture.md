---
document_type: version-architecture
version: v0.31
authority: implementation-contract
status: frozen
implementation_status: closed_incomplete
last_updated: 2026-08-13
---

# v0.31 实施设计

> 版本范围：[README.md](README.md)
>
> 内置工具对等：[ADR-0089](../../adr/0089-attested-built-in-mcp-tool-parity.md)
>
> 资格证据边界：[ADR-0090](../../adr/0090-team-delivery-qualification-evidence-boundary.md)
>
> 实施与验收状态：[implementation-plan.md](implementation-plan.md)

> 实施事实（2026-08-02）：首个有效 CAL-001 的 Antigravity `delivery_unknown` 失败已保留；
> 修复后的新 Team Configuration 使用同一密封 Case 和原预算通过 CAL-001。十二次自主 Trial
> 尚未启动，版本完成门禁仍未满足。

## 1. 设计目标与顺序

v0.31 只有一条允许的实施顺序：

```text
freeze docs and contracts
  → implement Antigravity complete built-in MCP parity
  → pass 13-tool real positive/negative Smoke
  → build and validate public demo Runner
  → validate and seal private qualification cases
  → package the exact Release Core
  → pass one guided collaboration calibration
  → run three autonomous rounds
  → publish private evidence bundles and optional redacted summary
```

后一步不得用模拟结果绕过前一步。尤其不得在 Antigravity 仍为单工具 attachment 时运行并
发布默认四角色资格结论，也不得把 public demo、Debug Core 或校准案例计入正式成绩。

## 2. 领域边界

本版本实现使用 `CONTEXT.md` 中的以下规范术语：

- **Built-in MCP Tool Parity**：Runtime 通过 Adapter-safe 名称获得与 exact-injection Runtime
  相同的 Team、Context Retrieval 和 Memory 语义；不代表相同业务 Capability 或 external/
  ambient MCP 隔离。
- **Qualification Team Configuration**：一次资格主张对应的完整四成员身份、Runtime、模型、
  权限、Capability 和版本快照。
- **Collaboration Path Calibration**：用户明确指定交接的非计分链路校准。
- **Autonomous Qualification Trial**：只给目标与约束、由 Lead 自主决定协作的计分执行。
- **Verified Delivery** 与 **Orchestration Convergence**：总体 Pass 的两个独立必要条件。
- **Invalid Qualification Trial**：仅限任务成功投递前的 case/harness/preflight 故障。
- **Qualification Case Seal**、**Qualification Environment Manifest** 与
  **Qualification Evidence Bundle**：分别拥有题目、可比环境和单次结果的不可混用证据。

Trial、Case 和 Evidence 都是 Runner/评测领域，不成为 Camp、Task、AgentRun 或产品 Renderer
实体。Core 不新增“评测通过”业务状态，也不把 verifier 结果写回 Task。

## 3. Antigravity 完整内置 MCP 工具对等

### 3.1 单一工具目录与别名

现有 canonical built-in catalog 是唯一 Schema 与路由真源。Antigravity attachment 从该目录
生成以下固定 dialect：

| Canonical | AGY alias | 权限规则 |
|---|---|---|
| `team.post_message` | `post_message` | `mcp(rovai_team/post_message)` |
| `team.create_task` | `create_task` | `mcp(rovai_team/create_task)` |
| `team.update_task` | `update_task` | `mcp(rovai_team/update_task)` |
| `team.list_tasks` | `list_tasks` | `mcp(rovai_team/list_tasks)` |
| `context.search` | `context_search` | `mcp(rovai_team/context_search)` |
| `context.get_message` | `context_get_message` | `mcp(rovai_team/context_get_message)` |
| `context.get_message_window` | `context_get_message_window` | `mcp(rovai_team/context_get_message_window)` |
| `context.get_message_thread` | `context_get_message_thread` | `mcp(rovai_team/context_get_message_thread)` |
| `context.get_summary` | `context_get_summary` | `mcp(rovai_team/context_get_summary)` |
| `memory.search` | `memory_search` | `mcp(rovai_team/memory_search)` |
| `memory.read` | `memory_read` | `mcp(rovai_team/memory_read)` |
| `memory.write` | `memory_write` | `mcp(rovai_team/memory_write)` |
| `memory.propose_hearth` | `memory_propose_hearth` | `mcp(rovai_team/memory_propose_hearth)` |

实现不得手写第二份 JSON Schema。统一 catalog entry 至少包含 canonical name、AGY alias、
title、description、input/output Schema 与 receipt identity。credentialed Bridge 直接使用
canonical name；attested Bridge 只在 MCP 边界替换为 alias。

`runtime_tool_call_id` 的 canonical digest 必须同时纳入当前 Antigravity conversation/progress
identity、Server ID、alias、canonical operation 和参数 digest，防止不同工具或不同输入发生
身份碰撞。Core 只接受 Bridge 从闭集映射得到的 canonical operation；IPC 客户端不能提交任意
Core command 名称。

### 3.2 Attested IPC 协议

v0.30 的内部请求只有 `List | Call { runtime_tool_call_id, input }`，Core 把所有 Call 硬编码为
`team.post_message`。v0.31 的 Call 必须显式携带由 Bridge 选出的 catalog identity：

```text
Call {
  protocol_version,
  catalog_digest,
  runtime_alias,
  canonical_tool,
  runtime_tool_call_id,
  input
}
```

Core 验证 protocol/catalog/alias/canonical 的闭集关系后，才把请求交给既有统一
`handle_team_tool_authorized` 路由。Bridge 不解析领域对象、不查 SQLite、不自行计算 Capability，
也不把 canonical tool 参数交给模型。

每次 `List` 与 `Call` 继续执行 ADR-0088 的 OS peer PID、直接父进程、启动时间、可执行文件
identity、Claim、lease generation、AgentRun、Binding 与 Epoch 检查。`Call` 还要在统一 handler
内重新执行该 canonical operation 的现有授权：

- A2A Capability、目标、深度和 Turn Run 配额；
- Task create/update Capability、关系、终态与 optimistic version；Default Lead 可更新本 Camp
  任意非终态 Task 以集成收口，普通成员只能更新自己的 Task 或领取未分配 Task；
- Context frozen message boundary 和 bounded result；
- Memory applicability、Lifecycle、Revision、Policy、write Capability、作用域容量与 secret filter。

Prepared Binding 的 attested 授权扩展必须由统一 Run identity helper 提供，不能只为
`post_message` 保留一条特殊旁路，也不能让其他工具回退到一个尚未可认证的 bearer Binding。

### 3.3 `tools/list` 与拒绝语义

| 状态 | `tools/list` | `tools/call` |
|---|---|---|
| 普通终端 `agy`、Core 不可信或无有效 Claim | 空数组 | `run_not_bound`，领域零写入 |
| Claim 有效但配置、权限或完整 catalog 不 Ready | 空数组；Run 不冻结完整 parity | 失败关闭，领域零写入 |
| Attachment、完整 permission bundle 和 Run 均有效 | 十三个 alias | 映射到 canonical handler 并逐调用授权 |
| 调用者缺少业务 Capability/可见性 | 目录仍与其他 Runtime 对等 | 相同 canonical 结构化拒绝 |
| Run/Binding/Epoch 在调用前失效 | 空或解绑状态 | `run_not_bound` / canonical fenced error，零新领域效果 |

工具是否可见不能成为 Capability oracle。与 credentialed Gateway 一致，完整目录可发现，
具体 mutation authority 在调用时由 Core 决定。

### 3.4 完整权限 bundle

Plugin 配置继续只有一个 credentialless `rovai_team` Server。权限管理从单一字符串提升为有序、
版本化的十三规则集合，并保持 v0.30 已实现的：

- 独立用户同意；
- 私有 ownership record 与 exact before/after digest；
- 进程间锁、全文 CAS、原子 replace 和目录同步；
- crash journal、未知字段保留与回读；
- 用户 deny/ask、同名冲突、未知来源或 divergence 失败关闭；
- 不通过 Plugin 安装修改全局 `dangerously-skip-permissions`；正式 Qualification 的冻结
  Runtime 配置可以显式选择 per-run skip-permissions，并必须进入 Team Configuration digest。

状态投影至少区分：Plugin conflict、permission bundle incomplete、rule denied/shadowed、ownership
diverged、catalog mismatch 和 ready。只有十三规则全部达到已验证的非交互可调用状态时才报告
`BuiltInMcpToolParity::Complete`。部分规则不能被笼统显示为“Team Tool 可用”。

### 3.5 Session 与 Capability 冻结

下列内容进入 Native Session compatibility identity：

```text
attachment mode
bridge protocol/build identity
canonical catalog digest
AGY alias-map version
input/output schema digest
permission-bundle version
Charter tool-contract digest
```

从 v0.30 单工具 attachment 迁移到完整目录必须创建兼容的新 Native Binding。配置修复只影响
之后重新探测、创建的 Run；旧 Session 和被撤销 lease 不热升级或复活。

Antigravity 的能力组合保持正交：

```text
ExternalMcpProjection = Unsupported
TeamGatewayAttachment = AttestedNativeBridge
AmbientMcpIsolation   = PreservedUncontrolled
BuiltInMcpToolParity  = Complete | Incomplete
```

存在队员 External MCP Assignment 时仍按 v0.30 结构化拒绝；完整 built-in parity 不把它冒充为
external projection。

### 3.6 十三工具真实验收

单元和协议测试之外，必须使用真实 Antigravity model call 覆盖：

1. `tools/list` 精确包含十三个 alias、无 dotted name、无额外 Rovai 工具；
2. A2A 投递与回信；
3. Task create → list → versioned update，且 assignment 不隐式唤醒；
4. Context search、单消息、窗口、线程与摘要的 frozen boundary；
5. Memory search/read、有效 Companion/Relationship write 和 pending Hearth proposal；
6. 缺少 Capability、stale Task version、越界 Context、不可读 Memory、quota 和 secret filter；
7. permission bundle 缺失/撤回、Session 换绑、Run cancellation、Core restart 与 Bridge crash；
8. 普通非 Rovai `agy` 的空目录、十三 direct call 拒绝和 SQLite 领域计数零变化；
9. 所有 credentialed Runtime 的原十三工具回归。

真实 Smoke 的临时 Plugin/权限变更必须按 exact identity 清理，不删除或覆盖用户自有配置。

## 4. 默认团队配置

Formal Runner 不复制日常数据库，而是在每个新 data directory 中通过公开 Core command 保存：

```text
Camp Collaboration Mode = peer
Default Lead             = agent-luoke / 小狐狸
Members                  = 小狐狸、小河狸、咕咕、小兔
```

| Member | Adapter/model | Model options | Native permissions |
|---|---|---|---|
| 小狐狸 | `codex-cli / gpt-5.6-sol` | `reasoning_effort=medium` | `sandbox_mode=danger-full-access`, `approval_policy=never` |
| 小河狸 | `codex-cli / gpt-5.6-sol` | `reasoning_effort=medium` | `sandbox_mode=danger-full-access`, `approval_policy=never` |
| 咕咕 | `opencode-cli / opencode/north-mini-code-free` | none | `permission=allow` |
| 小兔 | `antigravity-app / gemini-3.6-flash-high` | none | `mode=accept-edits`, `sandbox=on`, `dangerously_skip_permissions=on` |

Runner 还要冻结四人的六字段 identity、default business Capabilities、adapter capability snapshot
与完整 AGY permission bundle evidence。它不添加 Working Principles、Growth Topic、评测 Skill 或
角色编排 Charter。自主 Prompt 不能出现成员名、角色名、预期参与者或交接步骤。

原配置的 skip-permissions off 校准结果不可覆盖。修复配置使用 per-run
`--dangerously-skip-permissions`，因为非交互 print mode 无法呈现普通终端命令审批；Bridge
仍无凭据且逐调用 attestation，`sandbox=on` 也不构成对模型自动请求 sandbox bypass 的严格
安全保证。该变更必须作为新的 Qualification Team Configuration 披露。

## 5. Case 与 Sealed Pack

### 5.1 Pack 边界

开源仓库只包含：

- Runner 与 manifest/schema 实现；
- 一个公开、非计分 demo fixture 和对应 verifier；
- Case/Report 格式测试；
- 不泄漏正式题目的合成测试数据。

正式 Sealed Pack 位于用户指定的私有外部位置，不被 Git 跟踪。Runner 只接收 pack locator，
不得把它、解密信息或 verifier path 写入子 Runtime 环境、argv、Prompt、Camp、Execution
Evidence 或发布报告。

### 5.2 Case manifest

一个正式 case 的签名输入至少包括：

```text
case id + semantic version
technology/category tags
starting fixture tree digest
outcome-focused prompt digest
public check contract
withheld verifier digest
allowed/forbidden change boundaries
Trial Budget
toolchain contract
reference evidence digest
```

Case Seal 使用 canonical manifest 和上述所有内容 digest 计算。Title、目录名或单一 fixture
hash 不能替代 Seal。

### 5.3 Case admission

Seal 前使用独立临时目录依次执行：

1. 校验 fixture 没有 Remote、答案、verifier、密钥或绝对本机路径；
2. 初始化依赖并确认 task-independent build/public baseline 健康；
3. 确认 task-specific verifier 在初始 tree 以预期类别失败；
4. 应用独立 reference implementation，确认所有 public/withheld/forbidden checks 通过；
5. 从两个全新 materialization 重复 verifier，结果与规范化输出完全一致；
6. 冻结 manifest/Seal，之后任何修正都提升 case version。

Verifier 自身默认离线运行以减少非确定性；这不限制参与任务的 Agent 使用其真实 Runtime
网络和可见工具。

### 5.4 Trial Git workspace

Runner 从 sealed starting tree 创建一次性目录，移除 pack metadata，然后初始化只有一个
baseline commit、无 Remote 的 Git 仓库。外部 Evidence Root 保存 baseline tree digest 和文件
manifest；即使 Agent commit、reset 或改写 `.git`，最终仍按外部 baseline 计算 tracked、untracked、
deleted、mode 和 symlink 变化。

Withheld Verifier 只在全部 Trial Runtime 进程终止后取得最终 tree 的只读副本并运行。它不按
reference diff 评分，也不向成员回传 hidden failure 供继续修复。

## 6. Runner 边界与生命周期

### 6.1 两种模式

| 模式 | Core | Case | 结果权威 |
|---|---|---|---|
| demo/development | Debug 或显式测试 Core | public demo | 只验证 harness，不形成资格证据 |
| formal | 记录 digest 的 packaged Release Core | sealed private case | 可形成 Formal Qualification Trial |

Formal mode 启动前检查同用户没有运行中的 Rovai App/Core 或活跃 attested rendezvous owner。
发现竞争时返回 pre-dispatch Invalid，不自动 kill、quit 或接管另一个进程。

### 6.2 单次 Trial 状态机

```text
planned
  → preflighting
  → materialized
  → dispatched
  → observing
  → stopping?           (budget reached)
  → runtimes_terminated
  → verifying
  → passed | failed

pre-dispatch fault → invalid
post-dispatch fault → failed
```

Runner 的顺序职责为：

1. 创建私有 Evidence Root、临时 Core data directory 和 Trial workspace；
2. 采集 Environment Manifest 并校验 case/team/runtime/tool contract 无漂移；
3. 通过 `agents.runtime.set` 等公开命令保存四成员冻结配置；
4. 创建四成员 `peer` Camp，指定小狐狸为 Default Lead；
5. 发送一个普通用户消息并记录 accepted dispatch boundary；
6. 轮询权威 Camp/Run snapshot 和 Execution Evidence，维护 Run tree 与预算计数；
7. 到达任一预算时调用现有 CampTurn Stop，等待 fencing 和 Runtime 终止；
8. 在所有 Runtime process 终止后冻结 workspace tree；
9. 调用外部 verifier，计算双门槛与 Collaboration Evidence Matrix；
10. 原子完成私有 Evidence Bundle 和脱敏摘要草稿。

Runner 不发送追问、继续或纠偏消息，不点击 Approval，不修改任务 workspace，不调用 Retry，
不把 Agent final text 翻译成 verifier 结果。

### 6.3 投递前有效性

Preflight 至少要求：

- Release Core、Runner、team manifest 和 Case Seal digest 完整；
- 四个 Runtime executable identity、认证、精确 model/options 与 capability snapshot Ready；
- Antigravity Plugin、完整十三 permission bundle 和 Built-in MCP Tool Parity Ready；
- 没有外部 MCP Assignment 无法投影；ambient MCP 状态与 Manifest 一致；
- workspace 与 toolchain 可用，fixture baseline 与 Case Seal 匹配；
- verifier/reference admission evidence存在且 digest 匹配；
- 没有竞争 Core，Evidence Root 私有且不位于 Run Workspace。

Task 一旦被 Core accepted，后续任何 Runtime、权限、工具、环境或恢复失败都是有效失败。只有
尚未 dispatch 的 preflight fault 可以成为 Invalid。

## 7. Calibration 与正式套件

### 7.1 Collaboration Path Calibration

CAL-001 明确要求 Lead 调查并分别完成 Reviewer、Tester、Frontend handoff，接收必要回传后
完成集成。它必须验证：

- 四位成员均产生预期 Run；
- AGY 完整目录可被真实模型发现，且所需 Team/Context/Memory 调用真实成功；
- A2A body、source reply alias、correlation 和 Context boundary 正确；
- A2A 的唯一活动 Task 引用绑定到接收者 Run，接收者把同轮结果写回 Task；Task/Memory
  mutation 不产生隐式执行；
- Lead 在共享 workspace 中完成可验证集成，Run tree 在校准预算内终止。

校准失败时停止，不运行计分 suite。修复基础设施后可以重新校准，但不得把校准结果加入
Pass Rate。

实施结果：修复配置的 CAL-001 为 valid pass，Verified Delivery 与 Orchestration Convergence
均为 true，零投递后人工干预，四名成员实际参与，使用 7/10 AgentRun 与 6/9 accepted A2A。
十二次自主 Trial 仍待运行。

### 7.2 Autonomous suite

三个 Round 串行执行。每轮四个 case 的顺序由 suite seed 和 round number 产生可复现 permutation；
不同 Trial 之间不并行。单个 Trial 内 Core 可以按生产语义并发调度成员。

每个 Independent Qualification Repeat 必须新建：

```text
workspace
Core data directory
Camp and CampTurn
Conversations
Native Sessions and Bindings
Tasks, Memory and Execution Evidence
```

共享只限于 Manifest 允许的宿主 Runtime 安装、账户认证和稳定 case/team configuration。任何
Camp、Memory、Task、Session 或上轮工作区连续性都使 Repeat 无效。

## 8. Budget 与自动停止

| Case | Elapsed | AgentRun total | Accepted A2A |
|---|---:|---:|---:|
| CAL-001 | 30m | 10 | 9 |
| TQ001 | 12m | 3 | 2 |
| TQ002 | 25m | 8 | 7 |
| TQ003 | 25m | 8 | 7 |
| TQ004 | 40m | 12 | 11 |

AgentRun 总数包含一个 root Run，因此 `accepted A2A <= AgentRun total - 1`。Core 既有
`MAX_A2A_DEPTH=5` 和 per-Turn A2A hard quota 保持不变；Runner 预算更窄但不修改产品常量。

达到任一限制后 Runner 立即发起一次幂等 CampTurn Stop。正确 workspace 但超时、超 Run、
超 A2A 或无法完成 cancellation convergence 仍是有效失败。Token、credits 和 provider cost 因
Runtime 观测口径不一致只作为可选 evidence，不是硬门槛。

## 9. 结果模型

### 9.1 Trial outcome

```text
verifiedDelivery: boolean | unavailable
orchestrationConvergence: boolean
postDispatchHumanIntervention: boolean
validity: valid | invalid
overall: pass | fail | invalid
```

规则：

```text
invalid = pre-dispatch invalid condition
pass    = valid
          && verifiedDelivery == true
          && orchestrationConvergence == true
          && postDispatchHumanIntervention == false
fail    = every other dispatched outcome
```

Verifier 必须分项保存 build/public/withheld/requirement/regression/forbidden-change 结果，不能只
返回一个没有可诊断证据的布尔值。Hidden input/output 和完整断言不进入脱敏报告。

### 9.2 Collaboration Evidence Matrix

矩阵只从权威 snapshot、Execution Evidence、A2A/Task records、workspace observations 和 case
role metadata 派生，至少包含：

- actual Members and Run graph；
- A2A sender/recipient order、depth、closed/terminal target；
- relevant role omissions 与 unnecessary role activations；
- repeated routing、unclosed handoff、budget fractions；
- observed file ownership/overlap/revert evidence；
- Reviewer/Tester/Frontend output 与 later workspace/Lead evidence 的可核查关联；
- final Lead integration evidence；
- 无法安全归因的 `indeterminate` 项及原因。

消息数量、参与者数量或 Task 数量没有单调“越多越好”的得分。首版不计算 composite，也不
运行 LLM Judge。可选人工盲审只能读取脱敏、匿名材料并独立保存意见，不能改写 hard outcome。

### 9.3 Repeat 与 suite summary

每个 case 展示三次原始 outcome 和 `passes / 3`。Suite 展示十二次总 Pass Rate、每类至少一次
是否通过以及是否 `12/12`，不计算 Pass@3、不做显著性检验、不发布 leaderboard。

## 10. Environment Manifest 与漂移

Manifest 至少记录：

- Rovai Git commit、dirty state、Runner version、Release Core path/digest；
- macOS version/architecture、Trial timezone 与 timestamps；
- 四成员 identity/version/default Capabilities；
- Runtime executable path、reported version、fingerprint、authentication；
- model ID/options、native permission config、capability snapshot digest；
- Antigravity Plugin ownership、十三-rule bundle、attachment/parity/ambient state；
- Case Seal、toolchain versions、suite seed、round/order；
- 可观察 usage/cost 字段及明确 unavailable 状态。

每次 dispatch 前重采。以下变化停止剩余 suite：Core/Runner/case/team digest、Runtime executable
或 snapshot、model catalog/options、permission/Capability、Team attachment/parity、ambient MCP
状态或 toolchain contract。修复导致任何 material digest 变化时创建新 Manifest，旧结果不与新
结果合并。

## 11. 私有证据与导出

Qualification Evidence Bundle 默认写入 Rovai application data 下的当前用户私有目录，不进入
仓库。目录与文件使用 current-user-only 权限和原子完成标记。一个 Bundle 至少包含：

```text
environment manifest
case/team/runner/core digests
dispatch boundary and timestamps
authoritative snapshots
normalized AgentRun Execution Evidence
A2A and Task facts
workspace baseline/final manifests and diff
verifier category results
Trial outcome
Collaboration Evidence Matrix
redacted summary draft
```

不得复制 Runtime private logs、provider raw packets、隐藏 reasoning、credentials、environment
variable values、Sealed Pack locator、Withheld Verifier、reference solution 或 hidden assertion body。

显式 export 重新执行 redaction，并在输出中保留 case/team/environment digest、结果局限和
`PreservedUncontrolled` 披露。失败与成功 Bundle 使用相同保留政策；Runner 不自动只保留最佳
Repeat，也不自动 Git add/commit。

## 12. 非对抗性与真实环境限制

本版本不创建独立 VM、系统用户或远程 grader。模型 Provider 通信、Agent 正常网络、包安装和
可见工具按冻结 Runtime 权限工作；Runner 不增加 benchmark 专属网络 deny。Withheld Verifier
的保证是没有进入模型输入和 Run Workspace，并在 Runtime 终止后执行，不是阻止同用户恶意
进程搜索宿主文件系统。

Antigravity 继续保留 ambient MCP；完整 built-in parity 只说明 `rovai_team` 的内置工具语义，
不能用于声称 clean-room、工具集合完全一致或外部 MCP 对等。Environment Manifest 和导出报告
必须把这些局限写在资格结论旁边。

## 13. 失败分类

| 发生时机/事实 | 分类 | 是否进入分母 |
|---|---|---|
| Case Seal、reference/verifier、fixture baseline 在 dispatch 前损坏 | Invalid | 否 |
| Runtime/model/permission/parity preflight 在 dispatch 前不满足 | Invalid | 否 |
| task accepted 后 Runtime crash、auth loss、tool deny 或 Bridge revoke | Fail | 是 |
| task accepted 后人工审批、提示、编辑、命令或重启 | Fail + intervention | 是 |
| workspace checks 全过但 Run tree 未收敛 | Fail；保留 Verified Delivery=true | 是 |
| Run tree 收敛但 verifier 失败 | Fail | 是 |
| budget 触发自动 CampTurn Stop | Fail | 是 |
| Runner 在 dispatch 后自身无法保存必需 evidence | Fail + harness fault disclosure | 是 |

## 14. 实施边界

本文冻结生产实现必须满足的合同，不表示代码已经存在。用户已于 2026-08-02 明确授权开始实施。
开发过程中若发现 Antigravity 无法真实调用某一 alias、权限 bundle 无法精确管理、attested
identity 无法安全复用于某类内置操作，必须停止并报告；不得通过缩回 `post_message`、打开全局
permission bypass、复制领域逻辑或降低 verifier/Trial 口径来伪造版本完成。
