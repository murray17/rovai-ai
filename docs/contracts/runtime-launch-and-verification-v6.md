---
document_type: contract
name: Runtime Launch and Verification
version: v6
status: accepted
source_version: v1.04
last_updated: 2026-08-18
---

# Runtime Launch and Verification v6

本合同继承 [v5](runtime-launch-and-verification-v5.md) 的 launch purpose、light discovery、显式检查、
execution-deferred verification、权限默认、Prompt fence 与 response-only input ACK，并按
[ADR-0209](../adr/0209-bounded-trae-cold-session-history-restore.md)增加 TRAE 冷 Session 恢复。

## 1. Continuation selection

已有 Native Session 的 TRAE AgentRun 必须按以下优先级选择，不能跳级猜测：

```text
same compatible Host knows exact Session
  -> ACP session/resume capability
  -> capability-gated exact-ID TRAE Provider Resume
  -> ACP session/load HistoryRestore capability
  -> New Session
```

当前 `0.120.52` Provider Resume Probe 不合格，因此没有 active Provider Resume launch shape；实际选择为
same Host、ACP resume、HistoryRestore、New。任何未来 Provider Resume 必须使用 `--resume=<exact-id>` 或
另一种经协议证明的明确赋值形式，禁止 `AUTO`，且恢复 Host 在绑定目标 Conversation 前保持 exclusive。

## 2. TRAE HistoryRestore state machine

HistoryRestore 使用已有 Rovai Native Session ID，顺序固定为：

```text
Host initialize
  -> bind exact Session route as LoadingReplay
  -> session/load({sessionId,cwd,mcpServers,additionalDirectories})
  -> matching successful RPC response (replay barrier)
  -> Ready
  -> PromptActive(current delivery)
  -> session/prompt(current request)
```

在 replay barrier 前不得发送当前 AgentRun prompt。load response 返回不同 Session ID 时，旧 route 必须解绑，
返回 ID 仍须以 `LoadingReplay` 绑定后才能进入 Ready；失败 response 不得形成 Session binding。

## 3. Replay quarantine and limits

`LoadingReplay` 的 session-scoped notification、assistant text、tool lifecycle、permission request、usage、
server request 和未知 event 都只计入恢复预算，不产生 `AcpIncoming` 业务投影。它们不得进入：

- Execution Evidence、Action、Approval 或 Usage；
- Missing-Send Recovery、Compaction 或 Runtime Input ACK；
- Renderer event、最终输出或当前 prompt transcript。

当前固定预算为最多 4096 个 replay event、累计 8 MiB protocol line bytes 和 30 秒。任一上限超出、非法
JSON、目标之外的 Session event、协议异常、Host exit、timeout 或 error response 都必须拒绝 pending load、
标记 Host protocol-violated 并进入失败回退。恢复期 server request 可以收到通用拒绝 response，但其请求和
结果不能投影为当前 Run 的 Approval/Action。

## 4. Compatibility and ownership fence

TRAE Native Session compatibility key 必须冻结并持久化以下输入：

- Adapter/Installation identity、protocol 与 executable fingerprint；
- Host config digest；
- canonical execution root、workspace access 与 isolation；
- resolved model ID/options 和 permission values。

任一输入变化均产生不同 key，使旧 Session disposition 为 New；不得先尝试 load 再判断。Camp/Conversation
持久 Binding、Fleet 的 Camp/Agent/runtime key、Host/Run/epoch/Session/Prompt/Delivery route fence 共同禁止
跨 Camp 或跨 Conversation 复用。

## 5. Failure and continuity evidence

HistoryRestore/ACP resume 失败且当前 prompt 尚未发送时，Core 必须原子地保持旧输入未 accepted，并：

1. 持久追加 `agent_run.native_session_continuity_lost`，记录 continuation、失败分类与 `new_session` fallback；
2. 从 Fleet 移除并停止失败 Host；
3. 强制轮换 Native Binding 和 Built-in Tool credential；
4. 使用新 Host 执行 `session/new` 并绑定返回 ID；
5. 只向新 Session 发送当前 AgentRun input。

错误 ID、workspace/模型/权限/Host/executable 不兼容、load timeout 或 replay 异常都不得静默保留旧 Binding。
当前 prompt 已发送后的不确定性继续受 Accepted Input Recovery 合同约束，不使用本节重发路径。

## 6. Unchanged boundaries

- v5 的 TRAE light discovery、Availability Check、launch matrix 与 Ready commit fence 不变；
- 数据库 schema、公共 Core wire request/event 和 Renderer schema 不变；
- 其他 ACP Adapter 继续使用各自已准入的 continuation；
- 不读取 TRAE 私有 cache、不修改用户 TRAE 配置、不从“最近 Session”推断 ID。

## References

- [Runtime Launch and Verification v5（历史）](runtime-launch-and-verification-v5.md)
- [ADR-0209](../adr/0209-bounded-trae-cold-session-history-restore.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
- [TRAE ACP Probe](../research/trae-cli-runtime/probe/README.md)
