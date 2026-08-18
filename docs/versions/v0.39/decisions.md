---
document_type: version-decisions
version: v0.39
lifecycle: historical
last_updated: 2026-08-18
---

# v0.39 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0107](#adr-0107) | Camp-Member Isolated Codex Home and AgentRun-Scoped App Server | `superseded` |

<!-- legacy-adr:begin id=ADR-0107 source-file-sha256=660f4b7489c379bfc73c9c645b746806e2e816b6303dcdf2222a35f1664ed412 -->
<a id="adr-0107"></a>

## ADR-0107: Camp-Member Isolated Codex Home and AgentRun-Scoped App Server

迁移时原路径：`docs/adr/0107-camp-member-isolated-codex-home-and-agentrun-app-server.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0107
title: Camp-Member Isolated Codex Home and AgentRun-Scoped App Server
status: superseded
date: 2026-08-05
decision_scope: cross-version
source_version: v0.39
supersedes: []
superseded_by: ADR-0126
```

<!-- legacy-adr-body:begin id=ADR-0107 -->
> 本决策已由 [ADR-0126](../v0.43/decisions.md#adr-0126) 替代。

> 本决策局部替代 [ADR-0018](../v0.09/decisions.md#adr-0018) 对 Codex
> 使用终态即删除临时 MCP 文件的要求，以及
> [ADR-0104](../v0.37/decisions.md#adr-0104) 对 Codex
> 依赖一次 whole-table override 隔离 ambient MCP 的实现方式。逐 AgentRun 冻结 MCP
> Projection Input/Exposure、Rovai 同名优先和外部 MCP 降级语义继续有效。
>
> 后续 [ADR-0123](../v0.41/decisions.md#adr-0123) 局部替代本文“Codex app-server
> 每 AgentRun 新建且终态即关闭”的进程生命周期：兼容进程可以在同一
> `(campId, agentProfileId)` Isolated Home 内进入受配额和 TTL 控制的 Resident Fleet。
> 本文的 Home 隔离、配置所有权、Native Session 连续、Camp 删除 cleanup 和 orphan GC
> 条款继续有效。

<a id="adr-0107-context"></a>
### Context

Codex 的 `CODEX_HOME` 不只是用户配置目录。它同时承载 `config.toml`、文件型认证缓存、
日志、插件状态和可供 `thread/resume` 使用的 Native Session rollout。`CODEX_HOME` 又是
`codex app-server` 进程级环境，因此一个全局共享 app-server 不能同时为不同 Camp 或不同
AgentProfile 使用不同的配置与 Session 根目录。

现有 Codex Adapter 复用一个按 Runtime 安装配置摘要分组的全局 app-server，并在
`thread/start` / `thread/resume` 中传入完整 `mcp_servers` 对象。Codex 对配置表执行深度合并，
而不是把该对象视为删除低优先级表的 replacement。若用户 `~/.codex/config.toml` 已有同名
stdio MCP，而 Rovai 投影同名 HTTP MCP，最终条目可能同时包含 `command` 与 `url`，在模型
启动前即被 Codex 拒绝。不同名称的用户 MCP 也可能继续泄漏到 AgentRun。

Rovai 必须同时满足四个约束：用户真实 Codex 配置不得被修改；同一成员在同一 Camp 的后续
执行应继续原 Native Session；不同 Camp 或成员不能共享 Codex 状态根；本期不能等待未来的
统一 Runtime LRU 进程管理器。这里的“任务生命周期”明确指 **Camp**，不是领域 `Task`，也
不是单次 `CampTurn` 或 `AgentRun`。

<a id="adr-0107-decision"></a>
### Decision

<a id="adr-0107-持久状态与进程使用不同身份"></a>
#### 持久状态与进程使用不同身份

Rovai 为每个 `(campId, agentProfileId)` 建立一个 **Isolated Codex Home**：

```text
<Rovai data dir>/codex-homes/<camp_id>/<agent_profile_id>/
```

该键与一个 Camp 内一个 AgentProfile 的 `Conversation` 连续性一致，但目录不使用
`CampTurn`、领域 `Task`、`AgentRun`、CampMember 关系记录或 Native Session ID 作为身份。
成员离开 Camp、重新加入、暂时 away 或永久从成员名册移除都不改变既有目录身份；只要 Camp
仍存在，该 Home 就保留。

本期 Codex app-server 采用相反的短生命周期：每个 AgentRun 启动一个新进程，不进入全局
Codex host 池。`running` 和 `waiting` 都是非终态；同一 AgentRun 仍可使用其已登记进程。
AgentRun 进入 `succeeded`、`failed` 或 `cancelled`，或者启动失败、进程异常退出、Core 关闭
时，Rovai 必须关闭并解除该进程。恢复同一 AgentRun 时可以为当前 execution epoch 重建进程；
后续 AgentRun 总是启动新进程，以同一个 Isolated Codex Home 执行 `thread/resume`。

未来统一 Runtime LRU 可以替代“每 Run 新进程”的策略，但 Codex 池化身份至少必须包含
`(campId, agentProfileId)` 的 Home 身份及当前配置代次，不能恢复为全局共享进程，也不能让
一个进程跨 Isolated Codex Home 读取状态。

<a id="adr-0107-首次复制用户配置之后由隔离副本独立演进"></a>
#### 首次复制用户配置，之后由隔离副本独立演进

Home 首次创建时，Rovai 按以下顺序生成配置：

1. 读取并解析用户真实 `~/.codex/config.toml`；
2. 将其复制为隔离配置基础，删除完整顶层 `[mcp_servers]` 及所有
   `[mcp_servers.*]` 子表；
3. 把本次执行工作区在隔离配置中强制标记为 `untrusted`；
4. 写入 AgentRun 冻结后实际投影的完整 Rovai 外部 MCP 顶层集合；
5. 覆盖 Rovai 启动所必需的固定配置。

复制是一次性 snapshot。后续 Turn 或 AgentRun 不因用户真实配置变化而重新复制；已有 Home
只更新 Rovai 拥有的工作区信任、固定配置和顶层外部 MCP 部分。新 Camp/成员 Home 使用创建
时最新的用户配置。读取失败或 TOML 无法无歧义解析时，启动明确失败；Rovai 不修复、不清空
也不写回用户文件。

隔离配置使项目 `.codex/config.toml`、项目 hooks、项目 exec policies/rules 均不参与 Rovai
启动的 Codex。项目 `AGENTS.md` 指令链继续按执行工作区发现。模型、权限、sandbox、approval
和其他 Run 参数继续由 Rovai 的启动请求提供。无法绕过的系统或企业托管要求仍然有效；若
Codex 的 effective config 显示它们额外注入未知顶层 MCP，Adapter 必须在首个模型 Turn 前
失败关闭，而不是宣称 exact isolation。

所有 Home 目录使用 current-user-only 权限。`config.toml` 通过同目录临时文件、flush 和原子
rename 发布，并使用 `0600` 等价权限。路径组成、owner marker 和删除目标必须验证，不能跟随
攻击者提供的目录或 symlink 越出 `codex-homes` 根。

<a id="adr-0107-认证共享插件明确例外"></a>
#### 认证共享，插件明确例外

用户采用文件型认证时，每个 Home 的 `auth.json` 软链接到用户真实 Codex 认证缓存，从而复用
ChatGPT 登录和正常 token refresh，而不为每个 Camp/成员复制 refresh token。用户采用 OS
keyring 时继续共享该系统凭据，不创建伪 `auth.json`，也不强制迁移认证存储模式。该共享仅
适用于认证状态；用户真实 `config.toml` 仍然不可写。

隔离 Home 必须能够访问用户共享的 Codex 插件缓存和插件状态；具体使用 symlink、受管挂载
或平台等价机制。插件及其可能内置的 MCP 不属于本次 ambient MCP 隔离承诺。精确承诺收窄为：

> 用户真实顶层 `[mcp_servers.*]` 不读取、不保留、不合并；Codex 的顶层外部 MCP 只来自
> Rovai。用户启用插件及其内置 MCP 是独立插件能力。

Rovai 不得把插件 MCP 计入外部 MCP Exposure Snapshot，也不得把本决策描述为禁用、复制或
治理用户插件。共享插件状态意味着插件自身的更新、认证和 MCP 行为继续遵循 Codex 原生语义。

<a id="adr-0107-外部-mcp-持久投影与内部-team-gateway-分层"></a>
#### 外部 MCP 持久投影与内部 Team Gateway 分层

每个 AgentRun 继续冻结 ADR-0018/0104 定义的 MCP Projection Input。Adapter 在启动新
app-server 前，把该 Run 应使用的最终外部 MCP 投影摘要与 Home 当前摘要比较：

- 相同则保留现有隔离配置字节；
- 不同则在确认没有该 Home 的活动进程后，原子替换顶层 `mcp_servers`；
- 同一 AgentRun 的恢复始终使用其冻结投影，不读取最新 `~/.rovai/mcp.json`；
- 后续 AgentRun 才能采用新的 enablement、Assignment、定义或环境解析结果。

若未来 Rovai 出现成员固定 MCP 与 Camp 临时 MCP 两层，必须先在 Rovai 内部计算最终集合；
同名时高层定义整项替换低层定义，不进行字段级合并。当前若不存在该分层，则直接使用成员
最终 Assignment 结果，不引入虚构的合并模型。

持久 `config.toml` 只保存外部 MCP。保留名 `rovai_team` 的定义包含 Native Binding credential，
继续只在 `thread/start` / `thread/resume` 的进程内配置中注入，不写入 Home。最终 Codex 顶层
MCP 因而仍由 Rovai 控制，但短期内部凭据不会随 Camp 无限期落盘。

若 Codex 明确拒绝正常外部投影并触发 ADR-0104 的单次降级，Adapter 必须关闭已读取旧配置
的 app-server，原子写入同一冻结 Projection Input 导出的降级集合，再启动一个新进程。不能
修改文件后继续使用已经解析过配置的旧进程。

<a id="adr-0107-启动验证和并发-fencing"></a>
#### 启动、验证和并发 fencing

AgentRun 的 Codex 启动序列为：

```text
claim AgentRun/execution epoch
→ acquire Isolated Codex Home ownership
→ materialize frozen external MCP config
→ spawn codex app-server with CODEX_HOME=<isolated home>
→ initialize and read effective config
→ verify no unexpected top-level MCP/config layer
→ thread/start or thread/resume with runtime-only rovai_team
→ run Turn
→ terminalize/fence AgentRun
→ stop app-server and release ownership
```

Rovai 现有 Conversation serialization 仍是业务并发边界，Home manager 还必须以进程内和必要
的文件级锁防止两个 Core 实例同时改写同一 Home。任何配置更新都发生在新 app-server 启动
前；活动进程期间不热改 `config.toml`。

非 AgentRun 的 Codex 内部作业不得回退到用户真实 Home。若该作业不属于一个 Conversation，
它使用独立短期 Rovai Home、共享认证但不加载用户顶层 MCP，并在作业进程结束后清理；它不
获得 Camp/成员 Home 的 Native Session 连续性。

<a id="adr-0107-生命周期与删除"></a>
#### 生命周期与删除

Isolated Codex Home 不随 AgentRun、CampTurn、Task 的终态清理，也没有 24 小时或 30 天不活跃
自动清理。其生命周期只有：

- Camp 存在：Home、Session 和外部 MCP 配置持续保留；
- Camp 永久删除：Camp 数据库删除事务同时写入持久 Home cleanup record；提交后立即关闭相关
  进程并尝试删除 Camp 下全部 Home；失败不复活 Camp，由 cleanup record 重试直到成功；
- 未关联有效 Camp 且没有 cleanup record 的未知孤儿目录：保留 72 小时后由周期 GC 删除。

Camp 删除命令的业务结果以 SQLite 永久删除为准。文件系统失败不能把已删除 Camp 伪装成仍
存在，也不能丢失重试事实。删除必须只 unlink Home 内 symlink，绝不能递归进入用户真实
认证文件或共享插件缓存。

若 Camp 仍存在但 Home 被用户手动删除、损坏或缺少必要状态，Rovai 可以按当前用户配置重建
环境，但原 Codex rollout 不可重建。该路径必须执行受控 Native Session replacement、更新
Conversation binding 并留下诊断，不能把新 Session 描述成恢复了原生历史。

<a id="adr-0107-consequences"></a>
### Consequences

- 用户原生同名 stdio/HTTP MCP 不再通过深度合并污染 Rovai AgentRun，且用户
  `~/.codex/config.toml` 无需改名、备份或写回。
- 同一 Camp/成员可在每条 AgentRun 使用新 app-server 的同时保留 Codex Native Session；
  进程隔离和 Session 连续性不再被错误地绑定在一起。
- 每 Run 启动进程增加启动延迟和资源抖动，但为未来按 Conversation/Home 管理的统一 LRU
  提供正确身份边界。
- Codex 的外部 MCP Runtime Projection 从终态删除的临时文件变为 Camp/成员 Home 中的持久
  配置；Projection Input、Exposure Snapshot 和恢复证据仍然逐 AgentRun 冻结。
- 外部 MCP 配置可能包含凭据并随 Camp 长期落盘，因此目录权限、原子写、redaction、备份
  文案和安全删除边界成为强制验收项。
- 共享 `auth.json` 和插件状态是明确的非隔离面；尤其不能再宣称插件内置 MCP 由 Rovai 独占。
- Camp 删除需要窄 cleanup record 与周期 GC，不能只依赖一次 best-effort `remove_dir_all`。

<a id="adr-0107-rejected-alternatives"></a>
### Rejected Alternatives

- 修改或清空用户 `~/.codex/config.toml`：越过用户配置所有权，并会影响原生 Codex。
- 重命名 Rovai MCP：掩盖同名合并问题，破坏规范名称和 Assignment 心智模型。
- 继续把 whole-table `thread/start` override 当作 replacement：Codex 实际执行深度合并。
- 为每个 CampTurn 或 AgentRun 创建独立 Home：会丢失同一 Conversation 的 Native Session
  连续性，并复制更多认证与插件状态。
- 全局共享一个 Codex app-server：进程级 `CODEX_HOME` 无法同时隔离多个成员和 Camp。
- 本期直接实现跨 Runtime LRU：正确长期方向仍需统一预算、闲置、等待态、恢复和 eviction
  协议；它不是修复当前配置污染的前置条件。
- AgentRun 终态后删除 Home：同时删除 `sessions`，使后续 AgentRun 无法 resume。
- Camp 30 天无 Turn 后清理：会让仍存在的 Camp 静默失去原生历史。
- 每个 Home 复制 `auth.json`：扩散 refresh token，并引入多份认证缓存失效与刷新竞争。
- 把 `rovai_team` credential 写入持久配置：让进程期 Binding secret 随 Camp 无限期保存。
- 禁用用户插件来取得“全部 MCP 独占”：插件兼容性不是本次修复范围，承诺应准确收窄。

<a id="adr-0107-references"></a>
### References

- [v0.39 Codex 隔离实施合同](codex-home-isolation.md)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](../v0.09/decisions.md#adr-0018)
- [ADR-0057: Member Presence and Retained Permanent Removal](../v0.15/decisions.md#adr-0057)
- [ADR-0058: Collaboration v4](../v0.15/decisions.md#adr-0058)
- [ADR-0071: Configured Camp Creation and Lazy Conversations](../v0.22/decisions.md#adr-0071)
- [ADR-0079: Two-Phase Cancellation Projection and Bounded Runtime Interrupt](../v0.24/decisions.md#adr-0079)
- [ADR-0088: Attested Native Team Gateway Attachment](../v0.30/decisions.md#adr-0088)
- [ADR-0100: Latest Member Identity in Native Session Bootstrap](../v0.35/decisions.md#adr-0100)
- [ADR-0103: Canonical MCP JSON and Stable Assignment Identity](../v0.37/decisions.md#adr-0103)
- [ADR-0104: Rovai-Preferred MCP Projection and External Degradation](../v0.37/decisions.md#adr-0104)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Codex app-server reference](https://learn.chatgpt.com/docs/app-server)
<!-- legacy-adr-body:end id=ADR-0107 -->
<!-- legacy-adr:end id=ADR-0107 -->
