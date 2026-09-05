---
document_type: version-decisions
version: v1.48
lifecycle: current
last_updated: 2026-09-05
---

# v1.48 决定

<a id="v1-48-d01"></a>
## V1.48-D01：Pi 只接入原生执行生命周期，不复制 Approval 与输入准入体系

### 背景

Pi 已经原生拥有项目 trust、ResourceLoader、Built-in/Extension Tools 与 Tool execution。此前 Rovai extension 又对
`bash/edit/write` 建立部分 Approval，并要求 `before_agent_start` 提交 Managed Input Receipt 后才接受 Delivery。
这形成了第二套并不覆盖全部 Pi Tool 的权限语义，也让 Bootstrap 注入、Prompt acceptance、Host reuse 和数据库
Receipt 相互耦合。它既不是 Pi sandbox，也不能证明后加载 Extension 没有继续修改 provider 输入。

### 决定

正式 Host 固定使用 `pi --mode rpc --no-themes --approve --extension <rovai-extension>`；`--approve` 只授予本次进程
项目资源 trust，不映射为 Rovai Tool Approval。Pi 的 Skills、Extensions、Context files、Prompt templates、
Built-in/Extension Tools 与 Tool execution 全部由 Pi 原生链路拥有。Rovai extension 只上报 Session 状态，并在每个
`before_agent_start` 重新读取 binding、追加 Bootstrap；读取失败只诊断，不 abort。

新 Run 不生成或读取 Managed Input Receipt。`prompt` response 只结束 command round trip；精确绑定到当前 Host、Run、
epoch、Prompt 与 Delivery 的第一个 `agent_start` 在现有 Delivery 事务中接受 Input，并发布一次 `agent_run.started`。
`message_end` 只收集 final/usage，`agent_settled` 继续拥有终态。历史 Receipt 表与行保留，只有新 acceptance guard
退役。完整规范由 [Runtime Launch and Verification v36](../../contracts/runtime-launch-and-verification-v36.md)拥有。

### 后果与被拒绝方案

- Pi 没有 Rovai permission option、Approval 或 sandbox；公共 schema 所需 value 为空对象，compatibility digest 不含
  approval mode。
- Pi External MCP 继续为 `Unsupported`；原生 Extension Tool 能力不被重新包装为 Rovai MCP bridge。
- Session locator、exact resume、Host owner、binding generation、execution epoch、Fleet/LRU、abort 与图片不属于
  Approval/Receipt，全部保留。
- 拒绝用 Preflight Receipt、AgentStart Receipt、短超时、armed gate 或新数据库状态替代旧 Receipt；现有
  Delivery transition 已经提供幂等 acceptance seam。
- 拒绝继续做部分 Tool Approval：覆盖面不完整却对用户呈现治理承诺，比明确交给 Pi 原生语义更不诚实。
