---
document_type: adr
id: ADR-0124
title: CLI-Only Transport for Rovai Built-in Operations
status: accepted
date: 2026-08-06
decision_scope: cross-version
source_version: v0.42
supersedes: []
superseded_by: null
---

# ADR-0124: CLI-Only Transport for Rovai Built-in Operations

## Context

Rovai-ai 当前通过 Runtime-native MCP 注入向 Agent 暴露 Team、Task、Camp History 和 Memory
操作。这个运输方式迫使各 Runtime Adapter 处理内置 Server 配置、工具别名、Schema 方言、
权限包和模型提示；Antigravity 还需要独立的受证明 attachment。与此同时，用户配置的外部
MCP 有独立的 Library、Assignment 和 Runtime-native Projection 边界，两者并不共享授权、
生命周期或故障语义。

内置操作的领域服务、canonical 名称、输入 Schema、业务结果、可见范围、operation-specific
invariant、Execution fence、幂等和审计均已由 Core 拥有。运输迁移不应复制这些领域规则，也不应把内置
操作与第三方 MCP 合并到一个通用代理层。

## Decision

### CLI 是唯一内置工具运输

Agent 只通过 `rovai` CLI 调用 Rovai-owned canonical operations：

```text
Agent Runtime
  -> rovai CLI
  -> local Core IPC
  -> Core-owned Built-in Tool Router
  -> existing Team / Task / Camp History / Memory services
```

CLI、Core Router、receipt、审计、动态上下文和 Canonical Runtime Activity 使用同一 canonical
operation identity。Runtime Adapter 不复制内置 Schema、领域 handler 或业务授权。

`rovai tool list` 和 `rovai tool describe` 对所有 eligible Agent 暴露同一完整、版本化 catalog。
Catalog 由当前运行的 App build 固定；App 更新必须重启后才加载另一版本，不设计运行中新增、
删除或热刷新 operation 的路径。
每个当前有效 Member 都可以调用目录中的每个 operation；系统不按 Member Capability、角色或
allowlist 改变工具可见性或调用资格。Core 仍在每次调用时检查当前 Run 与成员资格、目标记录
可见范围、Context fence、Task/Memory 版本、配额、目标状态和 operation-specific invariant。
这些拒绝表达具体请求不合法，而不是该 Member 没有工具权限。

`memory.write` 与 `memory.propose_hearth` 不再受应用级 `agentMemoryWritesEnabled` 开关控制；
该开关及其产品设置被删除。所有有效 Member 始终可以调用两项 Memory mutation operation，
而 Companion/Relationship Scope、Hearth Proposal 用户决定、Secret Filter、版本、容量、配额和
其他 Memory invariant 继续约束具体请求。

### CLI 使用领域分组命令，canonical operation 不改名

CLI 不使用 `rovai tool call <operation>` 执行业务操作，而是提供以下固定命令：

| CLI command | Canonical Operation |
| --- | --- |
| `rovai member call` | `team.call_member` |
| `rovai task create` | `team.create_task` |
| `rovai task list` | `team.list_tasks` |
| `rovai task update` | `team.update_task` |
| `rovai camp list` | `camp.list` |
| `rovai camp search` | `camp.search` |
| `rovai camp read` | `camp.read` |
| `rovai history search` | `history.search` |
| `rovai memory search` | `memory.search` |
| `rovai memory read` | `memory.read` |
| `rovai memory write` | `memory.write` |
| `rovai memory propose-hearth` | `memory.propose_hearth` |

分组命令是稳定的 CLI presentation，不改变 canonical identity。Core Router、receipt、replay、
审计、Dynamic Context 和 Canonical Runtime Activity 仍使用右侧 dotted operation。CLI 返回的
Envelope 也继续在 `operation` 中返回 canonical operation，而不是 shell 命令字符串。

`rovai tool list` 与 `rovai tool describe <canonical-operation>` 继续作为目录发现命令，不承担
业务调用。目录为每项 operation 同时公布 CLI command、direct arguments、input schema、
`resultSchema` 和版本化 `envelopeContract`；各分组命令的 `--help` 从同一份目录元数据生成。

### Bootstrap 只承载稳定 CLI 合同

Native Session Bootstrap 只说明 `rovai` 可用、`tool list`、`tool describe`、领域分组命令和
输入方式的稳定用法及必要协作语义，不复制十二个 operation 的完整输入或结果 Schema。`tool list` 和
`tool describe` 从同一 Built-in Tool Catalog 按需返回当前名称、说明、`resultSchema` 与版本化
`envelopeContract`。AgentRun Dynamic Context 对省略内容只提供 canonical operation 提示，不
复制完整命令或 Runtime-specific alias。

### 同一命令支持直接参数、stdin、heredoc 和输入文件

十二个业务命令都支持以下输入方式：

- 简短输入直接使用按 input schema 生成的 kebab-case 字段参数；
- 从非交互 stdin 读取一份 JSON 对象，普通 pipe 与 heredoc 均属于此方式；
- 使用 `--input-file <path>` 读取一份 JSON 对象。

一次调用只选择一种输入来源，不合并文件、stdin 与直接参数，也不存在覆盖优先级。数组字段使用
目录声明的可重复参数；复杂约束仍以 canonical input schema 和 serde 校验为准，CLI 参数解析
不得形成第二套业务 Schema。无输入字段的调用可直接执行；缺少必填字段仍返回规范输入错误。

短查询、ID、分页和状态字段可直接作为参数传递；长消息、Task 描述和 Memory 正文优先建议使用
`--input-file`，也允许通过 stdin/heredoc 输入。例如：

```sh
rovai camp search --query "runtime compatibility" --limit 10
rovai member call --input-file request.json
rovai memory write <<'JSON'
{"action":"add","body":"...","retrievalKeys":["..."]}
JSON
```

各输入方式只解决调用便利性与 Shell quoting，不构成保密边界：参数、heredoc、创建输入文件的
命令以及 Runtime 输出都可能进入 Runtime Evidence。CLI 读取文件内容后只把 canonical JSON
发送给 Core，Core 不接收或信任客户端文件路径。若使用临时文件，Bootstrap 推荐写入
`ROVAI_RUN_TMP`；项目内文件的创建、保留和删除仍属于 Agent 的普通文件行为。

### 内置 MCP 是 clean break，不是兼容模式

迁移完成后删除整个 Rovai-owned built-in MCP transport，包括 `rovai_team` Server 注入、MCP
Bridge、Runtime 临时配置、内置 alias map、Schema dialect、Antigravity permission/attachment
以及模型侧 MCP 名称提示。系统不保留 `mcp_legacy` 运行模式，不在 CLI 不可用时自动回退，
也不在同一个 AgentRun 中同时暴露 CLI 与内置 MCP。

用户配置的外部 MCP 继续使用既有 MCP Library、Assignment 和 Runtime-native Projection。
外部 MCP 不经过 Built-in Tool Router，也不因本决策改成 CLI 或 Core 通用 Proxy。
`rovai_team` 不再是内部保留 MCP Server Name；外部定义可以按普通名称规则使用它，但该名称不
获得任何 built-in operation、lease、receipt 或 Core Router 语义。

本次切换只面向当前本地开发状态：实现与验收前直接清空现有本地应用数据，再以新合同重新开始。
产品代码不实现旧安装的数据迁移、`rovai_team` 遗留配置识别、自动清理、兼容提示或其他升级逻辑。
“完全删除”指从新代码和新数据中移除内置 MCP 运输，不为已经清空的数据保留处理分支。

### 不可用时在输入投递前失败

每个目标 Runtime 必须在接收 AgentRun 输入前证明本次 Run 的 `rovai` CLI transport 可用。
若 CLI、Core IPC、当前 Run 绑定或 catalog contract 不可用，AgentRun 启动失败并报告明确原因；
系统不得启动一个无法使用 Rovai 内置操作的降级 Agent，也不得静默改用旧 MCP。

### 九个 Runtime 共同构成发布门禁

Codex CLI、Claude Code、OpenCode、GitHub Copilot CLI、Kiro CLI、Qoder CLI、CodeBuddy、
Qwen Code 和 Antigravity 必须全部实现并通过相同 Built-in Tool Transport 合同。九者都具有
Bash/Shell 调用入口，因此本决策不接受删除其中某个 Runtime 来缩小范围。Shell 存在只证明
可行入口，不证明模型实际采用 CLI 或 Core 语义正确。

开发期间可以逐个切换和验证，但正式发布前九者必须分别完成真实模型的 discovery、read、
mutation、receipt replay、Run fencing、错误路径和无重复效果验收。任何一个未通过，整个迁移
保持未完成；不得发布八个 CLI + 一个旧 MCP、八个可用 + 一个降级运行或 fixture-only 的混合
状态。

### Core 拥有调用响应

Canonical Operation Result 是运输无关的扁平业务结果，不包含 `rovaiTeamTool`、
`rovaiTeamReceipt` 或 CLI/MCP 包装字段。Core Router 生成版本化 Built-in Tool Invocation
Envelope，承载 `ok`、canonical `operation`、`requestId`、`receipt` 以及互斥的 `result | error`。
过渡期若存在仅用于迁移验证的 MCP 适配代码，它只能映射 Core Envelope，不能生成 receipt 或
改变 Canonical Operation Result；正式切换完成前必须删除该适配代码。

### 失败必须给出安全、明确的处理规则

Envelope 的 `error` 至少包含稳定且带领域前缀的 `code`、简短可读的 `message` 和机器可判定的
`recovery`。`recovery` 只表达以下处理类别：修正输入后再调用、重新读取后重新判断、以同一
request identity 有界重试、停止调用，或报告结果待确认。可选 `details` 只允许当前版本、目标
标识、等待时长等已列入该错误合同的业务字段；不得返回异常堆栈、SQL、内部文件路径、IPC
地址、凭据、lease secret 或未经筛选的底层错误文本。

乐观锁冲突沿用现有 `task.version_conflict`、`memory.version_conflict` 等 Core 领域错误码，并
统一归入“重新读取后重新判断”。Agent 必须重新读取最新对象、比较变化并决定是否仍需修改；
不得拿旧 `expectedVersion` 自动重复写入，也不得自动覆盖他人的更新。输入错误先修正明确字段；
对象不存在、不可见、已终态或当前 Run 已 fenced 时停止该操作；只有 Core 明确标记为“以同一
request identity 重试”的错误才允许 CLI 有界自动重试。`结果待确认` 继续遵守单独的禁止盲目
重发规则。

Bootstrap 只给出上述通用处理原则；各 operation 的 `tool describe` 公布它可能返回的稳定错误
及 recovery 合同。CLI 和 Runtime Adapter 可以展示 Core 文案，但不能根据自由文本自行改写
重试结论或补造下一步规则。

### 当前 Run 权限不能来自可复用进程身份

稳定 Runtime Process Identity 只证明进程由 Core 管理，不授予当前 AgentRun 的操作权。每次
Fleet acquire 创建新的 Built-in Tool Lease；Core 只接受匹配当前 lease 的调用，并由此推导
AgentRun、Execution Epoch、Native Binding、Camp、Member 和 Context fence。Run 结束时先 fence
该 lease，再允许进程进入 IdleWarm 或绑定后续 Run。旧 Run 的迟到调用不能归属到新 Run，且
所有内部身份与 secret 都不得成为模型输入。

### Shell 子进程共享当前 Run 的调用身份

采用 Shell CLI 意味着当前 Runtime 启动的项目测试、构建脚本和其他子进程也可能间接执行
`rovai`。Core 可以证明调用持有当前 Built-in Tool Lease，却不能在九个 Runtime 上可靠证明
“模型直接输入了这条命令”或“模型主观上希望某段项目代码调用工具”。因此，当前 Runtime
进程及其启动的所有子进程发出的有效调用都归属于同一 AgentRun 和 Member，并接受相同的
可见范围、版本、配额、fence、receipt 与审计规则。

系统不得用父进程名称、命令文本或调用层级猜测模型意图，也不把项目脚本塑造成新的领域 Actor。
嵌套脚本触发的 operation 仍形成独立 Built-in Tool Activity；只有满足既有显式关联合同才与
Shell Evidence 折叠。Run 结束或 release 前 fence lease，此后包括迟到子进程在内的所有调用均
被拒绝。CLI context 与 lease 信息不得写入项目文件或持久化为可复用凭据。

### 重试不重复效果

同一内置调用在响应丢失后的有界自动重试返回原先已提交的结果和 receipt，不重复创建 Task、
Memory、Member Call 或其他效果。同一调用身份携带不同语义输入时返回稳定冲突。若系统无法以
权威 receipt 或拒绝证明结果，则明确返回 `结果待确认`；不得伪装成功、伪装失败或引导 Agent
盲目发起一个新调用。

### CLI shell 只作为可验证的运输证据

一次已由 Core 验证的 CLI invocation 在主活动流中形成一项以 canonical operation 命名的
Built-in Tool Activity。Runtime 同时报告的 Bash/Shell command Evidence 保持不可变，但在
二者存在显式、可验证的调用关联时只作为该活动的 supporting transport Evidence 展示在详情
中，不再形成第二项顶层“执行命令”活动。

Core 不得根据命令文本、operation 名称字符串、时间接近、工作目录或输出相似度猜测关联。
CLI Envelope 中的 Core-owned request/receipt identity 与 Runtime structured command identity
必须建立可验证关联；无法证明时保留两项独立 Activity，而不是错误合并或删除 Evidence。

## Consequences

- 九个 Runtime 面向模型共享同一 canonical CLI 入口，不再承担内置 MCP 名称、方言和权限
  适配；Runtime 差异收缩到进程启动、环境、Bootstrap、Session 和外部 MCP Projection。
- Built-in Tool Catalog 随 App build 在启动时确定；实现无需支持运行中的 catalog 热更新或
  同一 App 进程内的版本切换。
- 当前 Runtime 的子进程共享该 AgentRun 的 CLI 调用身份；每个有效调用都按该 Member 审计，
  系统不对“模型是否有意触发”作无法证明的声明，lease fence 是权限终止边界。
- 内置工具成为基础 AgentRun execution facility 而不是可选降级项；CLI 打包、PATH、IPC、catalog 和 Fleet
  lease 必须进入启动验收与 Runtime compatibility identity。
- 删除内置 MCP 是不保留回退面的 clean break；所有受支持 Runtime 必须在发布切换前完成真实
  CLI discovery、read、mutation、fencing、replay 和 negative-path 验收。
- 切换前清空当前本地应用数据；产品中不增加遗留 MCP 数据迁移、自动清理或兼容检测代码。
- 九 Runtime 是一个不可拆分的发布门禁；单个 Runtime 延误会推迟整个迁移版本，而不是形成
  部分发布或缩减后的支持矩阵。
- 用户外部 MCP 的配置真源、Assignment、Projection、名称映射和非阻塞降级语义保持独立。
- 删除外部 MCP 名称校验中对 `rovai_team` 的特殊保留；同名外部 Server 只是普通第三方 MCP，
  不会进入 Built-in Tool Router。
- Core Router 新增运输无关的结果/错误/receipt 边界，但不得复制现有领域服务或绕开
  DomainCommandGateway。
- Agent 收到失败时可以依据稳定 recovery 合同采取下一步；乐观锁冲突必须先重新读取和判断，
  不能自动覆盖，底层异常与敏感运行信息不得进入模型输出。
- 主活动流不为一次已验证的 built-in invocation 重复显示 shell wrapper；原始 Runtime Evidence
  仍完整保留，且无法验证关联时必须诚实显示为独立 Activity。
- 十二个领域分组命令共享一份 canonical input contract，并支持直接参数、stdin/heredoc 与
  `--input-file`；长正文推荐文件输入，但任何输入方式都不承诺绕开 Runtime Evidence。
- 现有 `member.call`、`task.create`、`task.update` 和 `memory.write` 的 Member-varying Capability
  gate 必须从十二个内置 operation 的调用路径删除；成员资格、Scope、可见范围、版本、配额和
  其他业务不变量继续有效。
- 应用级 `agentMemoryWritesEnabled` 设置及其写入阻断路径被删除；这不改变现有 Memory，也不
  取消 Hearth Proposal 的用户决定边界。

## Rejected Alternatives

- **保留 `mcp_legacy` 作为失败回退。** 这会长期保留两套 Adapter、Schema、别名、Bootstrap
  和验收路径，并使同一 AgentRun 的真实能力取决于隐式回退。
- **为旧本地数据实现自动迁移或清理。** 当前应用尚未形成需要支持的已安装升级面；本次直接
  清空本地数据，避免把一次性开发状态写成长期产品分支。
- **八个 Runtime 先发布，剩余一个以后补齐或移出范围。** 这会让相同 Camp 能力随成员 Runtime
  改变，并违反本次九 Runtime 完整迁移目标。
- **运行中热加载新的 built-in catalog。** App 更新本来就要求重启；加入热更新只会制造不存在的
  中途版本切换状态和额外兼容分支。
- **CLI 不可用时让 Agent 降级运行。** Agent 会在缺少 Task、Camp History、Memory 和 Member
  Call 的情况下继续行动，破坏 Bootstrap 对能力的承诺并制造静默协作失败。
- **只允许模型直接输入的 Shell 命令调用内置工具。** 普通 Shell 无法在嵌套测试或构建进程中
  可靠证明模型意图；父进程和命令文本启发式既可绕过也会误判。选择 CLI 即接受当前 Run
  进程树共享身份，并依靠短期 lease、领域校验和审计约束。
- **同一 Run 同时暴露 CLI 和内置 MCP。** 两个入口会产生重复调用、身份混淆和模型选择漂移。
- **展示完整目录但按 Member Capability 拒绝部分 operation。** 这会保留用户已明确取消的
  成员级工具权限差异；内置目录对每个有效成员具有相同调用资格。
- **保留全局 Agent Memory Write 开关。** 关闭后会让目录中的两项 Memory operation 无法执行，
  与完整目录具有完整调用资格的合同冲突。
- **把外部 MCP 一并代理到 Core。** 外部 MCP 有用户配置、第三方凭据和 Runtime-native 生命周期，
  与 Rovai-owned canonical operations 不共享领域授权边界。
- **继续保留 `rovai_team` 外部名称禁用。** 内置 MCP 已在 clean-slate cutover 中完全删除，继续
  占用旧名称只会留下无业务意义的兼容特例。
- **在 CLI 中重写 Team、History 或 Memory handler。** 这会形成第二套领域逻辑和不一致的
  Capability、fence、版本、配额与审计语义。
- **只返回 `errorCode` 或一段自由文本。** 前者不能指导恢复，后者会迫使 Agent 猜测是否可重试；
  Core 必须同时给出稳定 code、受控文案和机器可判定的 recovery。
- **把所有冲突都标成可自动重试。** 乐观锁冲突意味着业务对象已变化，必须重新读取并重新判断，
  直接重复旧 mutation 会覆盖新事实或持续失败。
- **把十二个完整 Schema 复制进 Bootstrap。** 这会持续占用每个 Session 的上下文，并让
  Bootstrap 文本与 canonical catalog 形成可漂移的双真源。
- **只允许 `--input-file`。** 这会让简单查询、ID 和分页也必须先创建文件，并不能保证创建文件
  的 Shell 命令不记录正文；本次明确支持直接参数、stdin/heredoc 和文件三类输入来源。
- **允许多种输入来源相互覆盖。** 文件、stdin 和直接参数的 merge 顺序会形成难以发现的实际
  请求差异；一次调用必须只选择一种来源，再统一进入 canonical input validation。
- **用 `rovai tool call <operation>` 作为业务入口。** 用户已选择更易读的领域分组命令；dotted
  operation 继续作为内部与合同身份，不直接充当业务命令路径。
- **同时显示 CLI shell 行和 canonical operation 行。** 这把运输细节重复呈现成用户动作；在
  可验证关联存在时应投影为一个 Built-in Tool Activity。
- **按命令文本或时间窗口折叠两行。** 这违反 Runtime Observation Boundary，并可能吞并无关
  shell Evidence；无法建立显式关联时必须保持分离。

## References

- [Rovai-ai domain language](../../CONTEXT.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](0018-file-backed-mcp-library-runtime-projection.md)
- [ADR-0067: Native Session Bootstrap and AgentRun Context v3](0067-native-session-bootstrap-and-agentrun-context-v3.md)
- [ADR-0069: Single Effective Memory and Scope-Bounded Agent Mutation](0069-single-effective-memory-and-scope-bounded-agent-mutation.md)
- [ADR-0088: Attested Native Team Gateway Attachment](0088-attested-native-team-gateway-attachment.md)
- [ADR-0089: Attested Built-in MCP Tool Parity](0089-attested-built-in-mcp-tool-parity.md)
- [ADR-0104: Rovai-Preferred MCP Projection and Non-Blocking External Degradation](0104-rovai-preferred-mcp-projection-and-external-degradation.md)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](0113-core-scoped-operation-identity-and-evidence-deduplication-boundary.md)
- [ADR-0123: Exclusive AgentRun Runtime Processes and Resident Fleet Reuse](0123-exclusive-agentrun-runtime-fleet.md)
