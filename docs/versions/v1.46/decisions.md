---
document_type: version-decisions
version: v1.46
lifecycle: current
last_updated: 2026-09-05
---

# v1.46 决定

<a id="v1-46-d01"></a>
## V1.46-D01：关键 Composer mutation 使用同步交互锁与显式 Core content 回写

### 背景

v1.45 允许发送 snapshot 之后继续输入，并用 local version、persistence hold、epoch advance 和条件清空区分已发送
内容与下一条内容。这条并发路径增加了多组状态，却仍无法让普通 React `document` prop 更新安全覆盖正在编辑的
Lexical。Reply/Continuation mutation 可以在 Core 内物化 canonical Member Atom；若 Renderer 只更新 Coordinator，
Lexical 会继续显示旧正文。Camp 切换若依赖卸载 cleanup 异步 flush，导航又可能先销毁保存 owner。读取 Draft 失败
被伪造成空 revision-zero Draft 时，还会把基础设施错误解释成用户的空内容。

### 决定

发送、路由修改和 Camp 切换都在第一个异步等待前通过 Lexical imperative API 同步锁定交互。路由修改先 flush，
再执行 Core mutation；返回 content 与捕获 document 不同时，在解锁前 authoritative-replace Lexical。发送在锁内等待
附件、flush、发送 exact revision，并在接受后读取下一 Draft 完成 replacement；失败保留现有 Draft。Camp 切换只有
flush 成功才继续，组件 cleanup 不承担持久化。

Draft load 使用 loading/ready/error 三态；失败保持禁用并要求显式重试，只有成功 Core response 才能建立空 Draft。
Typeahead 在更高优先级的 Lexical command 中同步计算当前 trigger，避免 React 菜单 render 时序参与 Enter 所有权。
完整可测行为由 [Camp Composer Draft v9](../../contracts/camp-composer-draft-v9.md)拥有。

### 后果与被拒绝方案

- Core 与 Lexical 仍不是双 owner：Core 业务 mutation 若改变正文，必须通过唯一显式 replacement seam 返回编辑器。
- 同一 Composer 的发送期间不能输入下一条消息，因此删除 hold/resume、send generation 和成功后的版本比较。
- Draft 读取或切换保存失败可见且 fail closed，不会用空文档掩盖或覆盖本地内容。
- 拒绝 per-Camp Session Manager、发送 A/B 双缓冲与复杂 generation：本轮产品无需发送中输入，额外状态不能改善当前边界。
- 拒绝让每个新 `document` prop 自动替换 Lexical：Catalog、revision 或普通父 render 会重新引入输入覆盖风险。
- 拒绝继续依赖 React `disabled` 或 Typeahead React state：两者都可能晚于触发本次异步操作或 Enter 的原生事件。

<a id="v1-46-d02"></a>
## V1.46-D02：Pi 只接入原生执行生命周期，不复制 Approval 与输入准入体系

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
