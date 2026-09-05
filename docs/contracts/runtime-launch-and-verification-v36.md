---
document_type: contract
name: Runtime Launch and Verification
version: v36
status: accepted
source_version: v1.48
last_updated: 2026-09-05
---

# Runtime Launch and Verification v36

v36 replaces [v35](runtime-launch-and-verification-v35.md). v35 的 correlated `abort`、execution epoch、Fleet-owned
Starting/Stopping、exact resume、private Session locator、无模型调用 Machine Ready、结构化图片、Preview/NotQualified
和第三方 Extension UI 安全取消继续有效。本版只把 Pi 从 Rovai-managed Approval/Receipt 收敛为原生 Pi 执行。

## 1. 单一原生启动

正式 Pi Host 固定为：

```text
pi --mode rpc --no-themes --approve --extension <rovai-extension>
```

`--approve` 只信任本次进程的当前项目，使 Pi 原生 ResourceLoader 可以加载项目 Skills、Extensions、Context files、
Prompt templates 与项目配置；它不是 Tool Approval，也不创建 Rovai permission mode。Core 不修改 Pi 全局 trust 设置，
不提供 project-trust handler、`resources_discover` 或 `--no-extensions` fallback。项目 Extension 启动错误保留真实诊断。

## 2. 薄 Extension

Rovai Pi Extension 只有两个职责：

1. Session 建立或切换时上报 Host binding generation、Native Session ID、完整私有 Session file 与 cwd，供 activation
   和 exact resume 校验；完整 locator 不进入公开事件、Activity、diagnostic 或 read model。
2. 每个 `before_agent_start` 重新读取当前 binding，把该 Run 的完整 Bootstrap 追加到当时的 Pi system prompt。

Extension 只验证 binding 基本结构与 Bootstrap digest。它不缓存前一位成员或 Run 的 Bootstrap，不验证 Session/cwd、
Tool/Skill/Extension catalog，不注册 `input` 或 `tool_call` hook，不提交 Receipt，也不调用 `ctx.abort()`。Binding 或
Bootstrap 读取失败只发布脱敏 diagnostic 并返回 `undefined`，Pi 按原生行为继续。

## 3. Prompt admission 与生命周期

`start_prompt()` 只检查图片、发送 `prompt` RPC、验证 response command identity 并返回。Prompt response 只证明命令被
Pi 接受，不接受 Runtime Input Delivery，也不发布 `agent_run.started`。

只有当前 Host owner 已把事件绑定到精确的 `hostInstanceId + agentRunId + executionEpoch + nativePromptId + deliveryId`，
且事件类型为 `agent_start` 时，Core 才用现有 Delivery 状态事务把 Input 标为 `accepted`，并发布一次
`agent_run.started`。同一 native input ID 的重复 `agent_start` 是幂等 replay，不重复发 started；冲突 identity 仍
fail closed。用户 Extension 若消费输入而未产生 `agent_start`，Rovai 不伪造 started，也不增加轮询、短超时或替代
Receipt。

`message_end` 只收集 terminal assistant 内容、stop reason 与既有 Usage；唯一匹配的 `agent_settled` 仍是本轮结算边界。

## 4. Pi 原生 Tool 与权限语义

Pi 的 Built-in Tool 与用户 Extension Tool 全部按 Pi 原生语义运行。Rovai 不拦截 `bash/edit/write`，不创建 Approval、
shell identity、allow/deny response、Tool allowlist、sandbox 或 Pi permission request。Pi 不向成员公开 permission option；
公共配置被 schema 要求的 permission value 固定为空对象且执行时忽略，Pi compatibility digest 不包含 approval mode。

未映射的第三方 Extension `select`、`confirm`、`input`、`editor` 等交互返回原生 cancelled 或 `confirmed:false`；普通
`confirm` 不被解释成 Rovai Approval，也不 poison Host。纯展示通知可忽略或转为 diagnostic。

## 5. Managed Input Receipt 退役

新 Pi Run 不生成、验证、持久化或读取 Managed Input Receipt。Prompt、Host health、reuse、exact resume 与 input
acceptance 均不依赖 Receipt，也不引入新的 Preflight/AgentStart Receipt、Gate、IPC、超时、状态机或数据库表。

Data Contract v1.49 / Projection Schema 90 的 Migration 139 只移除新 acceptance 的 Receipt guard，并把现有 Pi
capability snapshot 的 permission options 归一为空列表、profile 与非终态 Run 的 permission value 归一为空对象。
历史 `pi_managed_input_receipt` 表、行、外键级联与不可变 UPDATE 保护保留为历史审计数据；删除父
`runtime_input_delivery` 时仍可合法级联，不关闭 foreign keys。

## 6. 能力与保留边界

- External MCP 为 `Unsupported`：Pi 不读取或投影 Assignment，不启动 Server，不注册 bridge Tool；MCP 不参与
  compatibility、LRU 或 exact resume。
- Skills、Extensions、Context files、Prompt templates、Built-in/Extension Tools 都由 Pi 原生 ResourceLoader 负责；
  Rovai 投递到 `.pi/skills` 的内容也走同一原生发现链。
- Pi 不提供 Rovai Tool Approval 或 sandbox；permission options 为空。
- 图片继续按模型能力经 `prompt.images` 发送；Session、model 与 thinking 语义保持不变。精确平台准入由
  Runtime Platform Admission Registry 及各平台 immutable evidence 拥有，不由本 launch 合同冻结。
- Formatter 22 Prompt 不解析 Slash/CURRENT_INPUT，不手工展开 Skill/Prompt template，不做 Prompt Transform。
- Host/Fleet 的 owner binding、epoch fence、singleflight、LRU、correlated abort、shutdown/reap 与 exact resume 保持不变。

## References

- [Runtime Launch and Verification v35（historical）](runtime-launch-and-verification-v35.md)
- [V1.48-D01](../versions/v1.48/decisions.md#v1-48-d01)
- [Pi Runtime 重新接入 Parity Matrix](../research/pi-runtime-reintegration-parity-matrix.md)
