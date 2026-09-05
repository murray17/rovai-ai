---
document_type: contract
name: Runtime Launch and Verification
version: v35
status: accepted
source_version: v1.45
last_updated: 2026-09-05
---

# Runtime Launch and Verification v35

v35 replaces [v34](runtime-launch-and-verification-v34.md). v34 的单一 Pi `--mode rpc` 启动、原生资源、普通
Prompt、结构化图片、exact resume taxonomy、private Session locator、无模型调用 Machine Ready、External MCP
`Unsupported`、`partial_managed`、Preview/NotQualified 与数据 schema 全部保持不变。v35 只收紧 Pi request
correlation、receipt lifecycle、execution epoch，以及公共 Fleet 的 Starting/Stopping operation ownership。

## 1. Pi RPC command correlation

Pi `abort` 是普通 request/response command，不是通知。每次取消必须执行：

```text
allocate request id
→ register pending(command = abort)
→ send
→ consume response with the same id and command
→ remove pending
→ complete waiter
```

外层 AgentRun cancellation deadline 可以先停止等待，但不能删除 RPC correlation。迟到的合法 response 仍由 Host
reader 识别、移除 pending 并消费；receiver 已离开只会使结果无人接收，不能形成 unmatched response、Host poison
或 Host exit。只有真正没有 response 语义的协议通知才允许 one-way send。response 缺少 ID、未知 ID 或 command
identity 不一致仍是 framing/integrity failure。

## 2. Managed receipt 的最终 pre-agent seam

Rovai extension 不注册 `input` hook，也不在 Pi 原生 input pipeline 完成前提交 receipt。每个实际 Agent Turn 在
Rovai 自身的 `before_agent_start` hook 中依次执行：

```text
reload current closed binding
→ validate Host / Run / epoch / Native Session / cwd identity
→ observe the exact bash, edit and write governed Tools
→ construct closed schema-3 receipt
→ submit through the existing Extension UI IPC
→ wait for the Core durable commit nonce
→ verify nonce
→ append exact Bootstrap to the current system prompt
```

任一步失败都 abort 当前 Agent start；不能注入 Bootstrap，也不能把 Input 标为 accepted。如果更早的原生
Extension `transform` 或 `handled` 输入而不进入 `before_agent_start`，Rovai 不产生 receipt，Core 不接受 Delivery。
不再存在 `approvedBindingDigest` 等跨 hook 中间授权状态。

Receipt 仍只证明 Host、Run/epoch、binding generation、Delivery/Prompt、Native Session、cwd、Bootstrap/binding
digest 与三个 governed Tool。它不证明最终 provider system prompt、完整 Tool/Skill/Extension catalog、MCP 或
Session locator。Receipt 插入与 Input accepted 仍为同一 SQLite 事务。

## 3. Pi execution epoch 单调性

Pi Adapter 对相同 `agentRunId` 的 active Runtime 在任何 cleanup、unbind、active removal、Fleet release 或 Host stop
之前比较 execution epoch：

```text
existing == requested  → 复用健康 Runtime，或按同 epoch 处理失效 Runtime
existing < requested   → 新 epoch 可精确退休旧 epoch 后创建
existing > requested   → requested stale，立即拒绝且不得触碰 existing
```

创建完成时必须再次执行 commit fence；迟到旧创建不能覆盖较新 active Runtime。complete、forget、cancel cleanup、
Host exit 与迟到 callback 只能删除精确匹配的 `(agentRunId, executionEpoch)`；仅凭 `agentRunId` 不授予删除权。

## 4. Fleet-owned Starting operation

Fleet Reserve 创建 `Starting` reservation 后，必须在不经过新的 suspension point 前启动 Fleet-owned Startup
Operation。`acquire()` 调用方只是 completion waiter，不拥有 spawn future：任意 waiter 被 drop 不影响 operation，
其他相同 Run/epoch waiter 继续观察同一 Committed、Failed 或 Cancelled 结果。

AgentRun stop、invalidation、Camp deletion 与 Fleet shutdown 命中 Starting 时，短临界区设置 retire/cancel 并向
Startup Operation 发取消信号。Operation 自己拒绝 commit；如果 Host 已创建则 shutdown/reap；随后以精确
reservation identity 删除 entry、释放 resident capacity 并完成所有 waiter。spawn failure、取消和 commit rejection
都不得留下无 completion 的 Starting。

## 5. Fleet-owned Stop operation

所有 stop 入口统一为：

```text
Mark Stop (short global transition)
→ Reap (outside global operations lock)
→ Commit Stop (short exact-generation transition)
```

Mark Stop 把 Busy/Idle 变为 Stopping、移出可复用候选并登记唯一 stop completion。解除 Built-in Tool lease、graceful
shutdown、等待、force terminate 与 process-tree reap 都不得持有 Fleet global operations lock。一个慢 Host 不能
阻塞无关 acquire、release、spawn 或 stop。

同一 ProcessEntry 已有在途 stop 时，后续 stop 只等待相同 completion，不启动第二套 shutdown/reap。只有确认
reap 且 entry 仍匹配相同 stop operation 才删除 process、run lease、owner record 与 capacity；timeout 后 entry
保留 Stopping，Resident capacity 继续计入，下一次显式 stop 可以创建新的重试 operation。该语义覆盖 release、
forced AgentRun stop、idle sweep、invalidation、Camp fence/delete、shutdown 与 LRU capacity eviction。

## 6. Pi Extension UI ownership

标题和 schema 精确匹配 Rovai managed receipt、`bash/edit/write` approval 或 managed status/binding channel 的请求，
继续执行严格 identity validation；伪造、冲突或 framing 损坏可以 fail closed。

第三方 Pi Extension 的 `select`、`input`、`editor`、普通 `confirm` 与其他未映射交互返回原生 cancelled/denied
response；纯展示通知可以忽略或转为 diagnostic。Rovai 没有产品 UI 映射不属于 Host integrity failure，不得
mark Host failed、poison Host 或终止 AgentRun。

## 7. 不变边界

Pi 继续由原生 ResourceLoader 发现 Extensions、Skills、Context、Prompt Templates 与 Built-in Tools；Rovai Skill
只物化到 `.pi/skills`，不做二次发现。Rovai 不恢复 MCP bridge、Slash/CURRENT_INPUT parsing、Prompt Transform、
manual Skill expansion、`get_commands` activation dependency、Tool whitelist、`setActiveTools()`、完整 catalog
attestation 或 `--no-extensions` fallback。Session、Bootstrap、Skill、model、Prompt 与 MCP Assignment 不进入 Pi
process LRU key。

## References

- [Runtime Launch and Verification v34（historical）](runtime-launch-and-verification-v34.md)
- [V1.44-D01](../versions/v1.44/decisions.md#v1-44-d01)
- [V1.44-D02](../versions/v1.44/decisions.md#v1-44-d02)
- [V1.45-D04](../versions/v1.45/decisions.md#v1-45-d04)
- [V1.45-D05](../versions/v1.45/decisions.md#v1-45-d05)
