---
document_type: adr
id: ADR-0123
title: Exclusive AgentRun Runtime Processes and Resident Fleet Reuse
status: accepted
date: 2026-08-06
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
---

# ADR-0123: Exclusive AgentRun Runtime Processes and Resident Fleet Reuse

## Context

Rovai-ai 当前存在三种不一致的 Runtime 进程生命周期：

- Codex app-server 按 ADR-0107 为每个 AgentRun 新建并在 Run 终态关闭；
- ACP Adapter 在没有 Team Tool 且部分进程级配置允许时，可以让多个 AgentRun 共享同一
  Host；有 Team Tool 或严格进程级 MCP 配置时则使用独占 Host；
- Claude Code 与 Antigravity 使用单次调用进程，Run 结束后自然退出。

ACP 共享 Host 使一个进程可以同时路由多个 Session 和 AgentRun。进程级凭据、私有 MCP
投影、工作目录、附件根和 Runtime 自身缓存因此必须同时支持多租户隔离；任何遗漏都会把一个
Run 的配置或事件路由到另一个 Run。另一方面，所有可复用 Runtime 都按 AgentRun 关闭会增加
启动延迟与资源抖动，也无法统一控制空闲进程占用。

需要统一的语义是：一个 Runtime 进程可以串行服务兼容的 AgentRun，但不能同时服务两个
AgentRun。保留并复用的进程必须受到成员级和全局常驻配额约束；配额只控制跨 Run 保留的资源，
不能成为普通 AgentRun 的执行并发上限。常驻池满时，新 Run 仍应通过仅服务本 Run 的 Burst
进程启动。

进程复用还会改变现有凭据生命周期。部分 ACP Runtime 可能在进程内、私有配置文件或它启动的
MCP 子进程中继续保留冻结的外部 MCP 凭据。若主进程进入空闲常驻状态，这些状态不会在
AgentRun 终态立即销毁，必须明确其上限、失效和授权规则，而不能继续声称遵循 ADR-0018 的
逐 Run 立即清理语义。

## Decision

### 1. 正式 AgentRun 独占一个 Runtime 进程

任一时刻，一个 Runtime 进程最多绑定一个正式 AgentRun。Core 不再因为 AgentRun 没有
Team Tool 而允许多个 AgentRun 同时共享一个 ACP Host。Native Session 可以跨 AgentRun
保持连续，但 Session 连续性不赋予并行共享进程的资格。

以下 Runtime 在 Run 结束后可以由 Adapter 证明健康并进入空闲常驻状态：

- Codex CLI；
- OpenCode；
- GitHub Copilot CLI；
- Kiro CLI；
- Qoder CLI；
- CodeBuddy；
- Qwen Code。

Claude Code 与 Antigravity 保持 run-scoped one-shot：它们不进入常驻池，Run 结束后进程自然
退出并从 Fleet 移除。

Context Compaction 等不属于正式 AgentRun 的内部作业继续使用临时独占进程。内部作业不复用
正式 AgentRun 的进程、不进入常驻池，完成后立即关闭。

### 2. AgentRuntimeFleetManager 是唯一正式进程所有者

新增深模块 `AgentRuntimeFleetManager`。其外部接口只表达以下操作：

```text
acquire AgentRun process
release AgentRun process
invalidate processes by owned scope
shutdown Fleet
```

调用方不得直接选择共享 Host、修改 Fleet 状态、维护配额或操作 LRU。Manager 在内部封装：

- 创建、复用、停止和 reap Runtime 进程；
- AgentRun 与进程的唯一 lease；
- 成员级和全局 Resident accounting；
- IdleWarm 索引、TTL、LRU 和周期性 Sweeper；
- Core generation、进程所有权证明和崩溃后清理；
- Resident、Burst 与 one-shot 的不同结束策略。

Runtime 差异位于 Adapter seam。Adapter 根据已经冻结的进程启动输入生成 opaque
`runtime_compatibility_digest`，并负责 spawn、健康与 quiescence 判断、Run 绑定/解绑和停止。
Manager 不解析模型、权限、MCP、Team attachment、工作区或 Runtime 私有配置字段。

一次 acquire 返回不可复制的 Runtime lease。lease 至少绑定：

```text
process_id
agent_run_id
execution_epoch
lease_generation
```

进程事件、释放、取消和迟到回调都必须匹配当前 lease；仅持有 `process_id` 或旧
`host_instance_id` 不产生执行权。

### 3. 复用兼容性采用三项精确相等

IdleWarm 只有在以下三项全部精确相等时才能复用：

```text
camp_id
agent_profile_id
runtime_compatibility_digest
```

`runtime_compatibility_digest` 由对应 Adapter 在所有进程级启动输入确定后生成，随 AgentRun
冻结并持久化。凡是可能让一个已启动进程与新 Run 不兼容的输入都必须参与该 digest；哪些输入
属于进程级由 Adapter 决定。Manager 不以字段子集、Runtime 名称、Native Session ID 或模糊
匹配替代 digest 相等。

进程级输入发生变化而 Adapter 不能证明已启动进程仍兼容时，Adapter 必须生成不同 digest 或
声明该进程不可复用。纯 Prompt/Turn 级输入可以不进入 digest，但不得因此热改已经固定在进程
中的配置。

`runtime_compatibility_digest` 与 Native Session 的 `binding_compatibility_digest` 是不同身份：
前者决定物理进程能否复用，后者决定原生会话能否继续。进程替换不自动丢弃兼容 Native
Session，Native Session 连续也不允许绕过进程兼容性。

### 4. Resident 配额只约束跨 Run 保留的进程

默认常驻配额为：

```text
max_resident_processes_per_member = 20
max_resident_processes_global = 200
```

一个配额槽位对应一个由 Fleet 登记的 Runtime 根进程，而不是该 Runtime 启动的每个 MCP、Shell
或其他后代进程。后代必须归属于根进程的停止与进程组清理，但不单独消耗 Resident 槽位；因此
20/200 是受管 Runtime 根进程上限，不是整棵进程树的 OS 进程数或内存上限。

成员配额键为 `agent_profile_id`，跨该成员所在的全部 Camp 计算。Resident 进程在以下所有阶段
都占用成员和全局槽位：

```text
Starting
BusyResident
IdleWarm
Stopping
```

`Starting` 在实际 spawn 前原子预留槽位，防止并发申请越过 20/200。`Stopping` 直到子进程
真正退出并被 reap 才释放槽位。仅从兼容查找或 LRU 删除条目不等于释放 Resident accounting。

Fleet 不新增运行中 AgentRun 数量上限，也不为 BusyBurst 设置成员级或全局数量上限；
ADR-0058 的每 Conversation 单槽和其他既有领域准入约束继续有效。BusyBurst 不占用 20/200，
只服务当前 AgentRun，Run 结束后必须关闭。Resident 满载、Burst 数量继续增长时，系统以真实
OS spawn 结果作为最终资源边界；不会因 Fleet 容量把 Run 放入
`waiting(runtime_capacity)`。spawn 失败按现有 AgentRun 启动失败与恢复语义处理。

### 5. acquire 原子选择兼容进程、Resident 或 Burst

每次正式 AgentRun 申请进程时，Manager 按以下顺序处理：

1. 先清理可确认不健康、已经失效或超过 TTL 的 IdleWarm；
2. 若存在三项身份完全匹配且健康的 IdleWarm，原子绑定 lease 并转为 BusyResident；
3. 若成员与全局 Resident 配额都有空位，预留 Starting 槽位并创建 BusyResident；
4. 若成员配额已满，只有该成员自己的 IdleWarm 能释放成员槽位；没有此类进程时直接创建
   BusyBurst，淘汰其他成员的进程没有意义；
5. 若全局配额已满，优先选择当前成员最久未使用的 IdleWarm，再选择全局最久未使用的
   IdleWarm；
6. 若没有适用的 IdleWarm，创建 BusyBurst。

淘汰候选在 Manager 的原子状态操作中从 IdleWarm 转为 Stopping，并立即从兼容查找与 LRU
索引移除。Manager 给 shutdown/reap 一个短且有界的期限：

- 期限内真正退出并释放槽位：预留该槽位并创建 BusyResident；
- 期限内未退出：创建 BusyBurst，旧 Stopping 进程继续接受强制清理；
- 不允许把 Stopping 当作已经释放的槽位，也不允许 BusyBurst 在稍后有空位时晋升为
  Resident。

配额检查、IdleWarm 领取、Starting 预留和 lease generation 分配必须是一个原子状态决定。
耗时 spawn/stop 在 Manager 状态锁外执行，并用 operation generation 防止完成回调提交到已经
失效的预留。

### 6. Run 结束由 Adapter 给出可复用结论

Resident 只有同时满足以下条件时转为 IdleWarm：

- AgentRun 已经通过当前 execution fence 进入可接受的结束点；
- Runtime 进程仍健康；
- 没有活动 Prompt/Turn、待处理 RPC、Approval、Action 或未知投递；
- Team lease 已解绑或 fenced；
- Adapter 能证明进程已经 quiesce，且当前配置仍有效。

Adapter 不能证明任一条件时，Manager 必须关闭进程。协议错误、配置失效、Runtime 异常退出、
取消后状态不确定或输入投递结果未知都不能进入 IdleWarm。

BusyBurst 无论 Run 成功、失败或取消都进入 Stopping 并关闭。Claude Code 与 Antigravity 的
one-shot 进程在完成后自然退出；异常未退出时仍由 Manager 执行有界停止。

### 7. Idle Sweeper 强制随 Fleet 启动

默认配置为：

```text
idle_ttl = 30 minutes
sweep_interval = 60 seconds
```

构造并启动可接收 acquire 的 `AgentRuntimeFleetManager` 时必须同时启动周期性 Idle Sweeper；
不能依赖外部调用方选择是否启动。Sweeper 每轮扫描全部 IdleWarm，并把超过 `idle_ttl` 的进程
立即转为 Stopping、关闭和 reap。

TTL 使用单调时间判断，不受系统时钟回拨影响。LRU 使用单调递增的 `last_used_sequence`，不
要求真实链表。实现可以使用权威 `HashMap<ProcessId, ProcessEntry>` 与只索引 IdleWarm 的
`BTreeSet<(last_used_sequence, ProcessId)>`。

进入 Stopping 时，进程立即从兼容索引、IdleWarm 成员索引和 LRU 移除；为了保持 Stopping
仍占 20/200，它继续存在于权威进程表和 Resident accounting 中。只有 reap 完成后，才从成员
与全局 accounting 以及权威进程表删除。

周期扫描不是唯一清理入口。以下事件必须立即执行对应清理：

- 进程申请：先回收不健康、失效和过期 IdleWarm，再进行容量决定；
- Run 结束：立即执行 quiescence/健康判断并转为 IdleWarm 或 Stopping；
- Camp 删除：关闭该 Camp 的全部可复用进程；
- 成员永久移除：关闭该 `agent_profile_id` 的全部可复用进程；
- Runtime 配置、Installation、协议、投影或其他进程兼容输入变化：关闭已空闲的旧 digest
  进程。

配置变化时，正在执行的 Resident 立即失去后续复用资格并标记 `retire_after_run`，但不因容量
回收自动终止已经冻结的 AgentRun。现有取消、安全撤权和 execution fencing 规则仍可独立使
活跃能力立即失效。ADR-0057/0058 对成员永久移除和 Camp 删除的 quiescence gate 继续有效，
删除清理不能绕过这些业务约束。

### 8. IdleWarm 明确保留进程级外部 MCP 状态

Reusable Resident 可以在 IdleWarm 期间保留其精确冻结的外部 MCP 投影、Runtime 内存、必要
私有配置文件以及 Runtime 已启动的 MCP 子进程或连接，直到 TTL 到期后的下一轮 sweep、失效
事件或容量淘汰触发关闭。默认到期发现延迟不超过一个 `sweep_interval`；进入 Stopping 后不再
可复用，但凭据和子进程在 Runtime 真正退出前仍可能存在。`idle_ttl` 是开始回收的期限，不是
绝对凭据擦除时刻。产品和工程文档不得继续把这类 Resident 描述为 AgentRun 终态即销毁全部
投影凭据。

只有三项复用身份完全相同的后续 Run 可以领取该进程。空闲期间没有活跃 AgentRun lease，
所有 Team Tool `list`/`call` 都必须在当前 Run、Execution Epoch 和 lease 校验处失败关闭，稳定
表现为 `run_not_bound` 或等价无领域写入结果。外部 MCP 不经过 Core 通用 Proxy，因此其状态
保留属于明确接受的本机凭据生命周期扩张，而不是 Core 已撤销外部凭据的保证。

Adapter 能在不影响复用的前提下提前删除私有文件或停止 MCP 子进程时可以这样做；不能证明时
必须保留精确字节或关闭整个 Runtime，不能在空闲进程内重建为最新配置。Camp/成员删除、配置
失效和 TTL 回收仍必须删除 Rovai-owned 私有投影并停止可证明属于该 Runtime 的子进程。

本节局部替代 ADR-0018 对 reusable Resident 的“AgentRun 终态立即删除 Runtime-native
projection”要求。逐 AgentRun 冻结 Projection Input/Exposure、恢复使用原冻结输入、外部 MCP
真源、精确投影和 redaction 要求继续有效。

### 9. Fleet 不跨 Core generation 复用

Fleet 的进程表、lease、IdleWarm 与 LRU 是单个 Core generation 的内存状态，不写入 SQLite，
也不在 Core 重启后重新接管。正常 Core shutdown 必须停止并 reap 全部 Resident、Burst 和仍在
运行的 one-shot 进程。

每个 Runtime 使用可单独终止的进程组，并留下最小、私有的 owner record。记录只用于崩溃后
清理，包含 Core generation token、PID、进程组身份和冻结可执行文件路径；启动清理必须同时
校验记录属于旧 generation、PID 仍是该进程组组长且当前命令身份匹配。它不是可恢复 Fleet
状态。仅凭 PID、文件路径存在或同一用户 UID 不得杀进程；平台无法提供可靠的进程身份证明时
必须保留记录并等待后续人工清理，而不能猜测性终止。

Core crash/restart 使全部旧 Team credential、Attested lease、Runtime lease 和 IdleWarm 失效。
旧进程清理后，非终态 AgentRun 通过现有 Runtime recovery 与 execution fencing 使用新进程
恢复；旧 IdleWarm 不产生任何复用权。

本节局部替代 ADR-0107 的“Codex app-server 每 AgentRun 新建且终态即关闭”条款。ADR-0107
的 `(campId, agentProfileId)` Isolated Codex Home、Home 配置所有权、Native Session 连续、
Camp 删除 cleanup record 和 orphan GC 继续有效。Codex Resident 仍不得跨 Home 复用；不同
runtime digest 的新进程启动前必须遵守 Home 的活动进程和配置写入 fencing。

## Consequences

- 所有正式 AgentRun 获得统一、可验证的进程独占语义，ACP 不再存在无 Team Tool 时的并行
  Host 共享特例。
- Codex 与六种 ACP Runtime 可以在兼容 Run 之间复用启动成本，同时每成员最多保留 20 个、
  全局最多保留 200 个 Resident 根进程；Runtime 后代进程不受这两个数字直接计数。
- Resident 配额不提供总并发保护。BusyBurst 无上限意味着极端并发可能耗尽内存、PID、文件
  描述符或其他 OS 资源，并最终表现为 spawn 失败；这是被明确接受的运行风险。
- Stopping 仍占槽位和有界淘汰等待会使部分申请退化为 Burst，但不会为了降低启动数而突破
  20/200。
- IdleWarm 把部分外部 MCP 凭据、进程内状态和子进程生命周期延长到默认 30 分钟 TTL 后的
  下一轮扫描，并持续到进程实际退出；精确兼容身份、Team fail-closed、及时失效清理和真实
  退出确认成为强制安全条件。
- Manager 需要可靠处理 acquire/release/cancel/config-change/sweep/shutdown 竞态，并让所有
  完成回调携带 operation 或 lease generation。
- Core crash 后不会保留 warm-start 优势；安全清理旧进程和恢复 AgentRun 优先于跨 Core
  复用。
- AgentRun 与 Native Session 仍是持久业务事实，Fleet 状态只是可丢失的进程控制状态；不新增
  SQLite Resident、IdleWarm 或 LRU 真源。

## Rejected Alternatives

- **没有 Team Tool 时继续共享 ACP Host。** 这保留进程内并行多租户和路由复杂度，违反一个
  进程同一时刻只服务一个 AgentRun 的统一语义。
- **所有 Runtime 永远按 Run 新建进程。** 语义简单，但放弃兼容进程串行复用和受控常驻池的
  启动收益。
- **Fleet Manager 解析统一兼容字段。** 不同 Runtime 的进程级输入并不相同，会把 Adapter
  私有知识泄漏到 Manager 并形成不完整的跨 Runtime 超集。
- **达到 Resident 配额后阻塞或排队 AgentRun。** Resident 配额只控制可跨 Run 保留的资源；
  本决策选择无上限 BusyBurst 继续启动。
- **为 BusyBurst 增加全局硬上限。** 这会形成独立的运行并发准入合同，与“不设置运行中
  AgentRun 上限”的选择冲突。
- **IdleWarm 转为 Stopping 即释放 Resident 槽位。** 实际进程尚未退出时创建新 Resident 会让
  物理常驻数突破 20/200。
- **淘汰时无限等待退出。** 一个失效 Runtime 可以让新 Run 无限等待；短期限后使用 Burst
  保留进展。
- **BusyBurst 在空位出现后晋升 Resident。** 这会让一次 acquire 的结束策略在 Run 中途变化，
  扩大竞态并破坏 Burst 无条件关闭语义。
- **配置变化时为回收槽位终止 BusyResident。** 容量管理不能杀死正在执行的 AgentRun；旧
  进程应 retire-after-run。
- **保持 ADR-0018 的终态凭据清理并同时允许所有正式进程 IdleWarm。** Runtime 可能已经在
  内存或 MCP 子进程中持有凭据，无法同时真实保证两种语义。
- **跨 Core 重启重新接管 Resident。** 当前 stdio Host 不可重连，且旧 credential、lease 和
  generation 必须失效；实现接管需要独立 Supervisor 与新的可重连协议。

## References

- [v0.41 当前版本；本 ADR 不扩张其既有实施范围](../versions/v0.41/README.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](0018-file-backed-mcp-library-runtime-projection.md)
- [ADR-0057: Member Presence and Retained Permanent Removal](0057-member-presence-and-retained-removal.md)
- [ADR-0058: Collaboration v4](0058-collaboration-v4-presence-aware-admission.md)
- [ADR-0062: Interruptible Runs and Unsettled External Effects](0062-interruptible-runs-and-unsettled-external-effects.md)
- [ADR-0079: Two-Phase Cancellation Projection and Bounded Runtime Interrupt](0079-two-phase-cancellation-projection-and-bounded-runtime-interrupt.md)
- [ADR-0082: Member-Owned Runtime Parameters and Explicit Configuration](0082-member-owned-runtime-parameters.md)
- [ADR-0088: Attested Native Team Gateway Attachment](0088-attested-native-team-gateway-attachment.md)
- [ADR-0107: Camp-Member Isolated Codex Home and AgentRun-Scoped App Server](0107-camp-member-isolated-codex-home-and-agentrun-app-server.md)
