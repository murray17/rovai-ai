---
document_type: version-architecture
version: v0.39
authority: implementation-contract
status: frozen
last_updated: 2026-08-05
---

# v0.39 Codex Isolated Home 与 AgentRun 进程合同

本文是 [ADR-0107](decisions.md#adr-0107)
在 v0.39 的冻结实施合同。它记录已经完成 grilling 并由用户确认的范围；代码、Migration、
测试和打包仍需单独完成，不能从 `status: frozen` 推断已经实现。

## 问题与目标

当前 Codex Adapter 的 app-server 是全局共享进程，使用用户真实 Codex Home，并把
`mcp_servers` 作为 `thread/start` / `thread/resume` 配置覆盖传入。Codex 会深度合并配置表。
用户原生 stdio `context7` 与 Rovai HTTP `context7` 因而可能合成同时含 `command` 和 `url`
的非法条目，出现：

```text
failed to load configuration: url is not supported for stdio in mcp_servers.context7
```

本期目标是让每个 Camp 内每个 Codex AgentProfile 只从独立 Home 读取已生成完成的顶层 MCP，
同时保留跨 AgentRun 的 Native Session。用户真实 `~/.codex/config.toml`、MCP 名称和
`~/.rovai/mcp.json` 的规范身份都不改变。

## 精确状态模型

| 对象 | 身份 | 生命周期 | 权威/用途 |
|---|---|---|---|
| Isolated Codex Home | `campId + agentProfileId` | Camp 存续期间 | Codex 配置、外部 MCP 与 Session 状态根 |
| Conversation | `campId + agentProfileId` 唯一 | Camp aggregate | Rovai 私有连续性与当前 Native Binding |
| Native Session | Codex `thread.id` | 可替换，跨 AgentRun | 外部 Codex 对话连续性；文件位于该 Home |
| MCP Projection Input | `agentRunId` | 不可变 | 本 Run 的规范定义、Assignment、环境与 digest |
| MCP Exposure Snapshot | `agentRunId` | 不可变 | 本 Run 实际投影及降级证据 |
| Codex app-server | `agentRunId + executionEpoch` | 单 AgentRun 非终态期间 | 本期实际 OS 进程所有权 |
| Home cleanup record | `campId` | 直到物理清理成功 | Camp 删除后的持久文件清理重试 |

领域 `Task`、`CampTurn` 和 AgentRun 终态都不是 Home 生命周期。Camp 才是用户所说的“任务”
边界。未来 Runtime LRU 管理的是进程，不得改变 Home、Conversation 或 Native Session 身份。

## 目录与权限

规范目录为：

```text
<Rovai data dir>/codex-homes/
  <camp_id>/
    <agent_profile_id>/
      config.toml
      auth.json -> <user real ~/.codex/auth.json>  # file-auth only
      .rovai-home.json
      sessions/
      ... Codex-owned state
```

插件缓存或插件状态通过平台适配的共享 symlink、挂载或等价机制可达。实现不得把整个用户
`~/.codex` 链入隔离 Home，也不得让 Camp 清理递归进入 `auth.json` 或插件共享目标。

安全要求：

- `codex-homes`、Camp 和成员目录只允许当前用户访问；
- `config.toml` 与 `.rovai-home.json` 使用 `0600` 等价权限；
- ID 必须先通过领域 ID 校验再作为单个路径 segment，拒绝分隔符、`.`、`..` 和 symlink
  目录组件；
- 配置通过同目录临时文件、flush、权限设置和 atomic rename 发布；
- metadata 只保存 ID、schema、时间与 digest，不能保存 MCP secret、Binding credential
  或 auth token；
- 日志、错误、审计和测试 snapshot 只能出现 redacted 配置。

## Home 创建与配置所有权

### 首次创建

在新 Home 没有 owner marker 时执行：

```text
read ~/.codex/config.toml bytes
→ parse TOML without lossy fallback
→ remove complete top-level mcp_servers table
→ force current execution root project trust = untrusted
→ apply Rovai fixed keys
→ write frozen external MCP projection
→ atomically publish config.toml
→ create auth.json symlink when file-auth is active; otherwise reuse OS keyring
→ expose shared plugin state
→ atomically publish .rovai-home.json last
```

`.rovai-home.json` 是创建完成 marker。半成品目录不能启动 Codex；同一 owner 的恢复可以清理
并重新创建，没有合法 owner marker 的目录按孤儿规则处理。用户配置缺失时以空 TOML 为基础；
存在但无法解析时失败关闭，不能把 malformed 文件视为空配置。

### 之后的更新

真实 `~/.codex/config.toml` 只在 Home 首次创建时读取一次。之后：

- 不因用户配置 digest 改变而 rebase；
- 不覆盖隔离配置中 Codex 或插件合法写入的非 Rovai 字段；
- 每次执行都重新断言当前 execution root 为 `untrusted`；
- 只替换 Rovai-owned fixed keys 和完整顶层 `mcp_servers`；
- Home schema 升级使用显式、可测试的 migration，不重新复制用户文件；
- 显式“重建环境”是未来能力，不隐藏在普通 Turn 启动中。

配置写入拥有关系如下：

| 配置面 | 来源 | 是否持久化到隔离 `config.toml` |
|---|---|---|
| 用户非 MCP 设置 | 首次复制的用户 config snapshot | 是 |
| authentication | 用户 file-auth symlink 或 OS keyring | 不复制 token |
| 用户顶层 MCP | 用户真实 config | 否，完整删除 |
| Rovai 外部 MCP | AgentRun frozen projection | 是，整表替换 |
| `rovai_team` | 当前 Native Binding | 否，仅 Runtime request 注入 |
| model / reasoning | Member Run Runtime Configuration | 否，启动/Turn 参数 |
| sandbox / approval | Rovai Runtime Permission Request | 否，启动参数 |
| 项目 `.codex/config.toml` | execution root | 禁用 |
| 项目 hooks / rules | execution root `.codex/` | 禁用 |
| 项目 `AGENTS.md` | Codex instruction discovery | 保留 |
| plugin / plugin MCP | 用户共享插件状态 | 保留，但不纳入 exact 顶层 MCP 承诺 |
| system/managed requirements | Codex installation / enterprise | 不可绕过，冲突时失败关闭 |

## MCP 计算与配置切换

Core 继续按 ADR-0103/0104 创建不可变 MCP Projection Input。若当前产品只有全局定义加成员
Assignment，则最终集合直接等于该 Run 成功解析的 assigned Servers。以后若增加成员固定层
和 Camp 临时层，必须在 Core 内先按名称计算完整结果，高层同名 Server 整项替换低层定义；
禁止把 stdio/HTTP、headers/env 或其他字段逐字段拼接。

Adapter 准备 AgentRun 时：

1. 取得该 Run 的 frozen projection 或 recovery exposure；
2. 计算 redacted canonical digest；
3. 获取 Home 独占锁，确认没有活动 app-server；
4. digest 不同时，从隔离 config 删除旧顶层 `mcp_servers`，一次性写入新集合；
5. 原子发布配置和 metadata digest；
6. 释放写锁后启动新进程。

同一 Run 的 MCP-specific startup fallback 只允许使用同一 frozen input。外部 MCP 被 Codex
明确拒绝时，必须关闭进程、写入降级集合并新启进程；最终 Exposure Snapshot 记录 requested、
projected、omitted 和 reason。不得 reread live `mcp.json`，也不得回退到用户同名 Server。

`rovai_team` 不参与持久 digest。它在每次 start/resume 时使用当前 Native Binding ID、Core
socket 和 process-lifetime credential 注入。外部 Assignment 不允许占用保留名
`rovai_team`。

## Project 配置隔离

仅改变 `CODEX_HOME` 不能阻止受信任工作区中的 `.codex/config.toml`。Home manager 必须为
每个实际 execution root 写入显式 `untrusted` 项，使 Codex 跳过：

- 项目 `.codex/config.toml`；
- 项目 hooks；
- 项目 exec policies / rules；
- 通过项目配置声明的 MCP、model、provider、sandbox 或 approval。

`AGENTS.md` 不属于 `.codex` 配置层，继续按 Codex 项目指令链加载。Adapter 初始化后、首个
`thread/start` / `thread/resume` 前调用 Codex `config/read` 或版本等价的有效配置读取，校验：

- 生效用户层路径是 Isolated Codex Home；
- 目标项目 `.codex` 层没有启用；
- 顶层 MCP 名称和 transport identity 与 frozen projection 完全一致；
- 不存在系统层额外注入的未知顶层 MCP。

验证失败必须关闭本 Run 的 app-server 并记录结构化 launch failure。插件 MCP 在独立 namespace
中验证或披露，不与顶层 exact 集合比较。

## AgentRun 进程生命周期

当前 `CodexCliRuntimeAdapter.agent_hosts: HashMap<RuntimeHostKey, Arc<CodexHost>>` 的全局复用
必须移除。每个 AgentRun 的 `CodexRuntime` 独占一个 `CodexHost`，并由该 Run 的 registry
登记：

```text
AgentRun claimed
→ ensure Home/config
→ spawn codex app-server with CODEX_HOME
→ initialize + effective-config verification
→ thread/resume(existing native_session_id) or thread/start
→ turn/start and normal tool/action routing
→ Run remains running/waiting: keep process and fencing
→ Run succeeded/failed/cancelled: shutdown, await exit, remove registry entry
```

要求：

- 不再计算或使用跨 Run 的 Codex `RuntimeHostKey`；
- 一个 AgentRun/execution epoch 最多一个 live host；重复 ensure 返回同一 live Run-owned runtime；
- epoch 变化、host death 或恢复重新启动进程，但仍使用该 Run 的 frozen config；
- terminalization、cancellation detach、launch error、worker panic 和 Core shutdown 都进入同一
  idempotent shutdown 路径；
- `kill_on_drop` 只作最后保险，正常路径必须有界等待 shutdown/exit；
- AgentRun waiting 不是终态，不因等待 Approval、Action 或 Input 自动释放进程；
- 多成员并发 fanout 每个 Run 使用自己的进程和各自 Home。

未来 LRU 可以复用同一 Conversation/Home 的空闲进程，但必须通过统一 Runtime Process Manager
显式实现 admission、idle、waiting、budget、eviction、crash 和 shutdown 协议。本期不增加
Codex-only LRU，也不把临时全局 cache 伪装成该管理器。

## Session 恢复与 Home 重建

正常后续 AgentRun 从 `conversation.native_session_id` 取得 Codex thread ID，在同一 Home 中
执行 `thread/resume`。Resume 仍按 ADR-0100 重新注入最新 Member Identity Bootstrap；新进程
不等于新 Native Session。

若 Home 存在但 rollout 不可用，继续使用现有 controlled resume failure 路径：记录失败、
创建 replacement Native Binding、重新 materialize Bootstrap，并 `thread/start`。若 Home
缺失、owner marker 不匹配或被判定不可恢复，则先重建 Home，再直接执行受控 Session
replacement；不能先用一个已知不存在的 thread ID 制造普通 launch failure。

Home 重建能恢复配置和登录环境，不能恢复被删除的 Codex原生历史。Rovai 的 Camp 公共历史、
ContextManifest 和 Bootstrap 继续提供业务上下文，但产品与审计不得宣称 byte-identical native
resume。

## Camp 删除、重试与孤儿 GC

Camp 永久删除的 SQLite transaction 在删除 aggregate 前写入不依赖 Camp foreign key 的
`codex_home_cleanup` 记录，至少包含 `camp_id`、请求时间、attempt、last_error 和 next retry。
事务提交后立即 wake worker：

1. fencing/关闭该 Camp 所有 Codex Run-owned host；正常 Camp delete blocker 应已保证无非终态
   AgentRun；
2. 验证目标恰好是 `codex-homes/<camp_id>` 的普通目录；
3. unlink 内部 auth/plugin symlink 而不进入 target；
4. 删除整个 Camp Home subtree；
5. 成功后删除 cleanup record，失败则写 redacted error 并退避重试。

业务 Camp 已删除后，文件失败不改变 `camp.deleted` command result。未知目录只有在同时满足
“无法解析有效 owner marker”“数据库无 Camp”“无 cleanup record”并超过 72 小时时才作为孤儿
删除。GC 在 Core 启动后和固定周期运行，72 小时 retention 可配置但默认不得更短。时钟回拨、
权限错误和正在创建的 marker 都必须 fail closed。

不存在以下清理触发器：AgentRun terminal、CampTurn completed/failed/cancelled、领域 Task
completed/cancelled、成员离开或移除、Camp 30 天无 Turn。

## 非 AgentRun Codex 作业

Context compaction、健康验证或其他内部 Codex completion 若不属于一个 Conversation，不得使用
用户真实 Home，也不得借用任意 Camp/成员 Home。它们使用 job-scoped 临时 Home：

- 认证可以共享；
- 用户顶层 MCP、项目 `.codex` 与插件 MCP 默认不加载；
- thread 使用 ephemeral mode；
- 进程结束后立即安全清理。

该路径不能产生 Conversation Native Session、MCP Exposure 或长期 Home cleanup record。

## 实施模块边界

新增窄 `CodexHomeManager`，让调用者只处理以下深接口：

```text
prepare_agent_run_home(camp, agent, run, epoch, execution_root, frozen_projection)
  -> PreparedCodexHome { path, config_generation, external_mcp_digest, guard }

rebuild_missing_home(...)
enqueue_camp_cleanup(camp_id, transaction)
cleanup_camp_now(camp_id)
collect_orphans(now)
```

该模块拥有路径验证、Home marker、用户配置 snapshot、TOML 净化、auth/plugin linkage、原子
配置更新、per-Home lock 和 GC。Codex Adapter 不直接拼接 Home 路径或编辑 TOML。

Codex process registry 仍可暂时留在 Adapter，但只按 `agentRunId` 保存 Run-owned runtime；
创建和 shutdown 通过一个窄 lifecycle helper，方便未来统一 Runtime Process Manager 替换。
Camp cleanup 通过显式查询/索引终止相关 Run-owned runtime，不反向扫描任意 OS 进程。

## Migration 与兼容性

- 新增 Home cleanup 持久记录及必要索引；Migration 不读取或修改用户 Codex 配置；
- 旧版本没有 Rovai-owned Codex Home，不迁移用户 Native Session rollout；某 Conversation 首次
  在新版本启动时创建 Home，并可能因旧 thread 只存在于用户 Home 而 controlled-replace；
- 不把用户 `~/.codex/sessions` 复制进隔离 Home，避免把其他原生会话及隐私历史整体导入；
- 不维护全局-host 与 per-Run-host 双路径；升级后 Codex AgentRun 只走新路径；
- 其他 Runtime Adapter 的 MCP projection、进程管理和文件生命周期不在本次 Migration 内。

## 验收矩阵

### 配置与隔离

- 用户真实 config 的 byte digest 在创建、运行、降级、恢复和删除后均不变；
- 原生 stdio `context7` + Rovai HTTP `context7` 能成功启动，effective 顶层条目只有 `url`；
- 用户额外不同名顶层 MCP 不出现在 AgentRun；
- Rovai stdio/HTTP Server 各自保留完整、互斥 transport 字段；
- 用户配置中没有 MCP、存在空表、存在 malformed TOML、缺失文件均有确定结果；
- 项目 `.codex/config.toml` 声明 MCP/model/permission、项目 hooks 与 rules 均不生效；
- 项目 `AGENTS.md` 仍出现在 Codex 返回的 instruction sources；
- system/managed unknown top-level MCP 触发 fail-closed；
- plugin 及 plugin MCP 仍可用，但诊断明确标记为 plugin exception。

### Home 与 Session

- 同一 Camp/AgentProfile 的连续 AgentRuns 使用同一路径、新进程和同一 thread ID；
- 同一 AgentProfile 在两个 Camp 使用不同 Home、不同 Session 文件和不同进程；
- 同一 Camp 两个 AgentProfile 完全隔离；
- 成员 leave/rejoin、away/removed 不删除 Home；
- 用户真实 config 更新不改变既有 Home，新 Home 使用更新后的 snapshot；
- Home 缺失/损坏触发重建和 controlled Session replacement，不伪报 resume。

### MCP 代次与恢复

- Assignment 更新只影响后续 AgentRun；运行中/等待中 Run 不热切换；
- 后续 Run 启动前整表替换并重启新进程，同名 transport 不产生字段级残留；
- 旧 Run recovery 使用 frozen projection；
- external degradation 使用同一 frozen input、关闭首进程并新启降级进程；
- `rovai_team` credential 不出现在 `config.toml`、metadata、日志或 snapshot。

### 进程生命周期

- 两条并行 AgentRuns 各有独立 app-server PID；
- 后续 AgentRun 不复用上一 Run PID；
- `running` / `waiting` 保持进程，三个终态均有界关闭；
- cancellation、launch failure、app-server crash、epoch replacement 和 Core shutdown 无泄漏；
- Adapter 不再保留或命中全局 `agent_hosts` cache；
- job-scoped internal Codex process 使用独立临时 Home 并在结束后清理。

### 删除与安全

- Camp delete transaction 创建 cleanup record，提交后立即删除 Home；
- 注入权限错误后 Camp 仍保持 deleted，cleanup record 重试并最终清除；
- 删除 Home 只 unlink auth/plugin symlink，用户目标保持完好；
- 移除成员或完成/失败/取消 Turn/Task/Run 均不删除 Home；
- 合法 Camp Home 不被 orphan GC 删除；真正孤儿在 72 小时前保留、之后清理；
- 路径穿越、symlink Camp 目录、伪 owner marker 和并发 Core 启动全部 fail closed。

### 真实验收与发布

- 扩展 `scripts/smoke-mcp-projection.mjs`，增加同名跨 transport case，而非只测
  stdio-vs-stdio；
- 通过真实 Codex app-server 验证 `config/read`、`thread/start`、`thread/resume` 和工具调用；
- Core unit/integration tests、`cargo test --workspace`、clippy、format 和相关 desktop tests
  通过；
- 重新构建并启动 packaged macOS App，用本机实际 Camp 验证，不得只运行源码或旧包。

## 非目标

- 本期不实现统一跨 Runtime LRU、进程预算 UI 或 idle eviction；
- 不自动同步用户 Codex config；
- 不修改用户 MCP 名称或真实配置；
- 不隔离或治理用户插件 MCP；
- 不复制用户完整 Codex Session 历史；
- 不在 30 天不活跃时清理有效 Camp Home；
- 不改变 Claude、ACP、Copilot、Antigravity 等其他 Adapter 的进程生命周期；
- 不借本修复引入新的 MCP scope、字段级 merge 或中央 MCP proxy。
