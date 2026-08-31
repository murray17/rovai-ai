---
document_type: contract
name: Runtime Launch and Verification
version: v29
status: accepted
source_version: v1.34
last_updated: 2026-08-31
---

# Runtime Launch and Verification v29

v29 replaces [v28](runtime-launch-and-verification-v28.md). v28 的进程、权限、平台准入、Probe、模型目录、
Session、continuation 和错误边界不变；仅增加 [Camp Member Fast v1](camp-member-fast-v1.md) 的可选覆盖。

Fast 资格检查经过现有 Runtime Check Manager，不写一般 Product availability 的 attempt 结果；同 Runtime
检查仍串行，全局并发预算不变。请求绑定 Camp/member/revision/cwd 和既有模型配置，过期结果不得覆盖新绑定或新模型的资格。检查只允许
原生 auth/account/config/model metadata，使用受管 RuntimeProbeProcess、既有环境构造与有界清理。

正常 Claude/Codex Run 在发送输入前复核资格，消费已冻结偏好。Claude 新建与 resume 都只传单一 inline
settings；Codex 只传 `serviceTierForTurn`，缺少该原生字段就隐藏 Fast，不退回持久 `serviceTier`。
认证或资格检查失败不冒充请求已生效，也不删除 Camp 偏好。不新增独立 Probe 调度器、通用 performance
capability 注册表、凭据 reader、全局 settings writer 或 Native Thread 配置写入。

Native Fast 观察只进入当前 AgentRun/epoch 的 Execution Evidence，以及 Codex 按 Run 的 Usage 档位监控；
不回写 Camp 偏好、默认或成员浮层，不进入 Canonical Activity 或模型上下文。
新增 RPC、错误、作用域、生命周期和三态映射由 [Camp Member Fast v1](camp-member-fast-v1.md) 精确定义。
