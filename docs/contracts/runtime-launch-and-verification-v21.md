---
document_type: contract
name: Runtime Launch and Verification
version: v21
status: accepted
source_version: v1.27
last_updated: 2026-08-22
---

# Runtime Launch and Verification v21

v21 replaces [v20](runtime-launch-and-verification-v20.md). v20 的 launch purpose、identity fencing、Ready、
LKG、检查 attempt、公开 failure、MiniMax provider secret、thinking 清洗与 External MCP 收窄保持不变；本版
修正 Kimi Code 的私有 home 生命周期，把已经由 Runtime 与产品 Host 验证的 exact native continuation 纳入
当前合同，并以修正后的完整 Built-in 资格矩阵晋升 macOS arm64 平台。

## Kimi 私有 Session home

Kimi 仍以 `<resolved-executable> acp` 启动，使用 ACP v1 newline-delimited JSON-RPC。Core 不读取、改写或
复用用户 `~/.kimi/config.toml`，也不修改进程的通用 `HOME`。`KIMI_CODE_HOME` 指向 Rovai data-dir 内的
私有 Session home，其稳定 scope 必须至少绑定：

```text
schema version + AdapterKind + Camp ID + Agent ID + Runtime installation ID + auth scope
```

目录名使用该 scope 的 canonical digest，不暴露原始标识。目录创建后必须保持用户私有权限。相同 scope 的
后继 Host 必须得到同一路径；不同 Camp、成员、Installation 或 auth scope 不得共享该路径。该目录属于 Native
Session 持久状态，不随单个 Host shutdown 删除；Kiro 等每 Host 临时配置的生命周期不因此改变。

## Kimi exact continuation

每个 Kimi AgentRun terminal 可见前仍停止并回收 Host 进程树，不要求 warm Host reuse。后继兼容 AgentRun
持有既有 Native Session ID 时，continuation 顺序为：

1. 同 Host 已知 Session 时直接复用；
2. 新 Host 且 capability 声明 `session.resume` 时，向稳定私有 home 发送 exact `session/resume`；
3. 只有没有 resume、但声明 `session.load` 时才进入既有 History Restore replay quarantine；
4. 没有既有 Session ID 或无 continuation capability 时才建立 `session/new`。

`session/resume` 与 `session/load` 都必须恢复请求中的精确 Session ID。Runtime 返回其他 ID、协议异常、超时
或 replay 超限时必须 fail closed，停止失败 Host，并沿用既有 continuity-lost 与新 Binding 规则；不得静默换绑
到返回的其他 ID。Capability snapshot 可以声明实际 initialize/capability evidence 中的 `session.resume` 和
`session.load`，但不得由此开启 External MCP、Usage/Cost、Compaction 或 warm Host reuse。Built-in transport
必须由独立完整资格矩阵决定。

## macOS arm64 平台准入

Session continuation 修复只收口 Native Session 正确性，不替代 Runtime Platform Admission 的逐轴资格证据。
早期 Built-in CLI 资格运行的 `0/15` 不是 Runtime 拒绝执行：验收脚本把 legacy stdin 非法输入的当前确定性
退出码 `2` 错写为 `1`，Kimi 实际已经执行脚本，并在第一项 canonical operation 前被该过期断言终止。修正
fixture 后，Kimi `0.32.0` + MiniMax M3 在 macOS arm64 完整通过十五项 operation、三种输入模式、Gather
capture、精确后继寻址、stale-version conflict、initial/resumed lease fencing、logical conversation 与 native
Session continuation；本次运行产生 56 条 full-run evidence。因此 macOS arm64 为 `qualified`，并发布绑定当前
兼容性清单 digest 的 evidence revision；capability snapshot 声明 Built-in transport，默认 Built-in 与 Skill
资格集合包含 Kimi。

macOS x64 与 Windows x64 继续为 `not_qualified / runtime_platform.qualification_evidence_missing`。异步
`available_commands_update` 已由 Host 作为私有 Session metadata 安全路由；Rovai 尚未把它维护为产品权威
catalog snapshot，但这不是 Kimi 启动、continuation、Built-in transport 或 macOS arm64 平台准入的硬阻断。

## Acceptance

- 相同逻辑 scope 的两个 Kimi Host 使用同一私有 home，不同 scope 使用不同 home；Host shutdown 后该 home
  仍存在；
- 两个连续 AgentRun 使用不同 Host instance，协议依次为一次 `session/new` 和一次 exact
  `session/resume`，Native Session ID 保持不变；
- snapshot 保留真实 `session.resume/load` 和独立验证通过的 Built-in transport，同时继续不声明 External MCP；
- Kiro 每 Host 临时配置、退出清理和其他 Runtime continuation 策略不发生语义变化；
- 真实项目级 Kimi smoke 必须断言跨新 Host 的 Native Session ID 延续，且不能把新 Host 误报为 warm reuse；
- macOS arm64 的完整 Built-in CLI 运行必须保持十五项 operation、三种输入、Gather、conflict、lease fence、
  exact successor read 与 logical/native continuation 全部通过；其他平台不得从该结果外推资格。

## References

- [Runtime Launch and Verification v20](runtime-launch-and-verification-v20.md)
- [Runtime Platform Admission v1](runtime-platform-admission-v1.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Kimi Code Runtime Research](../research/kimi-code-runtime-research.md)
- [V1.27-D03](../versions/v1.27/decisions.md#v1-27-d03)
